# Jujutsu + idle-guard contract (short form)

Embed this in a repo's `AGENTS.md` so opencode and Pi agents behave identically.
Full ruleset: `docs/colocation.md` in the pi-workflow package.

## jj colocation rules

- One agent = one `jj workspace add`. Background agents never run in the primary workspace.
- `jj` is the single write path — prefer `jj` over `git` (`jj git push`, `jj describe`, `jj new`, `jj diff`).
- `jj push` is workflow-stage only; the `/jj push` command dry-runs and confirms first.
- Pi `/tree` reverts session history only; it does NOT rewrite jj state. jj checkpoints do NOT
  rewrite the Pi session tree. `jj restore --from <rev>` = working copy; `jj op restore` = repo
  state (use alone, never while other agents run in the repo).

## Idle-guard marker protocol

- `~/.cache/opencode/active`: touched by **interactive** sessions (opencode or Pi TUI) while
  working (heartbeat), cleared when idle. Guard treats fresh (< 60s) as active.
- Headless background agents (`pi --mode rpc` in tmux) never touch it — they don't hold the
  hypridle inhibitor.
