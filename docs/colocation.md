# jj colocation rules (shared contract)

Both opencode and Pi agents must behave identically in a git-colocated Jujutsu repo.
This is the canonical ruleset; it is embedded (short form) in `AGENTS.md`.

## Workspace isolation

- **One agent = one `jj workspace add`.** A background agent (`/bg spawn`) never runs in
  the primary workspace. The controller runs `jj workspace add <agent>/work` and the child
  `pi --mode rpc` process is started with that worktree as its cwd.
- The primary session keeps its own workspace. Agents never `jj workspace forget` or remove
  another agent's workspace.
- Collision rule: **jj is the single write path.** Agents write through the jj working copy
  of their own workspace. No agent touches `HEAD` state, `.jj/`, or `.git/` by hand.

## Command hygiene

- Prefer `jj` over `git` in colocated repos (`jj git push --remote <r>`, `jj describe`,
  `jj new`, `jj diff`). Use `git` only for operations jj lacks.
- `jj push` is a **workflow-stage** operation (the `/jj push` command always dry-runs and
  confirms first). It is not a per-agent tool.
- After `jj new`, the working copy is empty; edits go in the new change. Never edit the
  working copy of a change another agent owns.

## Pi `/tree` vs jj operation log

- Pi session entries (`session` JSONL + `/tree` branches) and jj's operation log are
  **independent history layers**. `/tree` reverting a Pi session does NOT change jj state —
  it only moves which conversation node is active. jj checkpoints (pi-jj) do NOT rewrite the
  Pi session tree.
- **Restore modes (pi-jj `/jj-checkpoints`)**: `file` mode (`jj restore --from <rev>`) edits
  the working copy only; `operation` mode (`jj op restore` + `jj git fetch --all-remotes`)
  rewinds jj operation state. Prefer `file` mode inside an agent workspace; use `operation`
  mode only deliberately and alone (never while other agents run in the same repo).
- When a `/bg` agent is reverted via its Pi session tree, its **jj workspace working copy is
  unchanged** unless an explicit `jj restore`/checkpoint action is taken. Document both layers
  in the agent's result file.

## Marker protocol (idle-guard)

- `~/.cache/opencode/active` is touched by **interactive sessions only** (opencode TUI or
  Pi TUI), heartbeat while working, cleared when idle. 60s staleness in the DBus guard.
- Headless background agents (`pi --mode rpc` in tmux) never touch it — they must not hold
  the hypridle inhibitor.
