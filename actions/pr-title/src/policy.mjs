const TYPES = new Set([
  'build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf',
  'refactor', 'revert', 'style', 'test',
]);

const RELEASE_RANK = { none: 0, patch: 1, minor: 2, major: 3 };
const HEADER = /^([a-z]+)(?:\(([^()\r\n]+)\))?(!)?: ([^\r\n]+)$/;
const FOOTER = /^(?:BREAKING CHANGE|BREAKING-CHANGE): (\S.*)$/;
const BREAKING_HEADER = /^(?:BREAKING CHANGE|BREAKING-CHANGE):/;
const ANY_FOOTER = /^(?:[A-Za-z][A-Za-z-]*|BREAKING CHANGE): \S/;

function parseHeader(header) {
  const match = HEADER.exec(header);
  if (!match || !TYPES.has(match[1]) ||
      (match[2] !== undefined && match[2].trim() !== match[2]) ||
      match[4].trim() !== match[4]) {
    throw new Error(`Invalid Conventional Commit header: ${JSON.stringify(header)}`);
  }
  return {
    type: match[1],
    scope: match[2] ?? null,
    marker: Boolean(match[3]),
  };
}

function breakingFooter(lines) {
  // A footer block follows a blank line and starts with a trailer. Trailer
  // values may span unindented lines, so only trailer headers are significant.
  for (let start = 2; start < lines.length; start += 1) {
    if (lines[start - 1] !== '' ||
        !(ANY_FOOTER.test(lines[start]) || BREAKING_HEADER.test(lines[start]))) continue;
    for (const line of lines.slice(start)) {
      if (BREAKING_HEADER.test(line) && !FOOTER.test(line)) {
        throw new Error('BREAKING CHANGE footer requires a nonempty description');
      }
    }
    return lines.slice(start).some((line) => FOOTER.test(line));
  }
  return false;
}

function impact(type, breaking) {
  if (breaking) return 'major';
  if (type === 'feat') return 'minor';
  if (type === 'fix' || type === 'perf') return 'patch';
  return 'none';
}

export function parseCommit(message) {
  if (typeof message !== 'string' || message.length === 0) {
    throw new Error('Commit message must be a nonempty string');
  }
  const lines = message.replace(/\r\n/g, '\n').split('\n');
  const { type, scope, marker } = parseHeader(lines[0]);
  if (lines.length > 1 && lines[1] !== '') {
    throw new Error('Commit body or footer must start after a blank line');
  }
  const breaking = breakingFooter(lines) || marker;
  return { type, scope, breaking, release: impact(type, breaking) };
}

export function validatePullRequest({ title, commits }) {
  if (typeof title !== 'string' || /[\r\n]/.test(title)) {
    throw new Error('PR title must be a single Conventional Commit header');
  }
  const { type, marker } = parseHeader(title);
  const titleRelease = impact(type, marker);
  if (!Array.isArray(commits) || commits.length === 0) {
    throw new Error('PR has no commits to validate');
  }
  const parsed = commits.map((commit, index) => {
    if (!commit || typeof commit.sha !== 'string' || !commit.sha ||
        typeof commit.message !== 'string') {
      throw new Error(`Commit ${index + 1} has missing SHA or message`);
    }
    try {
      return { sha: commit.sha, ...parseCommit(commit.message) };
    } catch (error) {
      throw new Error(`Commit ${commit.sha.slice(0, 12)}: ${error.message}`, { cause: error });
    }
  });
  const release = parsed.reduce((highest, commit) =>
    RELEASE_RANK[commit.release] > RELEASE_RANK[highest] ? commit.release : highest,
  'none');
  if (release !== titleRelease) {
    const strongest = parsed.filter((commit) => commit.release === release)
      .map((commit) => commit.sha.slice(0, 12)).join(', ');
    throw new Error(
      `PR title declares ${titleRelease} release impact, but commits require ${release}` +
      ` (strongest: ${strongest}). Use a title type or ! marker with matching impact.`,
    );
  }
  return { release, titleRelease, commits: parsed };
}
