# PR title release check

Reject a conventional PR title whose release impact differs from the strongest commit in the PR. Designed for squash merging, where the PR title becomes the commit used by your release tool.

## Woodpecker workflow

Create `.woodpecker/pr-title.yaml` in a consuming repository:

```yaml
when:
  - event: [pull_request, pull_request_metadata]

labels:
  platform: linux/amd64

concurrency:
  limit: 1
  group: pr-title-${CI_COMMIT_PULL_REQUEST}

steps:
  - name: validate-pr-title
    image: node:24.19.0-bookworm@sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b
    environment:
      WORKFLOWS_COMMIT: 8056b832b92aa96f5f8b6f23e7341bd1f6695f72
    commands:
      - git init /tmp/pr-title-checker
      - git -C /tmp/pr-title-checker remote add origin https://github.com/maxmeis/workflows.git
      - git -C /tmp/pr-title-checker fetch --depth=1 origin "$WORKFLOWS_COMMIT"
      - git -C /tmp/pr-title-checker checkout --detach FETCH_HEAD
      - node /tmp/pr-title-checker/scripts/pr-title.mjs
```

The example pins a reviewed commit containing `scripts/pr-title.mjs`. Update it only to another reviewed full 40-character commit SHA. Historical GitHub Actions release commits predate this interface. Pin the source for immutable execution; do not substitute an unreviewed PR ref. The step needs Git and Node 24+, both provided by the pinned image. Alternatively, vendor the checker and its imported source files from the same reviewed commit.

The command reads `CI_REPO`, `CI_COMMIT_PULL_REQUEST`, `CI_COMMIT_SHA`, and `CI_PIPELINE_EVENT` directly from Woodpecker. The GitHub PR head must match `CI_COMMIT_SHA`. It fetches current metadata rather than trusting a title interpolated into a shell command. Both `pull_request` and `pull_request_metadata` are required: metadata events revalidate title/body edits and changes such as ready-for-review. Configure the repository in Woodpecker to allow both events and cancel previous pipelines for each. The workflow serializes checks for each PR with a concurrency group. Before making the check required, apply the [server status mapping](../../docs/ci/README.md#live-activation-and-required-checks) so both events update one required status; the default event-specific contexts cannot enforce title edits through a single PR requirement.

A successful run prints `release=none|patch|minor|major` and `commit-count=N`, then exits zero. A mismatch, invalid context, stale PR, or API error exits nonzero. These values are log lines; Woodpecker does not expose the former GitHub reusable-workflow outputs.

Public GitHub repositories use unauthenticated API requests, with no repository secrets. GitHub's unauthenticated rate limit applies; exhaustion fails the check and requires a later rerun. For a private repository or GitHub Enterprise, the command accepts optional `GITHUB_TOKEN` (Pull requests read access) and `GITHUB_API_URL` (HTTPS API base URL). Woodpecker executes the workflow from the PR commit, so keep secrets out of untrusted PR pipelines. Only provide private-repository credentials where server-enforced configuration and contributor trust permit it; a YAML event condition alone does not protect a secret.

Woodpecker loads workflow YAML from the PR commit. A contributor who can edit that YAML can replace the check with a successful command; this differs from the retired GitHub `pull_request_target` integration. A pinned source checkout alone does not prevent changing the caller. For enforcement against untrusted contributors, require owner approval for all pipeline events and review the exact workflow and checker source before approving execution, as this repository does. Alternatively, an administrator can supply protected workflow configuration (for example, an exclusive server configuration extension) that invokes the checker at a reviewed immutable SHA. Without either trust control, treat the result as a check for trusted contributors. The [activation guide](../../docs/ci/README.md#live-activation-and-required-checks) records these settings. Its live status-format condition is scoped to `maxmeis/workflows`; consumer administrators must adapt the owner/repository condition for their own repositories.

This repository uses the same command directly in [its PR-title workflow](../../.woodpecker/pr-title.yaml). The old GitHub workflow files have been removed. `action.yml` and the GitHub runner entry point remain as legacy compatibility code; the supported shared setup is the Woodpecker step above.

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

The `feat`, `fix`, `perf`, and breaking-change mappings follow common semantic-release rules. This checker treats `revert:` as `none`, while semantic-release can recognize a revert as a patch. Configure your release tool to use the same mapping. This checker compares declared commit messages; it cannot inspect code semantics, detect a mislabeled feature in a `docs:` commit, or undo reverted changes. Label the resulting change appropriately.

## Merge and release setup

1. Enable squash merging and make the default squash commit title the PR title.
2. Use an empty default squash commit body. GitHub's optional list of original commit messages can contain release markers that contradict the validated title.
3. Disable merge and rebase merging if your release tool relies on the PR title.
4. Configure the shared PR/metadata status mapping described above, then require the resulting Woodpecker PR-title status on your default branch. Verify it updates after a title edit. Remove obsolete GitHub workflow requirements only after Woodpecker has reported success.
5. Keep the final squash message consistent with the checked title. Someone with merge permission can still edit that message in GitHub's merge dialog.

This repository applies these settings to `main`. Consumer repositories must configure their own protection and merge settings; merely installing a workflow does not make it required.

## Failure behavior

The checker fetches the current PR title and every commit, including full commit bodies. It paginates up to GitHub's PR-commit API limit of 250; PRs exceeding that limit fail and must be split. Empty, incomplete, duplicate, or malformed API responses, changed PR snapshots, and API failures also fail rather than silently skipping validation. A run triggered for an older head SHA fails as stale.

There is no path or draft filter. A failing check explains which message or impact needs correction. Amend/rebase incorrectly labeled commits, or correct the PR title; do not use a stronger title just to hide invalid commit messages.

## Tests

Tests live in [test/](test/) beside this README, the action manifest, and [src/](src/). From the repository root, run `pnpm test` or `pnpm test:coverage` for all actions, or `node --test actions/pr-title/test/*.test.mjs` for this action. You can also run `node --test` from this action's directory.

Tests use `node:test`; no runtime packages or generated bundles are required.

- [E2E tests](test/e2e.test.mjs) spawn the shipped executable with event JSON, environment variables, and output/summary files. Native `fetch` makes real TLS-verified HTTPS requests to a loopback GitHub API fixture; these tests do not replace `fetch` or call the action's exported functions. They check all four release levels, both supported events, failures, pagination, snapshot changes, output files, exit codes, and safe error annotations.
- [Woodpecker command tests](test/woodpecker.test.mjs) cover PR and metadata context, optional authentication, failure behavior, and actual command execution over HTTPS.
- [Policy](test/policy.test.mjs), [API](test/api.test.mjs), and [runner](test/runner.test.mjs) tests cover detailed input validation and error paths.
- `pnpm test:e2e` runs process-level E2E tests. `pnpm test:coverage` runs the full suite and requires **100% lines, branches, and functions** for every shipped `actions/*/src/**/*.mjs` file and `scripts/pr-title.mjs`, including a check for files omitted from the report. LCOV is written to `coverage/lcov.info`. Tests and fixtures are outside the shipped-source coverage scope; there are no source coverage exclusions or ignore directives.
- Woodpecker runs the full coverage gate on Node 24 and 26. Its PR-title pipeline executes the shared command against the real public GitHub API on PR and metadata events. Local command tests cover its environment handling and HTTPS execution. GitHub action-manifest execution and reusable-workflow forwarding checks have been retired with the GitHub workflows.

The local E2E suite needs permission to bind a loopback HTTPS port. Its [public test-only certificate and key](test/fixtures/README.md) keep TLS verification enabled; it does not call GitHub or require credentials.

References: [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), [semantic-release commit analyzer](https://github.com/semantic-release/commit-analyzer), [Woodpecker environment variables](https://woodpecker-ci.org/docs/usage/environment), [Woodpecker security boundaries](https://woodpecker-ci.org/docs/usage/security-boundaries).
