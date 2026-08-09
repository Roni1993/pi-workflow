---
name: idle-guard
description: Idle-guard marker protocol — when Pi should signal activity to the hypridle inhibitor so the screen never locks mid-think. Use when deciding whether to touch ~/.cache/opencode/active or when asked about lockscreen/idle behavior.
---

# Idle-guard

The desktop (CachyOS + Hyprland) holds a DBus screen inhibitor only while the shared
activity marker `~/.cache/opencode/active` is **fresh (< 60s)**. The `opencode-idle-guard`
service polls it every 5s.

## Protocol

- **Interactive Pi / opencode sessions** touch the marker while working (tool calls, message
  streaming) and keep it fresh with a heartbeat; they remove it when idle (`agent_settled`).
- **Headless background agents** (`pi --mode rpc` in tmux, via `/bg`) **never** touch the
  marker — they must not hold the inhibitor.

## For agents

- You do NOT need to touch the marker manually — the idle-guard extension does it in the
  interactive session.
- If you are a background agent (`/bg`), never create or modify `~/.cache/opencode/active`.
- If the user asks "why did the screen lock" / "is the agent still working", check:
  `test -f ~/.cache/opencode/active && stat -c %Y ~/.cache/opencode/active`
  (fresh = now - mtime < 60).
