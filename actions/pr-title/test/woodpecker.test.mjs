import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runWoodpeckerCheck } from '../../../scripts/pr-title.mjs';

const entry = fileURLToPath(new URL('../../../scripts/pr-title.mjs', import.meta.url));
const certificate = fileURLToPath(new URL('fixtures/localhost-cert.pem', import.meta.url));
const key = fileURLToPath(new URL('fixtures/localhost-key.pem', import.meta.url));
const sha = 'a'.repeat(40);
const env = {
  CI_PIPELINE_EVENT: 'pull_request',
  CI_REPO: 'octo/project',
  CI_COMMIT_PULL_REQUEST: '7',
  CI_COMMIT_SHA: sha,
};

function mockFetch({ title = 'feat: add feature', message = 'feat: add feature',
  head = sha, status = 200 } = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    const data = url.includes('/commits?')
      ? [{ sha: 'commit-1', commit: { message } }]
      : { title, head: { sha: head }, base: { sha: 'base' }, commits: 1 };
    return new Response(JSON.stringify(data), { status });
  };
  return { fetchImpl, requests };
}

test('Woodpecker PR and metadata events use the shared checker without a token', async () => {
  for (const event of ['pull_request', 'pull_request_metadata']) {
    const mock = mockFetch();
    const lines = [];
    const result = await runWoodpeckerCheck({
      env: { ...env, CI_PIPELINE_EVENT: event },
      fetchImpl: mock.fetchImpl,
      log: (line) => lines.push(line),
    });
    assert.equal(result.release, 'minor');
    assert.deepEqual(lines, ['release=minor', 'commit-count=1']);
    assert.equal(mock.requests.length, 3);
    assert.ok(mock.requests.every(({ options }) =>
      !Object.hasOwn(options.headers, 'Authorization')));
  }
});

test('Woodpecker uses an optional token and API URL', async () => {
  const mock = mockFetch();
  await runWoodpeckerCheck({
    env: { ...env, GITHUB_TOKEN: 'secret', GITHUB_API_URL: 'https://git.example.test/api/v3' },
    fetchImpl: mock.fetchImpl,
    log: () => {},
  });
  assert.ok(mock.requests.every(({ url, options }) =>
    url.startsWith('https://git.example.test/api/v3/repos/octo/project/pulls/7') &&
    options.headers.Authorization === 'Bearer secret'));
});

test('Woodpecker rejects invalid context before API access', async () => {
  const invalid = [
    { CI_PIPELINE_EVENT: 'push' },
    { CI_REPO: '' },
    { CI_REPO: 'octo/project/extra' },
    { CI_REPO: 'bad owner/project' },
    { CI_COMMIT_PULL_REQUEST: '' },
    { CI_COMMIT_PULL_REQUEST: '0' },
    { CI_COMMIT_PULL_REQUEST: '01' },
    { CI_COMMIT_PULL_REQUEST: '1.5' },
    { CI_COMMIT_PULL_REQUEST: '9007199254740992' },
    { CI_COMMIT_SHA: '' },
    { CI_COMMIT_SHA: 'not-a-sha' },
  ];
  for (const change of invalid) {
    let called = false;
    await assert.rejects(runWoodpeckerCheck({
      env: { ...env, ...change },
      fetchImpl: async () => { called = true; },
      log: () => {},
    }), /Woodpecker/);
    assert.equal(called, false, JSON.stringify(change));
  }
});

test('Woodpecker fails for a stale head, API failure, or title mismatch without output', async () => {
  for (const scenario of [
    { head: 'b'.repeat(40) },
    { status: 403 },
    { title: 'docs: update guide' },
  ]) {
    const mock = mockFetch(scenario);
    const lines = [];
    await assert.rejects(runWoodpeckerCheck({
      env,
      fetchImpl: mock.fetchImpl,
      log: (line) => lines.push(line),
    }));
    assert.deepEqual(lines, []);
  }
});

async function runProcess(overrides = {}) {
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ...env,
      ...overrides,
      NODE_EXTRA_CA_CERTS: certificate,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  try {
    const code = await new Promise((fulfill, reject) => {
      child.once('error', reject);
      child.once('close', fulfill);
    });
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

test('Woodpecker CLI checks a public PR through HTTPS and exits on errors', async (t) => {
  const requests = [];
  const server = createServer({
    key: readFileSync(key), cert: readFileSync(certificate),
  }, (request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    response.setHeader('content-type', 'application/json');
    if (request.url.includes('/commits?')) {
      response.end(JSON.stringify([{ sha: 'commit-1', commit: { message: 'fix: patch issue' } }]));
    } else {
      response.end(JSON.stringify({
        title: 'fix: patch issue', head: { sha }, base: { sha: 'base' }, commits: 1,
      }));
    }
  });
  t.after(() => new Promise((fulfill) => server.close(fulfill)));
  await new Promise((fulfill, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', fulfill);
  });
  const apiUrl = `https://127.0.0.1:${server.address().port}`;
  const success = await runProcess({
    CI_PIPELINE_EVENT: 'pull_request_metadata', GITHUB_API_URL: apiUrl, GITHUB_TOKEN: '',
  });
  assert.equal(success.code, 0, success.stderr);
  assert.equal(success.stdout, 'release=patch\ncommit-count=1\n');
  assert.equal(success.stderr, '');
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ authorization }) => authorization === undefined));

  const failure = await runProcess({
    CI_COMMIT_SHA: 'b'.repeat(40), GITHUB_API_URL: apiUrl, GITHUB_TOKEN: '',
  });
  assert.equal(failure.code, 1);
  assert.equal(failure.stdout, '');
  assert.match(failure.stderr, /PR head changed/);
});
