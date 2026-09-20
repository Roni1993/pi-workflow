# UI build — REPORT (branch `feat/ui-opencode`)

Implements tickets #26–#30 and #33 of the UI build (#25). The nix half (#31, #32, #34)
lives on `feat/pi-ui` in the fleek worktree.

## What is here

`extensions/ui/` is a single Pi extension (`extensions/ui/index.ts` is the entry; pi
loads a subdirectory with an `index.ts` as one extension, so the sibling modules are
plain imports, not separately-loaded extensions).

| Module | Ticket | What it does |
|---|---|---|
| `ui-kit.ts` | T1 | matugen palette, role tints, padded full-width cards, ANSI-aware `truncateAnsi`, local `visibleWidth` (code-point counted, PUA-safe). No pi-tui import, so it is headless-testable. |
| `live.ts` | T1 | read-only live-state contract (`index.json`, `out.jsonl` tail, tmux liveness), fully defensive. |
| `dock.ts` | T2 | `/ui-dock` preview + `/dock on\|off` widget below the editor. Chat + dashboard, live-polled, animated thinking rail, timers cleared in `dispose()`. |
| `questions.ts` | T3 | HITL modal: powerline stepper, preview, inverted focused row, circle-fill multi, note, real typed input via pi-tui `Editor`/`Input`, Submit recap. Exposes `askQuestions(ui, questions)`. |
| `tools.ts` | T4 | re-registers the built-in tools (`bash`/`read`/`edit`/`write`/`find`/`grep`/`ls`) with `renderShell:"self"` and locked rows, delegating `execute` to the built-in factories. |
| `cards.ts` | T5 | locked cards for the `bg-output` / `pipe-output` / `goal-output` / `jj-output` custom messages (+ durable entries). |
| `transcript.ts` | T8 | locked user/assistant cards via the T7 seam (`registerMessageRenderer("user"\|"assistant", …)`), all thinking blocks in one box. |

## Tests (all headless, no framework)

```sh
bash tests/ui-render.sh       # ui-kit cards        — 107 checks
bash tests/ui-dock.sh         # dock                — 1652 checks
bash tests/ui-questions.sh    # questions modal     — 564 checks
bash tests/ui-tools.sh        # tools box           — 282 checks
bash tests/ui-cards.sh        # custom message cards— 740 checks
bash tests/ui-transcript.sh   # transcript cards    — 2414 checks
```

Every suite renders at widths 20/40/80/120 and asserts no throw and no line wider
than the terminal (the fatal-crash contract). Bundling uses
`--alias:@earendil-works/pi-tui=./tests/pi-tui-stub.mjs`.

End-to-end load against the patched pi 0.85.1 (nix half):

```sh
pi -ne -e /home/roni/projects/pi-workflow/extensions/ui/index.ts --help   # exit 0, no errors
```

## Known limitations (honest)

- **No visual TUI verification** was possible headlessly. Behaviour is proven by
  width tests, the T7 reachability suite, and a real extension-load check — not by
  pixels. A human should eyeball `/ui-kit`, `/ui-dock`, `/ui-questions` once.
- **T4 cross-call grouping**: real pi renders one component per tool call, so the
  prototype's single box wrapping all calls with a blank line between them is not
  reachable. Achievable look is one card per call; the "latest 3 open" rule is
  best-effort via a module-level recent-call list.
- **T3 backdrop dim** is opt-in (`BACKDROP = false` in `questions.ts`); flip it to
  `true` once the T9 pi-tui patch is in the running pi.
- **Pipeline HITL integration** is not wired into `extensions/pipeline.ts`; that is
  the richer questionnaire, issue #22. `askQuestions` is exported for it.

## Do not merge

Work is committed and pushed on `feat/ui-opencode` only. No merge.
