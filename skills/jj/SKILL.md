---
name: jj
description: Jujutsu workflow rules for colocated repos — when to use jj vs git, workspace isolation, /jj command usage, push discipline, and how Pi /tree relates to the jj operation log. Use whenever working in a jj (jujutsu) repository.
---

# Jujutsu (jj) workflow

Colocated jj repos: one jj workspace per agent. `jj` is the single write path.

## Commands

Use the `/jj` command: `status`, `log`, `new [msg]`, `describe <msg>`, `diff`, `push`.

- `jj status` — current change state
- `jj new [msg]` — start a new change
- `jj describe <msg>` — set the change description
- `jj diff` — view current change diff
- `jj push` — **dry-runs and asks for confirmation first** (workflow-stage, not per-agent)

## Rules

- Prefer `jj` over `git` in colocated repos (`jj git push --remote <r>`, `jj new`, `jj describe`).
- Background agents already run in their own `jj workspace add` worktree — never switch/forget
  another agent's workspace, and never hand-edit `.jj/` or `.git/`.
- **`jj push` is workflow-stage only**: create the PR / verify artifacts first (#9), then push.
- Pi `/tree` reverts **session** history only; it does not rewrite jj state. jj checkpoints do
  not rewrite the Pi session tree.
- Restore: `jj restore --from <rev>` = working copy only. `jj op restore` = repo state — use
  it alone, never while other agents run in the repo.
