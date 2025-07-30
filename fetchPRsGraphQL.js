import { graphql } from '@octokit/graphql';

const PAT = process.env.PAT;

const graphqlWithAuth = graphql.defaults({
    headers: {
        authorization: `Bearer ${PAT}`,
    },
});

async function fetchAllPullRequests(owner, repo) {
    let hasNextPage = true;
    let endCursor = null;
    const pullRequests = [];

    while (hasNextPage) {
        const query = `
            query ($owner: String!, $repo: String!, $endCursor: String) {
                repository(owner: $owner, name: $repo) {
                    pullRequests(first: 100, after: $endCursor, states: MERGED) {
                        edges {
                            node {
                                number
                                title
                                createdAt
                                mergedAt
                                state
                            }
                        }
                        pageInfo {
                            hasNextPage
                            endCursor
                        }
                    }
                }
            }
        `;

        const variables = {
            owner,
            repo,
            endCursor,
        };

        const response = await graphqlWithAuth(query, variables);
        const prData = response.repository.pullRequests;

        pullRequests.push(...prData.edges.map(edge => edge.node));
        hasNextPage = prData.pageInfo.hasNextPage;
        endCursor = prData.pageInfo.endCursor;
    }

    return pullRequests;
}

async function fetchPRDetails(owner, repo, prNumber) {
    const query = `
        query ($owner: String!, $repo: String!, $prNumber: Int!) {
            repository(owner: $owner, name: $repo) {
                pullRequest(number: $prNumber) {
                    additions
                    deletions
                }
            }
        }
    `;

    const variables = {
        owner,
        repo,
        prNumber,
    };

    const response = await graphqlWithAuth(query, variables);
    const prDetails = response.repository.pullRequest;

    return {
        additions: prDetails.additions,
        deletions: prDetails.deletions,
    };
}

function calculateTimeDifferenceInMinutes(start, end) {
    const startTime = new Date(start);
    const endTime = new Date(end);
    return (endTime - startTime) / (1000 * 60); // Convert milliseconds to minutes
}

async function main() {
    const repositories = [
        { owner: 'SAP', repo: 'terraform-exporter-btp' },
        { owner: 'SAP', repo: 'terraform-provider-btp' },
    ];

    const period = 'last_week'; // Change to 'last_month' if needed

    const since = new Date();
    if (period === 'last_week') {
        since.setDate(since.getDate() - 7);
    } else if (period === 'last_month') {
        since.setMonth(since.getMonth() - 1);
    }

    for (const { owner, repo } of repositories) {
        console.log(`Fetching pull requests for ${owner}/${repo}...`);
        try {
            const pullRequests = await fetchAllPullRequests(owner, repo);

            const filteredPRs = pullRequests.filter(pr => new Date(pr.mergedAt) >= since);

            console.log(`Pull Requests for ${owner}/${repo}:`);
            let totalMergeTime = 0;

            for (const pr of filteredPRs) {
                const timeToMerge = calculateTimeDifferenceInMinutes(pr.createdAt, pr.mergedAt);
                totalMergeTime += timeToMerge;

                const { additions, deletions } = await fetchPRDetails(owner, repo, pr.number);
                const linesChanged = additions + deletions;

                console.log(`- PR #${pr.number} ${pr.title}: Time to merge: ${timeToMerge.toFixed(2)} minutes, Lines changed: ${linesChanged} (added: ${additions}, deleted: ${deletions})`);
            }

            if (filteredPRs.length > 0) {
                const averageMergeTime = totalMergeTime / filteredPRs.length;
                console.log(`Average time to merge for ${owner}/${repo}: ${averageMergeTime.toFixed(2)} minutes`);
            } else {
                console.log(`No pull requests merged in the specified period for ${owner}/${repo}.`);
            }
        } catch (error) {
            console.error(`Error fetching pull requests for ${owner}/${repo}:`, error.message);
        }
    }
}

main();
