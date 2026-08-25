# Scenarios

Each dir = one benchmark scenario:

- `scenario.json` — id, git repo, statement file, hidden test files, run caps
- `statements.txt` — the exact `/pipeline` statement (pinned verbatim for all runs in a cycle; the statement IS the test contract)
- hidden acceptance tests (e.g. `kalah.hidden.test.js`) — scored against a COPY of the implementer's worktree at scoring time. **They must never live in the scenario repo** (agents would see them).

Hidden-test rules:
- CommonJS tests (`require("../src/...")`), spec-level only — assert the stated API contract, never implementation internals.
- The scorer neutralizes `"type": "module"` in artifacts so the tests always run; implementations that deliver ESM without being told to will fail the contract (by design — the statements demand CommonJS).
- Board/state constructions must be "thermodynamically valid" (e.g. Kalah: supplies sum to 72) — treat the known-good example in `kalah-poc` as the reference.

Adding a scenario: duplicate `expr-eval`, write spec + issue #1 in its repo, pin statements, write hidden tests, verify them against a known-good artifact once before the cycle.
