import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommit, validatePullRequest } from '../src/policy.mjs';

const commit = (message, sha = 'abc123') => ({ sha, message });

test('maps Conventional Commit types to their release impact', () => {
  const expected = {
    build: 'none', chore: 'none', ci: 'none', docs: 'none', feat: 'minor',
    fix: 'patch', perf: 'patch', refactor: 'none', revert: 'none',
    style: 'none', test: 'none',
  };

  for (const [type, release] of Object.entries(expected)) {
    assert.deepEqual(parseCommit(`${type}: do the thing`), {
      type, scope: null, breaking: false, release,
    }, type);
  }
});

test('parses scopes, breaking markers, and both breaking footer spellings', () => {
  assert.deepEqual(parseCommit('feat(parser): add arrays'), {
    type: 'feat', scope: 'parser', breaking: false, release: 'minor',
  });
  assert.deepEqual(parseCommit('docs(api)!: rename option'), {
    type: 'docs', scope: 'api', breaking: true, release: 'major',
  });
  assert.equal(parseCommit('chore: remove old option\n\nBREAKING CHANGE: clients must migrate').release, 'major');
  assert.equal(parseCommit('fix(api): rename option\n\nBREAKING-CHANGE: clients must migrate').release, 'major');
});

test('recognizes a multi-line breaking footer and CRLF messages', () => {
  const result = parseCommit('feat(core): replace adapter\r\n\r\nThis changes the adapter behavior.\r\n\r\nBREAKING CHANGE: migrate callers\r\nThe old adapter is removed.');
  assert.equal(result.breaking, true);
  assert.equal(result.release, 'major');
});

test('recognizes breaking trailers after hash-separated reference footers', () => {
  for (const footer of ['Refs #123', 'Closes #456', 'Reviewed-by: Max']) {
    assert.equal(parseCommit(`feat: change API\n\n${footer}\nBREAKING CHANGE: migrate callers`).release, 'major');
    assert.throws(() => validatePullRequest({
      title: 'feat: change API',
      commits: [commit(`feat: change API\n\n${footer}\nBREAKING CHANGE: migrate callers`)],
    }), /major/);
  }
});

test('does not mistake inline prose or a quoted body mention for a breaking footer', () => {
  const inline = parseCommit('docs: explain the BREAKING CHANGE: marker');
  assert.equal(inline.breaking, false);
  assert.equal(parseCommit('docs: update guide\n\nThe phrase BREAKING CHANGE: is shown as an example.').breaking, false);
});

test('rejects malformed headers, unsupported types, and empty footer descriptions', () => {
  for (const message of [
    'Feat: uppercase type', 'feature: unknown type', 'docs:missing space',
    'docs: ', 'docs(): empty scope',
    'docs!:\n\nBREAKING CHANGE: missing description',
  ]) {
    assert.throws(() => parseCommit(message), undefined, message);
  }
});

test('rejects an empty breaking footer marker', () => {
  assert.throws(() => parseCommit('docs: explain migration\n\nBREAKING CHANGE:'), /breaking|footer|invalid/i);
  assert.throws(() => parseCommit('docs: explain migration\n\nBREAKING-CHANGE:  '), /breaking|footer|invalid/i);
});

test('requires a one-line Conventional Commit PR title with ! for breaking changes', () => {
  const okay = validatePullRequest({
    title: 'feat(parser): add arrays', commits: [commit('feat(parser): support arrays')],
  });
  assert.equal(okay.release, 'minor');
  assert.equal(okay.titleRelease, 'minor');

  for (const title of ['ordinary title', 'Feat: bad case', 'feat: ', 'feat: two\nlines', 'feat(core): change\nBREAKING CHANGE: details']) {
    assert.throws(() => validatePullRequest({ title, commits: [commit('feat: valid')] }), undefined, title);
  }
});

test('rejects hidden features behind docs and fix titles that hide a feature', () => {
  assert.throws(
    () => validatePullRequest({ title: 'docs: update docs', commits: [commit('feat: add export')] }),
    /release|minor|feature/i,
  );
  assert.throws(
    () => validatePullRequest({ title: 'fix: correct bug', commits: [commit('feat: add export')] }),
    /release|minor|feature/i,
  );
});

test('requires a breaking PR title when a commit is breaking, including non-feature types', () => {
  for (const message of ['feat!: change API', 'chore: remove option\n\nBREAKING CHANGE: migrate callers']) {
    assert.throws(
      () => validatePullRequest({ title: 'feat: change API', commits: [commit(message)] }),
      /breaking|major/i,
    );
  }
  assert.equal(validatePullRequest({
    title: 'docs!: remove old guide',
    commits: [commit('docs!: remove deprecated guide')],
  }).release, 'major');
});

test('rejects release overclaims, false breaking claims, and missing commits', () => {
  for (const [title, messages] of [
    ['feat: add export', ['docs: correct typo']],
    ['feat!: make breaking API change', ['feat: add safe option']],
    ['fix: repair bug', ['docs: explain behavior']],
  ]) {
    assert.throws(() => validatePullRequest({ title, commits: messages.map(commit) }));
  }
  assert.throws(() => validatePullRequest({ title: 'docs: update docs', commits: [] }), /commit/i);
});

test('uses the highest impact in a mixed commit set', () => {
  const result = validatePullRequest({
    title: 'feat: add feature',
    commits: [commit('docs: clarify usage', '1'), commit('fix: repair edge case', '2'), commit('feat: add feature', '3')],
  });
  assert.equal(result.release, 'minor');
  assert.equal(result.commits.length, 3);

  const breaking = validatePullRequest({
    title: 'feat!: change API',
    commits: [commit('feat: add feature', '1'), commit('docs!: rename API guide', '2')],
  });
  assert.equal(breaking.release, 'major');
});

test('keeps hostile-looking user text as data', () => {
  const hostile = 'docs: $(touch /tmp/should-not-run)';
  const result = validatePullRequest({ title: hostile, commits: [commit(hostile)] });
  assert.equal(result.release, 'none');
});
