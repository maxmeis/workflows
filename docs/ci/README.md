# CI and branch protection

Repository automation runs on Woodpecker at `ci.nest42.de`. There are no GitHub Actions workflows. The Linux Docker agent runs all four workflows using `labels: { platform: linux/amd64 }`.

| Workflow | Events | Validation |
| --- | --- | --- |
| [`test-node-24`](../../.woodpecker/test-node-24.yaml) | PRs, pushes to `main`, manual | Syntax checks, process E2E tests, and 100% line, branch, and function coverage. |
| [`test-node-26`](../../.woodpecker/test-node-26.yaml) | PRs, pushes to `main`, manual | The same suite on Node 26. |
| [`lint`](../../.woodpecker/lint.yaml) | PRs, pushes to `main`, manual | Native Woodpecker workflow lint, with warnings treated as errors. |
| [`pr-title`](../../.woodpecker/pr-title.yaml) | PRs and PR metadata changes | Current PR title and all commit messages declare matching release impact. |

Node container images are pinned to digests. Lint downloads Woodpecker CLI v3.20.1 and verifies its SHA-256 before execution. Node's built-in test framework needs no package installation. PR jobs have no repository secrets; the live checker uses GitHub's public API without authentication. API errors, including rate limiting, fail the check.

## Local checks

Requires Node 24+ and pnpm:

```sh
pnpm check
pnpm test:coverage
woodpecker-cli --disable-update-check lint --strict .woodpecker/
```

`pnpm test` runs all tests, and `pnpm test:e2e` runs the process E2E tests. `pnpm check:pr-title` runs the shared checker when Woodpecker PR environment variables are available. See the [checker documentation](../../actions/pr-title/README.md) for the shared consumer interface and optional private-repository credentials.

The [coverage gate](../../scripts/coverage.mjs) enforces 100% lines, branches, and functions for every `actions/*/src/**/*.mjs` file and `scripts/pr-title.mjs`. It writes `coverage/lcov.info` and rejects source files missing from the report. Test code and fixtures are excluded; shipped checker source has no coverage exclusions or ignore directives.

Process E2E tests run the actual executable against a loopback HTTPS fixture with TLS verification enabled. They cover event/input handling, API calls, validation policy, outputs, exit status, and diagnostics. Woodpecker CLI tests also cover public API requests without Authorization, authenticated requests, metadata events, invalid context, stale heads, and failures. The local suite needs permission to bind a loopback HTTPS port.

The live PR-title workflow runs the same Woodpecker command against GitHub. GitHub action-manifest execution, reusable-workflow forwarding, and GitHub-specific integration jobs have been retired. The legacy action entry point and its regression tests remain for compatibility with historical consumers.

## Live activation and required checks

`maxmeis/workflows` is activated as Woodpecker project 4 at `https://ci.nest42.de/repos/4`. It uses default `.woodpecker/` discovery for push, PR, metadata, and manual pipelines. The installed GitHub webhook delivers `pull_request` events, from which Woodpecker derives PR metadata events. The GitHub webhook must deliver PR metadata edits so title changes rerun validation. Keep repository secrets out of PR workflows: Woodpecker reads workflow configuration from the PR commit.

Before requiring the title check, configure Woodpecker's server-side `WOODPECKER_STATUS_CONTEXT_FORMAT` so the `pr-title` workflow reports the same context for PR and metadata events. The default includes the event, which would leave title edits outside a required PR check; requiring both default contexts would block a new PR until its first metadata event. The live server uses this repository-scoped conditional template, preserving the default format for other repositories and workflows:

```text
{{ .context }}/{{if and (eq .owner "maxmeis") (eq .repo "workflows") (eq .workflow "pr-title")}}pr{{else}}{{ .event }}{{end}}/{{ .workflow }}{{if not (eq .axis_id 0)}}/{{.axis_id}}{{end}}
```

The `pr-title` workflow name comes from `.woodpecker/pr-title.yaml`; keep that filename in consumers. With the default prefix, its shared status is `ci/woodpecker/pr/pr-title`. Enable **Cancel previous pipelines** for both `pull_request` and `pull_request_metadata` in project settings. The workflow also uses a per-PR concurrency group with limit one to serialize checks across those events. Set a five-minute project timeout to retain the previous workflows' execution bound.

The live project requires owner approval for **all webhook events** (`require_approval: all_events`; Woodpecker-created manual and cron runs are exempt). Before approving a pipeline, review the exact commit, workflow configuration, and checker changes; an untrusted PR can edit YAML or candidate source to bypass validation. Keep this approval policy unless an exclusive server-controlled configuration extension instead supplies a protected workflow and immutable checker. The inline consumer example needs the same trust control. A pinned checker fetch alone does not protect editable caller YAML.

Main requires these exact statuses, with the branch up to date:

| Action/check | Required status |
| --- | --- |
| Workflow lint | `ci/woodpecker/pr/lint` |
| PR-title validation | `ci/woodpecker/pr/pr-title` |
| Node 24 tests and coverage | `ci/woodpecker/pr/test-node-24` |
| Node 26 tests and coverage | `ci/woodpecker/pr/test-node-26` |

The seven former GitHub Actions requirements have been removed. All four checks passed the first live PR pipeline. A metadata edit resets the same required PR-title context to pending approval. Live validation also confirmed that changing a `ci:` title to `feat:` fails when all commits have no release impact. The status template is persisted in the server's existing root-only environment file. Project visibility is private, privileged/network/volume trust is off, and every webhook event requires owner approval. Manual runs are restricted to authorized Woodpecker users. GitHub still requires pull requests and preserves the existing review policy; Woodpecker's execution approval is an additional review of the pipeline source.

Keep [CLAUDE.md](../../CLAUDE.md) and [CODEX.md](../../CODEX.md) current whenever adding or changing an action or required check. Each action/check must have its own section in both inventories.


Retain pull requests, up-to-date branches, resolved conversations, linear history, and force-push/deletion protection. Apply protection to administrators. Only squash merging should be enabled, with the PR title as its default commit title and an empty default body. Keep the final merge title consistent with the validated PR title.

## Contributing and shared checker releases

Use conventional commit messages and a PR title matching the strongest release impact. Rebase to update a branch. Keep policy, API, and adapter tests with the checker under `actions/pr-title/test/`; its Woodpecker executable lives in `scripts/pr-title.mjs`. Add regression tests for behavior changes, run the local checks, and update the checker README for public interface or rule changes.

Consumers fetch this public repository at a reviewed full commit SHA and run the Woodpecker command. Publish the chosen SHA only after testing the command and pipelines. Existing GitHub consumers pinned to historical commits keep their original implementation; no GitHub workflow files are published from this revision. Keep the old `v1` tag on the GitHub-compatible release line rather than moving it to the migrated source. Adopt a new major release for the Woodpecker interface.

References: [Woodpecker events and workflow syntax](https://woodpecker-ci.org/docs/usage/workflow-syntax), [environment variables](https://woodpecker-ci.org/docs/usage/environment), [server status configuration](https://woodpecker-ci.org/docs/administration/configuration/server), [security boundaries](https://woodpecker-ci.org/docs/usage/security-boundaries).
