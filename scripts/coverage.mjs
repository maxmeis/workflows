import { globSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pattern = 'actions/*/src/**/*.mjs';
const sources = globSync(pattern, { cwd: root });
if (sources.length === 0) throw new Error('No action source files found for coverage');
mkdirSync(resolve(root, 'coverage'), { recursive: true });

const result = spawnSync(process.execPath, [
  '--test',
  '--experimental-test-coverage',
  `--test-coverage-include=${pattern}`,
  '--test-coverage-lines=100',
  '--test-coverage-branches=100',
  '--test-coverage-functions=100',
  '--test-reporter=spec',
  '--test-reporter-destination=stdout',
  '--test-reporter=lcov',
  '--test-reporter-destination=coverage/lcov.info',
], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const report = readFileSync(resolve(root, 'coverage/lcov.info'), 'utf8');
const reported = new Set([...report.matchAll(/^SF:(.+)$/gm)]
  .map((match) => resolve(root, match[1].trim())));
const missing = sources.filter((source) => !reported.has(resolve(root, source)));
if (missing.length > 0) {
  console.error(`Action source files missing from coverage:\n${missing.join('\n')}`);
  process.exit(1);
}
console.log(`All ${sources.length} action source files meet 100% coverage thresholds.`);
