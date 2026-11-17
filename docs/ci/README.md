# CI and branch protection

[CI workflow](../../.github/workflows/ci.yml) runs on pull requests, pushes to `main`, and manual dispatch.

| Check | Validation |
| --- | --- |
| `Tests (Node 24)` | JavaScript syntax and the full `node:test` suite with coverage on the action's runtime. |
| `Tests (Node 26)` | The same suite on Node 26. |
| `Workflow lint` | GitHub Actions syntax and expression checks using checksum-pinned actionlint. |
| `PR title / Validate PR title` | The [shared PR-title check](../../actions/pr-title/README.md), on PR metadata events. |

Node's built-in test framework needs no installation step. There are no runtime or development dependencies. CI uses read-only permissions, pinned action SHAs, and checkout without persisted credentials. Dependabot checks action updates weekly.

## Local checks

Requires Node 24+ and pnpm:

```sh
pnpm test
pnpm check
pnpm test:coverage
```

To lint workflows locally, install [actionlint](https://github.com/rhysd/actionlint) and run `actionlint` from the repository root. CI verifies the download checksum before running its pinned version.

## Main protection

The repository requires pull requests and all four checks above, with an up-to-date branch before merging. Protection applies to administrators. Force pushes and branch deletion are blocked, conversations must be resolved, and history must be linear. No reviewer approval is required so a sole maintainer can merge their own PR after checks pass.

Only squash merging is enabled. Its default commit title is the PR title and its default body is empty, so release tools see the same impact the checker validated. Keep the final merge title consistent with the checked title.

## Contributing

Use conventional commit messages for every commit and a PR title matching the strongest release impact. Rebase to update a branch instead of adding a generated merge commit. Keep each action's README, implementation, and tests together under `actions/<name>/`, with tests in its `test/` directory. Add policy and mocked API regression tests for behavior changes, then run the local checks. Document public rule or input changes in the [action README](../../actions/pr-title/README.md).

The reusable workflow pins the action source. When changing `actions/pr-title/src/` or its manifest, commit that implementation first, then update the action SHA in `.github/workflows/pr-title.yml` to that implementation commit. Test the standalone action and reusable workflow before publishing a version tag. Keep `v1` on the latest compatible release and create a new major for incompatible policy or interface changes.
