import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPullRequestSnapshot } from '../actions/pr-title/src/index.mjs';
import { validatePullRequest } from '../actions/pr-title/src/policy.mjs';

export async function runWoodpeckerCheck({
  env = process.env,
  fetchImpl = globalThis.fetch,
  log = console.log,
} = {}) {
  if (env.CI_PIPELINE_EVENT !== 'pull_request' &&
      env.CI_PIPELINE_EVENT !== 'pull_request_metadata') {
    throw new Error('PR title check requires a Woodpecker pull request event');
  }

  const repository = env.CI_REPO;
  const match = typeof repository === 'string' &&
    /^([\w.-]+)\/([\w.-]+)$/.exec(repository);
  const numberText = env.CI_COMMIT_PULL_REQUEST;
  const number = typeof numberText === 'string' && /^[1-9]\d*$/.test(numberText)
    ? Number(numberText)
    : NaN;
  const expectedHead = env.CI_COMMIT_SHA;
  if (!match || !Number.isSafeInteger(number) ||
      typeof expectedHead !== 'string' || !/^[a-f\d]{40}$/i.test(expectedHead)) {
    throw new Error('Missing or invalid Woodpecker pull request context');
  }

  const snapshot = await fetchPullRequestSnapshot({
    fetchImpl,
    apiUrl: env.GITHUB_API_URL ?? 'https://api.github.com',
    token: env.GITHUB_TOKEN || undefined,
    owner: match[1],
    repo: match[2],
    number,
    expectedHead,
  });
  const result = validatePullRequest(snapshot);
  log(`release=${result.release}`);
  log(`commit-count=${result.commits.length}`);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runWoodpeckerCheck().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
