import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:https';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const entrypoint = resolve(testDir, '../src/index.mjs');
const certificate = resolve(testDir, 'fixtures/localhost-cert.pem');
const key = resolve(testDir, 'fixtures/localhost-key.pem');
const token = 'local-test-token-do-not-log';
const path = '/repos/octo/example/pulls/7';

const commit = (message, sha) => ({ sha, commit: { message } });
const pull = (title, count, head = 'head-sha', base = 'base-sha') => ({
  title, commits: count, head: { sha: head }, base: { sha: base },
});

async function runProcess(env) {
  const child = spawn(process.execPath, [entrypoint], {
    env: { ...process.env, ...env, NODE_EXTRA_CA_CERTS: certificate },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000);
  try {
    const { code, signal } = await new Promise((fulfill, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => fulfill({ code, signal }));
    });
    assert.equal(signal, null, 'action process timed out or was killed');
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}

async function fixture(t, {
  title = 'docs: clarify usage',
  messages = ['docs: clarify usage'],
  eventName = 'pull_request',
  eventHead = 'head-sha',
  initial,
  final,
  status = 200,
  commitsOverride,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pr-title-e2e-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const eventPath = join(directory, 'event.json');
  const outputPath = join(directory, 'output');
  const summaryPath = join(directory, 'summary');
  await Promise.all([
    writeFile(eventPath, JSON.stringify({ number: 7, pull_request: { head: { sha: eventHead } } })),
    writeFile(outputPath, ''),
    writeFile(summaryPath, ''),
  ]);

  const requests = [];
  const server = createServer({ key: readFileSync(key), cert: readFileSync(certificate) }, (request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    response.setHeader('content-type', 'application/json');
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end(JSON.stringify({ message: 'bad token' }));
      return;
    }
    if (status !== 200) {
      response.writeHead(status).end(JSON.stringify({ message: 'API unavailable' }));
      return;
    }
    const url = new URL(request.url, 'https://localhost');
    if (url.pathname === path) {
      const reads = requests.filter(({ url: seen }) => seen === path).length;
      response.writeHead(200).end(JSON.stringify(reads === 1
        ? initial ?? pull(title, messages.length)
        : final ?? initial ?? pull(title, messages.length)));
      return;
    }
    if (url.pathname === `${path}/commits`) {
      const page = Number(url.searchParams.get('page'));
      const perPage = Number(url.searchParams.get('per_page'));
      const all = commitsOverride ?? messages.map((message, index) => commit(message, `sha-${index}`));
      response.writeHead(200).end(JSON.stringify(all.slice((page - 1) * perPage, page * perPage)));
      return;
    }
    response.writeHead(404).end('{}');
  });
  t.after(() => new Promise((fulfill) => server.close(fulfill)));
  await new Promise((fulfill, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', fulfill);
  });

  const address = server.address();
  const result = await runProcess({
    GITHUB_ACTIONS: 'true',
    GITHUB_API_URL: `https://127.0.0.1:${address.port}`,
    GITHUB_EVENT_NAME: eventName,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: 'octo/example',
    INPUT_TOKEN: token,
    GITHUB_OUTPUT: outputPath,
    GITHUB_STEP_SUMMARY: summaryPath,
  });
  return {
    ...result,
    requests,
    output: await readFile(outputPath, 'utf8'),
    summary: await readFile(summaryPath, 'utf8'),
  };
}

for (const scenario of [
  { name: 'none on pull_request', title: 'docs: clarify usage', messages: ['docs: clarify usage'], release: 'none' },
  { name: 'patch on pull_request_target', title: 'fix(api): handle null', messages: ['fix: handle null'], eventName: 'pull_request_target', release: 'patch' },
  { name: 'minor on pull_request', title: 'feat: add export', messages: ['feat: add export'], release: 'minor' },
  { name: 'major on pull_request', title: 'feat!: replace API', messages: ['feat: replace API\n\nBREAKING CHANGE: migrate clients'], release: 'major' },
]) {
  test(`E2E accepts ${scenario.name}`, async (t) => {
    const result = await fixture(t, scenario);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`${scenario.release} impact`));
    assert.equal(result.stderr, '');
    assert.equal(result.output, `release=${scenario.release}\ncommit-count=1\n`);
    assert.match(result.summary, new RegExp(`Release impact: \\*\\*${scenario.release}\\*\\*`));
    assert.equal(result.requests.length, 3);
    assert.ok(result.requests.every(({ authorization }) => authorization === `Bearer ${token}`));
    assert.doesNotMatch(result.stdout + result.stderr + result.summary, /local-test-token-do-not-log/);
  });
}

for (const scenario of [
  { name: 'hidden feature under docs title', title: 'docs: update guide', messages: ['feat: add export'], error: /commits require minor/ },
  { name: 'missing breaking marker', title: 'feat: replace API', messages: ['feat: replace API\n\nBREAKING CHANGE: migrate clients'], error: /commits require major/ },
  { name: 'false breaking claim', title: 'feat!: add export', messages: ['feat: add export'], error: /declares major/ },
  { name: 'malformed commit', title: 'docs: update guide', messages: ['Feature: malformed commit'], error: /Invalid Conventional Commit/ },
  { name: 'API authentication failure', status: 403, error: /HTTP 403/ },
  { name: 'missing commit record', initial: pull('docs: clarify usage', 2), commitsOverride: [commit('docs: clarify usage', 'sha-0')], error: /incomplete or invalid commit page/ },
  { name: 'changed PR title during collection', final: pull('feat: changed title', 1), error: /PR changed while commits were being checked/ },
  { name: 'stale event head', eventHead: 'old-head', error: /PR head changed since this workflow was triggered/ },
]) {
  test(`E2E rejects ${scenario.name}`, async (t) => {
    const result = await fixture(t, scenario);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stderr, scenario.error);
    assert.match(result.stderr, /^::error::/);
    assert.equal(result.output, '');
    assert.equal(result.summary, '');
    assert.doesNotMatch(result.stdout + result.stderr, /local-test-token-do-not-log/);
  });
}

test('E2E reads a later page and respects the strongest breaking commit', async (t) => {
  const messages = Array.from({ length: 100 }, (_, index) => `docs: update paragraph ${index}`);
  messages.push('fix!: remove old API');
  const result = await fixture(t, { title: 'fix!: remove old API', messages });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.output, 'release=major\ncommit-count=101\n');
  const pages = result.requests.filter(({ url }) => url.includes('/commits?'));
  assert.equal(pages.length, 2);
  assert.ok(pages.every(({ url }) => url.includes('per_page=100')));
});

test('E2E escapes untrusted error text as one workflow annotation', async (t) => {
  const result = await fixture(t, {
    title: 'docs: update guide',
    messages: ['bad%::warning::\n::set-output name=oops::bad'],
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^::error::Commit sha-0: Invalid Conventional Commit header:/);
  assert.match(result.stderr, /bad%25::warning::/);
  assert.doesNotMatch(result.stderr, /\n::set-output/);
  assert.equal(result.output, '');
});
