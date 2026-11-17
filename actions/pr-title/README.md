# PR title release check

Reject a conventional PR title whose release impact differs from the strongest commit in the PR. Designed for squash merging, where the PR title becomes the commit used by your release tool.

## Reusable workflow

Create `.github/workflows/pr-title.yml` in a consuming repository:

```yaml
name: PR title

on:
  pull_request_target:
    types: [opened, edited, synchronize, reopened, ready_for_review]

permissions:
  pull-requests: read

jobs:
  pr-title:
    uses: maxmeis/workflows/.github/workflows/pr-title.yml@2515fc96f5fe1bc0254ee66a2bf4121225b2ed17 # v1 source
    permissions:
      pull-requests: read
```

Pin the reusable workflow to a full commit SHA for immutable execution; `v1` follows compatible releases. No checkout, installation, personal token, or inherited secrets are needed. The shared workflow pins its action implementation to an immutable commit.

Include `edited` so changing the title revalidates it, and `synchronize` so new commits do too. The workflow reads PR metadata only. It is safe on `pull_request_target` because it never checks out or executes PR code, and requests only read access. Keep that property if you extend the caller. `pull_request` is also supported, but first-time fork contributions can require workflow approval.

## Standalone action

```yaml
name: PR title
on:
  pull_request_target:
    types: [opened, edited, synchronize, reopened, ready_for_review]
permissions:
  pull-requests: read
jobs:
  pr-title:
    runs-on: ubuntu-latest
    steps:
      - uses: maxmeis/workflows/actions/pr-title@22d1d72779b3e011dc845c9ea74f3c6ce94f077f # v1 source
```

The action runs on Node 24. It accepts a `token` input defaulting to `github.token`; the token needs `pull-requests: read`. It emits `release` (`none`, `patch`, `minor`, or `major`) and `commit-count`. The reusable workflow exposes the same outputs.

## Rules

| Commit type | Release impact |
| --- | --- |
| Any supported type with `!` or a breaking footer | `major` |
| `feat` | `minor` |
| `fix`, `perf` | `patch` |
| `build`, `chore`, `ci`, `docs`, `refactor`, `revert`, `style`, `test` | `none` |

The title must have exactly the same impact as the highest-impact commit. Type and scope need not match every commit: a feature PR may also contain fixes and documentation. Unsupported types and malformed messages fail; merge commits must also be conventional, so rebase feature branches instead of adding generated merge commits.

| PR title | Commits | Result |
| --- | --- | --- |
| `docs: update guide` | `docs: add examples` | Pass: none |
| `feat: add export` | `feat: add export`, `fix: handle empty rows`, `docs: explain export` | Pass: minor |
| `docs: update guide` | `feat: add export` | Fail: hides a feature |
| `fix: improve export` | `feat: add export` | Fail: understates minor as patch |
| `feat: add export` | `fix: handle empty rows` | Fail: overstates patch as minor |
| `feat: change API` | `feat!: remove legacy API` | Fail: missing breaking marker |
| `feat!: change API` | `feat!: remove legacy API` | Pass: major |
| `fix!: handle empty rows` | `fix: handle empty rows` | Fail: unsupported breaking claim |

Both the title and commit headers use `<type>[optional scope][optional !]: <description>`. Types must be lowercase. A title is a single line, so it must use `!` to signal a breaking change. Commits can instead use either breaking footer:

```text
refactor(api): simplify options

BREAKING CHANGE: remove the legacy configuration format
```

`BREAKING-CHANGE: description` is also accepted. Footers must be separated from the header/body by a blank line and contain a description. Ordinary prose mentioning a breaking change does not count.

The `feat`, `fix`, `perf`, and breaking-change mappings follow common semantic-release rules. This checker treats `revert:` as `none`, while semantic-release can recognize a revert as a patch. Configure your release tool to use the same mapping. This action compares declared commit messages; it cannot inspect code semantics, detect a mislabeled feature in a `docs:` commit, or undo reverted changes. Label the resulting change appropriately.

## Merge and release setup

1. Enable squash merging and make the default squash commit title the PR title.
2. Use an empty default squash commit body. GitHub's optional list of original commit messages can contain release markers that contradict the validated title.
3. Disable merge and rebase merging if your release tool relies on the PR title.
4. Require this workflow's check on your default branch. Use the exact check name shown by a successful run, including the caller job prefix.
5. Keep the final squash message consistent with the checked title. Someone with merge permission can still edit that message in GitHub's merge dialog.

This repository applies these settings to `main`. Consumer repositories must configure their own protection and merge settings; merely installing a workflow does not make it required.

## Failure behavior

The action fetches the current PR title and every commit, including full commit bodies. It paginates up to GitHub's PR-commit API limit of 250; PRs exceeding that limit fail and must be split. Empty, incomplete, duplicate, or malformed API responses, changed PR snapshots, and API failures also fail rather than silently skipping validation. A run triggered for an older head SHA fails as stale.

There is no path or draft filter. A failing check explains which message or impact needs correction. Amend/rebase incorrectly labeled commits, or correct the PR title; do not use a stronger title just to hide invalid commit messages.

## Tests

Tests live in [test/](test/) beside this README, the action manifest, and [src/](src/). From the repository root, run `pnpm test` or `pnpm test:coverage` for all actions, or `node --test actions/pr-title/test/*.test.mjs` for this action. You can also run `node --test` from this action's directory.

Tests use `node:test`; no runtime packages or generated bundles are required.

- [E2E tests](test/e2e.test.mjs) spawn the shipped executable with event JSON, environment variables, and output/summary files. Native `fetch` makes real TLS-verified HTTPS requests to a loopback GitHub API fixture; these tests do not replace `fetch` or call the action's exported functions. They check all four release levels, both supported events, failures, pagination, snapshot changes, output files, exit codes, and safe error annotations.
- [Policy](test/policy.test.mjs), [API](test/api.test.mjs), and [runner](test/runner.test.mjs) tests cover detailed input validation and error paths.
- `pnpm test:e2e` runs process-level E2E tests. `pnpm test:coverage` runs the full suite and requires **100% lines, branches, and functions** for every shipped `actions/*/src/**/*.mjs` file, including a check for files omitted from the report. LCOV is written to `coverage/lcov.info`. Tests and fixtures are outside the shipped-source coverage scope; there are no source coverage exclusions or ignore directives.
- CI runs the full coverage gate on Node 24 and 26. On PRs it also runs `uses: ./actions/pr-title` with the real GitHub token and API, verifies its outputs, checks that rejected credentials fail, calls the candidate reusable workflow, and verifies its forwarded outputs. These live jobs exercise the manifest and workflow wiring that local process tests cannot execute.

The local E2E suite needs permission to bind a loopback HTTPS port. Its [public test-only certificate and key](test/fixtures/README.md) keep TLS verification enabled; it does not call GitHub or require credentials.

References: [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), [semantic-release commit analyzer](https://github.com/semantic-release/commit-analyzer), [GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).
