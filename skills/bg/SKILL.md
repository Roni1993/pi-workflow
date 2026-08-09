---
name: bg
description: Background agent orchestration — how to spawn, watch, steer, interrupt, kill, resume and revert tmux-hosted Pi RPC background agents via the /bg commands. Use when delegating long-running parallel work that must persist beyond the session.
---

# Background agents (/bg)

`/bg` runs independent `pi --mode rpc` processes in tmux sessions, each with its own
persistent session tree and (in a jj colocated repo) its own `jj workspace`. Agents keep
working after the interactive session closes.

## Commands

| Command | Action |
|---|---|
| `/bg spawn [--model M] [--tools t] <task>` | Start a background agent |
| `/bg list` | Show all agents + status (spawning/running/settled/stopped) |
| `/bg watch <id> [n]` | Show recent events (text, tools, queue) |
| `/bg steer <id> <msg>` | Inject an interrupt-style instruction (delivered before the next LLM call) |
| `/bg follow <id> <msg>` | Queue an instruction delivered after the agent finishes |
| `/bg interrupt <id>` | Clean abort (RPC `abort`, session preserved) |
| `/bg kill <id>` | Hard stop (tmux kill-session) |
| `/bg resume <id>` | Reattach if alive, else restart with the same session-dir (history preserved) |
| `/bg revert <id> <node>` | Interact with the agent's own tree (`pi --fork <session-dir>`) |

## Orchestration guidance

- Spawn parallel independent agents for research/implementation; give each a self-contained task.
- Pick models per agent: a cheap researcher (`opencode-go/kimi-k2.6`) vs implementer
  (`opencode-go/deepseek-v4-flash`) vs orchestrator (`kimi-k3`).
- Agents settle → `result.md` written + `[bg] <id> settled` notification in the primary session.
- Steer a wandering agent immediately rather than killing it.
- In a colocated jj repo, each agent already runs in its own `jj workspace` — do not add another.
