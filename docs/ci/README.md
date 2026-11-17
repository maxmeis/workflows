# CI and branch protection

[CI workflow](../../.github/workflows/ci.yml) runs on pull requests (including title edits), pushes to `main`, and manual dispatch. The live GitHub API jobs run on PR events; the local E2E suite and coverage gate run on all CI events.

| Check | Validation |
| --- | --- |
| `Tests (Node 24)` | JavaScript syntax, process E2E tests, and 100% line, branch, and function coverage on the action's runtime. |
| `Tests (Node 26)` | The same suite on Node 26. |
| `Workflow lint` | GitHub Actions syntax and expression checks using checksum-pinned actionlint. |
| `PR title / Validate PR title` | The [shared PR-title check](../../actions/pr-title/README.md), on PR metadata events. |
| `Action E2E` | Execute the candidate action manifest against the real PR; verify outputs and rejected-credential failure. |
| `Reusable workflow E2E / Validate PR title` | Execute the candidate reusable workflow against the real PR. |
| `Reusable workflow outputs` | Verify the reusable workflow forwards valid release and commit-count outputs. |

Node's built-in test framework needs no installation step. There are no runtime or development dependencies. CI uses read-only permissions, pinned action SHAs, and checkout without persisted credentials. Dependabot checks action updates weekly.

## Local checks

Requires Node 24+ and pnpm:

```sh
pnpm test
pnpm test:e2e
pnpm check
pnpm test:coverage
```

To lint workflows locally, install [actionlint](https://github.com/rhysd/actionlint) and run `actionlint` from the repository root. CI verifies the download checksum before running its pinned version.

`pnpm test:coverage` runs the entire test suite through [the coverage gate](../../scripts/coverage.mjs), enforces 100% lines, branches, and functions for action source, and produces `coverage/lcov.info`. It enumerates every `actions/*/src/**/*.mjs` file and rejects files missing from the report. Coverage excludes test code and fixtures through a source-only include pattern; no shipped source is ignored.

The process E2E tests launch the actual Node entry point and talk to a loopback HTTPS fixture with TLS verification enabled. They check event/input handling, API calls, policy decisions, outputs, summaries, exit status, and diagnostics together. Live PR jobs separately test the real action manifest, GitHub API access, and reusable workflow wiring. All live candidate execution happens on unprivileged `pull_request` with read-only permissions and no inherited secrets; the `pull_request_target` title check continues to execute only pinned trusted code.

## Main protection

The repository requires pull requests and all seven checks above, with an up-to-date branch before merging. Protection applies to administrators. Force pushes and branch deletion are blocked, conversations must be resolved, and history must be linear. No reviewer approval is required so a sole maintainer can merge their own PR after checks pass.

Only squash merging is enabled. Its default commit title is the PR title and its default body is empty, so release tools see the same impact the checker validated. Keep the final merge title consistent with the checked title.

## Contributing

Use conventional commit messages for every commit and a PR title matching the strongest release impact. Rebase to update a branch instead of adding a generated merge commit. Keep each action's README, implementation, and tests together under `actions/<name>/`, with tests in its `test/` directory. Add policy and mocked API regression tests for behavior changes, then run the local checks. Document public rule or input changes in the [action README](../../actions/pr-title/README.md).

The reusable workflow pins the action source. When changing `actions/pr-title/src/` or its manifest, commit that implementation first, then update the action SHA in `.github/workflows/pr-title.yml` to that implementation commit. Test the standalone action and reusable workflow before publishing a version tag. Keep `v1` on the latest compatible release and create a new major for incompatible policy or interface changes.
