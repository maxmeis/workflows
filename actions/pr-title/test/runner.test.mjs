import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runAction } from '../src/index.mjs';

const apiUrl = 'https://api.example.test';
const prUrl = `${apiUrl}/repos/octo/project/pulls/7`;
const actionEntry = fileURLToPath(new URL('../src/index.mjs', import.meta.url));

function setup(event, eventName = 'pull_request') {
  const dir = mkdtempSync(join(tmpdir(), 'pr-title-runner-'));
  const eventPath = join(dir, 'event.json');
  const outputPath = join(dir, 'output.txt');
  const summaryPath = join(dir, 'summary.md');
  if (typeof event === 'string') writeFileSync(eventPath, event);
  else writeFileSync(eventPath, JSON.stringify(event));
  const env = {
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_EVENT_NAME: eventName,
    GITHUB_REPOSITORY: 'octo/project',
    GITHUB_API_URL: apiUrl,
    INPUT_TOKEN: 'runner-test-secret',
    GITHUB_OUTPUT: outputPath,
    GITHUB_STEP_SUMMARY: summaryPath,
  };
  return { dir, eventPath, outputPath, summaryPath, env };
}

function prEvent(head = 'event-head') {
  return { number: 7, pull_request: { head: { sha: head } } };
}

function fetchMock({ title = 'feat: add feature', message = 'feat: add feature', head = 'event-head' } = {}) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const payload = url.endsWith('/commits?per_page=100&page=1')
      ? [{ sha: 'c1', commit: { message } }]
      : { title, head: { sha: head }, base: { sha: 'base-sha' }, commits: 1 };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  return { fetchImpl, calls };
}

test('runs for pull_request and pull_request_target, writing output and summary', async (t) => {
  for (const eventName of ['pull_request', 'pull_request_target']) {
    await t.test(eventName, async () => {
      const files = setup(prEvent(), eventName);
      try {
        const mock = fetchMock();
        const result = await runAction({ env: files.env, fetchImpl: mock.fetchImpl });
        assert.equal(result.release, 'minor');
        assert.equal(readFileSync(files.outputPath, 'utf8'), 'release=minor\ncommit-count=1\n');
        assert.match(readFileSync(files.summaryPath, 'utf8'), /Release impact: \*\*minor\*\*; commits checked: \*\*1\*\*/);
        assert.equal(mock.calls.length, 3);
        assert.ok(mock.calls.every(({ url }) => url.startsWith(prUrl)));
        assert.ok(mock.calls.every(({ init }) => init.headers.Authorization === 'Bearer runner-test-secret'));
      } finally {
        rmSync(files.dir, { recursive: true, force: true });
      }
    });
  }
});

test('rejects non-PR event names and malformed event payloads before API access', async (t) => {
  await t.test('non-PR event', async () => {
    const files = setup(prEvent(), 'push');
    try {
      let fetchCalled = false;
      await assert.rejects(runAction({ env: files.env, fetchImpl: async () => { fetchCalled = true; } }), /pull request event/i);
      assert.equal(fetchCalled, false);
    } finally {
      rmSync(files.dir, { recursive: true, force: true });
    }
  });
  await t.test('invalid PR payload', async () => {
    const files = setup({ number: 7, pull_request: { head: {} } });
    try {
      let fetchCalled = false;
      await assert.rejects(runAction({ env: files.env, fetchImpl: async () => { fetchCalled = true; } }), /invalid pull request event/i);
      assert.equal(fetchCalled, false);
    } finally {
      rmSync(files.dir, { recursive: true, force: true });
    }
  });
  await t.test('invalid JSON', async () => {
    const files = setup('{not-json');
    try {
      await assert.rejects(runAction({ env: files.env }), SyntaxError);
    } finally {
      rmSync(files.dir, { recursive: true, force: true });
    }
  });
  const malformedEvents = [
    ['missing PR object', { number: 7 }],
    ['invalid PR number', { ...prEvent(), number: 0 }],
    ['missing PR head', { number: 7, pull_request: {} }],
    ['non-string head SHA', { number: 7, pull_request: { head: { sha: 42 } } }],
  ];
  for (const [name, event] of malformedEvents) {
    await t.test(name, async () => {
      const files = setup(event);
      try {
        let fetchCalled = false;
        await assert.rejects(runAction({ env: files.env, fetchImpl: async () => { fetchCalled = true; } }), /invalid pull request event|GitHub API context/i);
        assert.equal(fetchCalled, false);
      } finally {
        rmSync(files.dir, { recursive: true, force: true });
      }
    });
  }
  await t.test('extra repository segments', async () => {
    const files = setup(prEvent());
    try {
      files.env.GITHUB_REPOSITORY = 'octo/project/extra';
      await assert.rejects(runAction({ env: files.env }), /invalid pull request event/i);
    } finally {
      rmSync(files.dir, { recursive: true, force: true });
    }
  });
});

test('requires an event path, token, and repository context', async (t) => {
  for (const key of ['GITHUB_EVENT_PATH', 'INPUT_TOKEN', 'GITHUB_REPOSITORY']) {
    await t.test(key, async () => {
      const files = setup(prEvent());
      try {
        delete files.env[key];
        await assert.rejects(runAction({ env: files.env }), /missing GitHub Actions event/i);
      } finally {
        rmSync(files.dir, { recursive: true, force: true });
      }
    });
  }
});

test('does not write outputs when the title release impact mismatches commits', async () => {
  const files = setup(prEvent());
  try {
    const mock = fetchMock({ title: 'docs: update guide', message: 'feat: add feature' });
    await assert.rejects(runAction({ env: files.env, fetchImpl: mock.fetchImpl }), /release|minor/i);
    assert.equal(mock.calls.length, 3);
    assert.throws(() => readFileSync(files.outputPath), /ENOENT/);
    assert.throws(() => readFileSync(files.summaryPath), /ENOENT/);
  } finally {
    rmSync(files.dir, { recursive: true, force: true });
  }
});

test('supports omitted output and summary paths and the default GitHub API URL', async (t) => {
  const files = setup(prEvent());
  try {
    delete files.env.GITHUB_OUTPUT;
    delete files.env.GITHUB_STEP_SUMMARY;
    delete files.env.GITHUB_API_URL;
    const mock = fetchMock();
    t.mock.method(globalThis, 'fetch', mock.fetchImpl);
    const result = await runAction({ env: files.env });
    assert.equal(result.release, 'minor');
    assert.ok(mock.calls.every(({ url }) => url.startsWith('https://api.github.com/')));
    assert.throws(() => readFileSync(files.outputPath), /ENOENT/);
    assert.throws(() => readFileSync(files.summaryPath), /ENOENT/);
  } finally {
    rmSync(files.dir, { recursive: true, force: true });
  }
});

test('escapes workflow error annotations and never prints the token', () => {
  const files = setup(prEvent());
  try {
    const preloadPath = join(files.dir, 'mock-fetch.mjs');
    writeFileSync(preloadPath,
      "globalThis.fetch = async () => { throw new Error(process.env.TEST_FETCH_ERROR); };\n");
    const token = 'runner-secret-must-not-leak';
    const result = spawnSync(process.execPath, ['--import', preloadPath, actionEntry], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...files.env,
        INPUT_TOKEN: token,
        TEST_FETCH_ERROR: 'bad%\n::warning::injected',
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /::error::bad%25%0A::warning::injected/);
    assert.ok(!result.stderr.includes('\n::warning::injected'));
    assert.ok(!`${result.stdout}${result.stderr}`.includes(token));
  } finally {
    rmSync(files.dir, { recursive: true, force: true });
  }
});
