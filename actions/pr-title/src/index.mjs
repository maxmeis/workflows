import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validatePullRequest } from './policy.mjs';

const MAX_COMMITS = 250;

function checkPr(data) {
  if (!data || typeof data.title !== 'string' ||
      !data.head || typeof data.head.sha !== 'string' || !data.head.sha ||
      !data.base || typeof data.base.sha !== 'string' || !data.base.sha ||
      !Number.isSafeInteger(data.commits) || data.commits < 1) {
    throw new Error('GitHub returned incomplete pull request data');
  }
  if (data.commits > MAX_COMMITS) {
    throw new Error(`PR has ${data.commits} commits; the checker supports at most ${MAX_COMMITS}`);
  }
  return {
    title: data.title,
    head: data.head.sha,
    base: data.base.sha,
    count: data.commits,
  };
}

function samePr(a, b) {
  return a.title === b.title && a.head === b.head &&
    a.base === b.base && a.count === b.count;
}

export async function fetchPullRequestSnapshot({
  fetchImpl = globalThis.fetch,
  apiUrl,
  token,
  owner,
  repo,
  number,
  expectedHead,
}) {
  if (typeof fetchImpl !== 'function' || typeof token !== 'string' || !token ||
      typeof apiUrl !== 'string' || !/^https:\/\//.test(apiUrl) ||
      typeof owner !== 'string' || !/^[\w.-]+$/.test(owner) ||
      typeof repo !== 'string' || !/^[\w.-]+$/.test(repo) ||
      !Number.isSafeInteger(number) || number < 1 ||
      typeof expectedHead !== 'string' || !expectedHead) {
    throw new Error('Missing or invalid GitHub API context');
  }

  const baseUrl = `${apiUrl.replace(/\/$/, '')}/repos/${owner}/${repo}/pulls/${number}`;
  async function get(path) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API request failed (HTTP ${response.status})`);
    }
    return response.json();
  }

  const before = checkPr(await get(''));
  if (before.head !== expectedHead) {
    throw new Error('PR head changed since this workflow was triggered; rerun on the latest head');
  }

  const commits = [];
  const seen = new Set();
  for (let page = 1; commits.length < before.count; page += 1) {
    const data = await get(`/commits?per_page=100&page=${page}`);
    if (!Array.isArray(data) || data.length < 1 ||
        data.length > Math.min(100, before.count - commits.length)) {
      throw new Error('GitHub returned an incomplete or invalid commit page');
    }
    for (const item of data) {
      if (!item || typeof item.sha !== 'string' || !item.sha ||
          !item.commit || typeof item.commit.message !== 'string' ||
          seen.has(item.sha)) {
        throw new Error('GitHub returned invalid or duplicate commit data');
      }
      seen.add(item.sha);
      commits.push({ sha: item.sha, message: item.commit.message });
    }
  }

  const after = checkPr(await get(''));
  if (!samePr(before, after)) {
    throw new Error('PR changed while commits were being checked; rerun on the latest head');
  }
  return { title: after.title, commits, head: after.head, base: after.base };
}

function escapeCommand(value) {
  return String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export async function runAction({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!env.GITHUB_EVENT_PATH || !env.INPUT_TOKEN || !env.GITHUB_REPOSITORY) {
    throw new Error('Missing GitHub Actions event, repository, or token');
  }
  if (env.GITHUB_EVENT_NAME !== 'pull_request' &&
      env.GITHUB_EVENT_NAME !== 'pull_request_target') {
    throw new Error('This action requires a pull request event');
  }
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const [owner, repo, extra] = env.GITHUB_REPOSITORY.split('/');
  if (extra || !event.pull_request ||
      !Number.isSafeInteger(event.number) ||
      !event.pull_request.head ||
      typeof event.pull_request.head.sha !== 'string') {
    throw new Error('Invalid pull request event payload');
  }

  const snapshot = await fetchPullRequestSnapshot({
    fetchImpl,
    apiUrl: env.GITHUB_API_URL || 'https://api.github.com',
    token: env.INPUT_TOKEN,
    owner,
    repo,
    number: event.number,
    expectedHead: event.pull_request.head.sha,
  });
  const result = validatePullRequest(snapshot);
  const count = result.commits.length;
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `release=${result.release}\ncommit-count=${count}\n`);
  }
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY,
      `### PR title matches commit release impact\n\n` +
      `Release impact: **${escapeHtml(result.release)}**; commits checked: **${count}**.\n`);
  }
  console.log(`PR title matches ${count} commits (${result.release} impact)`);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runAction().catch((error) => {
    console.error(`::error::${escapeCommand(error.message)}`);
    process.exitCode = 1;
  });
}
