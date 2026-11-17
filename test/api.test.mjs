import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPullRequestSnapshot } from '../actions/pr-title/src/index.mjs';

const apiUrl = 'https://api.example.test';
const owner = 'octo';
const repo = 'project';
const number = 17;
const endpoint = `${apiUrl}/repos/${owner}/${repo}/pulls/${number}`;

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function pr({ title = 'feat: add feature', head = 'head-sha', base = 'base-sha', commits = 1 } = {}) {
  return { title, head: { sha: head }, base: { sha: base }, commits };
}

function apiMock({ initial = pr(), pages = [[{ sha: 'c1', commit: { message: 'feat: add feature' } }]], final = initial, failAt } = {}) {
  const calls = [];
  const fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    calls.push({ url, options });
    if (failAt?.(url, calls.length)) return response({ message: 'denied' }, 403);
    if (url.pathname === `/repos/${owner}/${repo}/pulls/${number}`) {
      return response(calls.filter((call) => call.url.pathname === url.pathname).length === 1 ? initial : final);
    }
    if (url.pathname === `/repos/${owner}/${repo}/pulls/${number}/commits`) {
      return response(pages[Number(url.searchParams.get('page') ?? 1) - 1] ?? []);
    }
    return response({ message: `unexpected URL: ${url}` }, 404);
  };
  return { fetch, calls };
}

const options = (fetchImpl, overrides = {}) => ({
  fetchImpl, apiUrl, token: 'test-token', owner, repo, number, expectedHead: 'head-sha', ...overrides,
});

test('fetches a PR and its commits, returning normalized metadata', async () => {
  const mock = apiMock();
  const result = await fetchPullRequestSnapshot(options(mock.fetch));
  assert.deepEqual(result, {
    title: 'feat: add feature',
    commits: [{ sha: 'c1', message: 'feat: add feature' }],
    head: 'head-sha',
    base: 'base-sha',
  });
  assert.equal(mock.calls.filter(({ url }) => url.href === endpoint).length, 2);
  assert.ok(mock.calls.every(({ options: request }) => request.headers?.Authorization === 'Bearer test-token'));
});

test('paginates beyond 100 commits and returns every commit in order', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    sha: `sha-${index}`, commit: { message: `fix: patch ${index}` },
  }));
  const secondPage = [{ sha: 'sha-100', commit: { message: 'docs: clarify usage' } }];
  const stablePr = pr({ commits: 101 });
  const mock = apiMock({ initial: stablePr, pages: [firstPage, secondPage], final: stablePr });
  const result = await fetchPullRequestSnapshot(options(mock.fetch));
  assert.equal(result.commits.length, 101);
  assert.equal(result.commits[100].sha, 'sha-100');
  const commitCalls = mock.calls.filter(({ url }) => url.pathname.endsWith('/commits'));
  assert.equal(commitCalls.length, 2);
  assert.deepEqual(commitCalls.map(({ url }) => url.searchParams.get('page')), ['1', '2']);
});

test('accepts exactly 250 commits across three full-size API pages', async () => {
  const commits = Array.from({ length: 250 }, (_, index) => ({
    sha: `sha-${index}`, commit: { message: `docs: note ${index}` },
  }));
  const stablePr = pr({ title: 'docs: update guides', commits: 250 });
  const mock = apiMock({
    initial: stablePr,
    pages: [commits.slice(0, 100), commits.slice(100, 200), commits.slice(200)],
    final: stablePr,
  });
  const result = await fetchPullRequestSnapshot(options(mock.fetch));
  assert.equal(result.commits.length, 250);
  assert.deepEqual(mock.calls.filter(({ url }) => url.pathname.endsWith('/commits'))
    .map(({ url }) => url.searchParams.get('page')), ['1', '2', '3']);
});

test('fails closed when a PR exceeds the endpoint 250 commit limit', async () => {
  const tooLarge = pr({ commits: 251 });
  const mock = apiMock({ initial: tooLarge, final: tooLarge });
  await assert.rejects(fetchPullRequestSnapshot(options(mock.fetch)), /250|limit|too many/i);
});

test('rejects a stale pull_request event head SHA', async () => {
  const mock = apiMock();
  await assert.rejects(
    fetchPullRequestSnapshot(options(mock.fetch, { expectedHead: 'old-event-head' })),
    /head|stale|event/i,
  );
});

test('rejects a changed PR head, base, title, or commit count during collection', async (t) => {
  const changes = [
    ['head', pr({ head: 'new-head' })],
    ['base', pr({ base: 'release-sha' })],
    ['title', pr({ title: 'fix: changed title' })],
    ['commit count', pr({ commits: 2 })],
  ];
  for (const [name, final] of changes) {
    await t.test(name, async () => {
      const mock = apiMock({ initial: pr(), final });
      await assert.rejects(fetchPullRequestSnapshot(options(mock.fetch)), /changed|stale|snapshot|head|title|base|commit/i);
    });
  }
});

test('rejects incomplete commit pagination instead of validating a partial history', async () => {
  const declared = pr({ commits: 2 });
  const mock = apiMock({ initial: declared, pages: [[{ sha: 'only-one', commit: { message: 'feat: add feature' } }]], final: declared });
  await assert.rejects(fetchPullRequestSnapshot(options(mock.fetch)), /commit|incomplete|count|missing/i);
});

test('rejects duplicate SHAs and malformed commit records', async (t) => {
  await t.test('duplicate SHA', async () => {
    const declared = pr({ commits: 2 });
    const repeated = { sha: 'same-sha', commit: { message: 'feat: add feature' } };
    const mock = apiMock({ initial: declared, pages: [[repeated, repeated]], final: declared });
    await assert.rejects(fetchPullRequestSnapshot(options(mock.fetch)), /duplicate|invalid/i);
  });
  await t.test('missing commit message', async () => {
    const declared = pr();
    const mock = apiMock({ initial: declared, pages: [[{ sha: 'c1', commit: {} }]], final: declared });
    await assert.rejects(fetchPullRequestSnapshot(options(mock.fetch)), /invalid|commit/i);
  });
});

test('fails closed on authentication errors, malformed API data, and network failures', async (t) => {
  await t.test('authentication error', async () => {
    const mock = apiMock({ failAt: (_url, call) => call === 1 });
    await assert.rejects(fetchPullRequestSnapshot(options(mock.fetch)), /403|denied|API|request/i);
  });
  await t.test('malformed pull request response', async () => {
    const mock = apiMock({ initial: { title: 'feat: missing metadata' } });
    await assert.rejects(fetchPullRequestSnapshot(options(mock.fetch)), /incomplete|invalid|head|base|commit|API/i);
  });
  await t.test('network failure', async () => {
    const fetch = async () => { throw new Error('socket closed'); };
    await assert.rejects(fetchPullRequestSnapshot(options(fetch)), /socket|fetch|network/i);
  });
});
