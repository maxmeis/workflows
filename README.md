# Workflows

Shared GitHub Actions and reusable workflows for my repositories.

| Workflow | Purpose | Documentation |
| --- | --- | --- |
| [PR title](.github/workflows/pr-title.yml) | Match the conventional PR title to the strongest release impact in its commits. | [Usage and rules](actions/pr-title/README.md) |
| [Repository PR title](.github/workflows/check-pr-title.yml) | Apply the shared checker to this repository's PRs. | [Usage and rules](actions/pr-title/README.md) |
| [CI](.github/workflows/ci.yml) | Test the checker on Node 24 and 26, and lint workflows. | [Development and protection](docs/ci/README.md) |

The PR-title checker is also available as a [standalone action](actions/pr-title/action.yml).

Use `v1` for compatible updates, or pin a full commit SHA for immutable execution. Releases: [GitHub releases](https://github.com/maxmeis/workflows/releases).

## Development

Requires Node 24+; no dependencies or build step.

```sh
pnpm test
pnpm check
pnpm test:coverage
```

Tests use Node's built-in `node:test` framework, including mocked GitHub API requests. See [CI documentation](docs/ci/README.md) for required checks and contribution instructions.

MIT licensed.
