# AGENTS.md

This repo is tracked by the wayfinder system. **Read `docs/agents/issue-tracker.md` before any wayfinder operation.**

- The **map** is issue [#1](https://github.com/Roni1993/pi-workflow/issues/1) — single source for Notes / Decisions-so-far / Fog / ticket list.
- **Child tickets**: issues #2–#7, labelled `wayfinder:<type>`. Spawned from [fleek#23](https://github.com/Roni1993/fleek/issues/23).
- **Frontier query** picks the first open, unblocked, unassigned ticket in map order.
- **Claim**: `gh issue edit <n> --add-assignee @me` (first write of a session).
- **Resolve**: comment the answer, close the issue, append a context pointer to the map's Decisions-so-far.
