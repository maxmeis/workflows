# Repository instructions

## Required automation

All maintained CI and repository automation must use Woodpecker workflows in `.woodpecker/`. Do not add GitHub Actions workflows. Keep this inventory current: every new or changed automation check must have its own section below describing its purpose, source of truth, trigger conditions and inputs, and validation. Update the equivalent section in `CLAUDE.md` at the same time.

Use the repository's declared package manager, pnpm (`packageManager` in `package.json`), and honor the lockfile. Do not introduce npm or Yarn commands or dependencies in CI.

### PR title (`.woodpecker/pr-title.yaml`)

- Purpose: compare the PR title's release impact with its commits, including after title or metadata edits.
- Source: `scripts/pr-title.mjs`, using policy and GitHub API code in `actions/pr-title/src/`.
- Triggers and inputs: `pull_request` and `pull_request_metadata`; reads Woodpecker PR context and the public GitHub API. Keep credentials out of untrusted PR workflows.
- Validation: `node --check` and `pnpm test:coverage`; command behavior is covered by `actions/pr-title/test/woodpecker.test.mjs`.

### Node 24 tests (`.woodpecker/test-node-24.yaml`)

- Purpose: validate syntax and run the full test and coverage suite on Node 24.
- Source: Node's built-in test runner, package scripts in `package.json`, and `scripts/coverage.mjs`.
- Triggers and inputs: pull requests, pushes to `main`, and manual runs; no external credentials or dependencies.
- Validation: `pnpm test` and `pnpm test:coverage`; coverage must remain at 100% for lines, branches, and functions in shipped checker source.

### Node 26 tests (`.woodpecker/test-node-26.yaml`)

- Purpose: run the same syntax, test, and coverage checks on Node 26.
- Source: the same package scripts and coverage gate as Node 24.
- Triggers and inputs: pull requests, pushes to `main`, and manual runs; no external credentials or dependencies.
- Validation: `pnpm test` and `pnpm test:coverage`.

### Woodpecker workflow lint (`.woodpecker/lint.yaml`)

- Purpose: catch invalid or warning-producing Woodpecker workflow configuration.
- Source: Woodpecker CLI v3.20.1, downloaded with a verified SHA-256 checksum.
- Triggers and inputs: pull requests, pushes to `main`, and manual runs; lints `.woodpecker/` in strict mode.
- Validation: `woodpecker-cli --disable-update-check lint --strict .woodpecker/`.

See [CI documentation](docs/ci/README.md) for required status contexts, branch protection, and workflow operation. See [README.md](README.md) for local development commands.
