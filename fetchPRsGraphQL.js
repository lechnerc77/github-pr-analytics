import { graphql } from '@octokit/graphql';
import chalk from 'chalk';
import readlineSync from 'readline-sync';
import fs from 'fs';

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
        { owner: 'SAP', repo: 'terraform-provider-scc' },
        { owner: 'SAP', repo: 'terraform-provider-sap-cloud-identity-services' },
        { owner: 'cloudfoundry', repo: 'terraform-provider-cloudfoundry' }

    ];

    const results = []; // Define the results array to store output data

    // Interactive input for time interval
    const period = readlineSync.question('Choose the time interval (last_week/last_month, default: last_week): ', {
        defaultInput: 'last_week',
    });


    const outputFormat = readlineSync.question('Choose the output format (console/json/csv, default: console): ', {
        defaultInput: 'console',
    });

    const since = new Date();
    if (period === 'last_week') {
        since.setDate(since.getDate() - 7);
    } else if (period === 'last_month') {
        since.setMonth(since.getMonth() - 1);
    } else {
        console.log('Invalid input. Defaulting to last_week.');
        since.setDate(since.getDate() - 7);
    }

    const startDate = since.toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0];
    const log = console.log;

    for (const { owner, repo } of repositories) {
        log("")
        log(chalk.gray(`Fetching pull requests for ${owner}/${repo}...`));
        try {
            const pullRequests = await fetchAllPullRequests(owner, repo);

            const filteredPRs = pullRequests.filter(pr => new Date(pr.mergedAt) >= since);

            let totalMergeTime = 0;
            let maxMergeTime = 0;
            let minMergeTime = Number.MAX_VALUE;
            let totalLinesChanged = 0;
            let maxLinesChanged = 0;
            let minLinesChanged = Number.MAX_VALUE;

            const prDetails = [];

            for (const pr of filteredPRs) {
                const timeToMerge = calculateTimeDifferenceInMinutes(pr.createdAt, pr.mergedAt);
                totalMergeTime += timeToMerge;
                maxMergeTime = Math.max(maxMergeTime, timeToMerge);
                minMergeTime = Math.min(minMergeTime, timeToMerge);

                const { additions, deletions } = await fetchPRDetails(owner, repo, pr.number);
                const linesChanged = additions + deletions;
                totalLinesChanged += linesChanged;
                maxLinesChanged = Math.max(maxLinesChanged, linesChanged);
                minLinesChanged = Math.min(minLinesChanged, linesChanged);

                prDetails.push({
                    number: pr.number,
                    title: pr.title,
                    timeToMerge: parseFloat(timeToMerge.toFixed(2)),
                    linesChanged: {
                        added: additions,
                        deleted: deletions,
                    },
                });
            }

            const averageMergeTime = filteredPRs.length > 0 ? totalMergeTime / filteredPRs.length : 0;
            const averageLinesChanged = filteredPRs.length > 0 ? totalLinesChanged / filteredPRs.length : 0;

            results.push({
                Repository: `${owner}/${repo}`,
                startDate: startDate,
                endDate: endDate,
                PRs: prDetails,
                averageTimeToMerge: parseFloat(averageMergeTime.toFixed(2)),
                minTimeToMerge: parseFloat(minMergeTime.toFixed(2)),
                maxTimeToMerge: parseFloat(maxMergeTime.toFixed(2)),
                deviationMinFromAverage: parseFloat((averageMergeTime - minMergeTime).toFixed(2)),
                deviationMaxFromAverage: parseFloat((maxMergeTime - averageMergeTime).toFixed(2)),
                averageLinesChanged: parseFloat(averageLinesChanged.toFixed(0)),
                maxLinesChanged: maxLinesChanged,
                minLinesChanged: minLinesChanged,
            });

            if (outputFormat === 'console') {
                log("");
                log(chalk.bold.bgYellowBright(`Pull Requests for ${owner}/${repo} (Time interval from ${startDate} to ${endDate}):`));
                log("");

                // Table header
                const header = [
                    chalk.bold('PR #'),
                    chalk.bold('Title'),
                    chalk.bold('Time to Merge (min)'),
                    chalk.bold('Lines Changed'),
                    chalk.bold('Added'),
                    chalk.bold('Deleted')
                ];
                const rows = [header];

                // Table rows
                prDetails.forEach(pr => {
                    rows.push([
                        pr.number.toString().padEnd(6),
                        pr.title.length > 40 ? pr.title.slice(0, 37) + '...' : pr.title.padEnd(40),
                        pr.timeToMerge.toString().padEnd(18),
                        (pr.linesChanged.added + pr.linesChanged.deleted).toString().padEnd(13),
                        pr.linesChanged.added.toString().padEnd(6),
                        pr.linesChanged.deleted.toString().padEnd(7)
                    ]);
                });

                // Print table
                rows.forEach(row => {
                    log(row.join(' | '));
                });

                log("");
                log(chalk.cyan(`Average time to merge for ${owner}/${repo}: ${(averageMergeTime/60).toFixed(2)} hours`));
                log(chalk.cyan(`Minimum time to merge for ${owner}/${repo}: ${(minMergeTime/60).toFixed(2)} hours`));
                log(chalk.cyan(`Maximum time to merge for ${owner}/${repo}: ${(maxMergeTime/60).toFixed(2)} hours`));
                log(chalk.greenBright(`Minimum deviation from average time to merge: ${((averageMergeTime - minMergeTime)/60).toFixed(2)} hours`));
                log(chalk.greenBright(`Maximum deviation from average time to merge: ${((maxMergeTime - averageMergeTime)/60).toFixed(2)} hours`));
                log("");
                log(chalk.cyan(`Average lines changed for ${owner}/${repo}: ${averageLinesChanged.toFixed(0)}`));
                log(chalk.cyan(`Minimum lines changed for ${owner}/${repo}: ${minLinesChanged}`));
                log(chalk.cyan(`Maximum lines changed for ${owner}/${repo}: ${maxLinesChanged}`));
            }
        } catch (error) {
            log(chalk.bgRed(`Error fetching pull requests for ${owner}/${repo}:`, error.message));
        }
    }

    if (outputFormat === 'json') {
        const outputFileName = 'output.json';
        fs.writeFileSync(outputFileName, JSON.stringify(results, null, 2));
        console.log(`Results written to ${outputFileName}`);
    } else if (outputFormat === 'csv') {
        const outputFileName = 'output.csv';
        const csvHeaders = [
            'repository_name',
            'starttime',
            'endtime',
            'number_of_prs',
            'average_time_to_merge',
            'min_time_to_merge',
            'max_time_to_merge',
            'average_lines_changed',
            'min_lines_changed',
            'max_lines_Changed'
        ];

        const csvRows = results.map(result => {
            return [
                result.Repository,
                result.startDate,
                result.endDate,
                result.PRs.length,
                result.averageTimeToMerge,
                result.minTimeToMerge,
                result.maxTimeToMerge,
                result.averageLinesChanged,
                result.minLinesChanged,
                result.maxLinesChanged
            ].join(',');
        });

        const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');
        fs.writeFileSync(outputFileName, csvContent);
        log("")
        log(chalk.gray(`Results written to ${outputFileName}`));
    }
}

main();
