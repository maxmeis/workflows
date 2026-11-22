# Workflows

Shared Woodpecker CI workflows and checks for my repositories.

| Workflow | Purpose | Documentation |
| --- | --- | --- |
| [PR title](.woodpecker/pr-title.yaml) | Match the conventional PR title to the strongest release impact in its commits, including after title edits. | [Usage and rules](actions/pr-title/README.md) |
| [Node 24](.woodpecker/test-node-24.yaml) / [Node 26](.woodpecker/test-node-26.yaml) | Syntax checks, process E2E tests, and coverage. | [Development and protection](docs/ci/README.md) |
| [Workflow lint](.woodpecker/lint.yaml) | Validate Woodpecker configurations with the checksum-pinned CLI. | [Development and protection](docs/ci/README.md) |

The shared checker runs with `node scripts/pr-title.mjs` in a Woodpecker PR step. See its [consumer setup](actions/pr-title/README.md#woodpecker-workflow) for using a pinned copy in another repository. Public GitHub repositories need no token. There are no GitHub Actions workflows in this repository.

## Development

The validation policy and tests remain together; the Woodpecker command lives in `scripts/pr-title.mjs`:

```text
actions/<name>/
  action.yml
  README.md
  src/
  test/
```

Requires Node 24+; no dependencies or build step.

```sh
pnpm test
pnpm test:e2e
pnpm check
pnpm test:coverage
```

Tests use Node's built-in `node:test` framework. Process E2E tests run the executables against a local HTTPS API fixture, alongside focused policy and API tests. `pnpm test:coverage` requires 100% line, branch, and function coverage across every checker source file, including the Woodpecker command, and writes `coverage/lcov.info`.

Woodpecker runs the checker against the current PR and repeats it on metadata edits. The root commands discover tests across all action directories, including the Woodpecker command’s tests. See [CI documentation](docs/ci/README.md) for required checks and contribution instructions.

MIT licensed.
