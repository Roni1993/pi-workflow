# UI build — REPORT (branch `feat/ui-integration`, based on `feat/ui-opencode`)

Implements tickets #26–#30 and #33 of the UI build (#25). The nix half (#31, #32, #34)
lives on `feat/pi-ui` in the fleek worktree.

This branch adds the "make it real" pass: the pipeline HITL grill now routes
through the questions modal, the backdrop is on, and the package has an install
path (not `-e` only). Architecture + run commands: `docs/ui.md`.

## What is here

`extensions/ui/` is a single Pi extension (`extensions/ui/index.ts` is the entry; pi
loads a subdirectory with an `index.ts` as one extension, so the sibling modules are
plain imports, not separately-loaded extensions).

| Module | Ticket | What it does |
|---|---|---|
| `ui-kit.ts` | T1 | matugen palette, role tints, padded full-width cards, ANSI-aware `truncateAnsi`. Width is measured by pi-tui's own `visibleWidth`/`truncateToWidth` (re-exported), not a local model, so the guard agrees with what pi validates. Headless-testable via the esbuild alias to the real installed pi-tui. |
| `live.ts` | T1 | read-only live-state contract (`index.json`, `out.jsonl` tail, tmux liveness), fully defensive. |
| `dock.ts` | T2 | `/ui-dock` preview + `/dock on\|off` widget below the editor. Chat + dashboard, live-polled, animated thinking rail, timers cleared in `dispose()`. |
| `questions.ts` | T3 | HITL modal: powerline stepper, preview, inverted focused row, circle-fill multi, note, real typed input via pi-tui `Editor`/`Input`, Submit recap. Exposes `askQuestions(ui, questions)`; **used by the pipeline grill** and `/ui-questions`. |
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
than the terminal (the fatal-crash contract). Bundling aliases
`@earendil-works/pi-tui` to the **real installed pi-tui**, resolved at runtime by
`tests/lib-pi-tui.sh` from `$(command -v pi)`.

Bundle checks as pi loads them (clean = no output):

```sh
npx --yes esbuild@0.23.1 extensions/ui/index.ts --bundle --format=esm --platform=node \
  --external:@earendil-works/pi-coding-agent --external:@earendil-works/pi-tui \
  --outfile=/tmp/ui.js --log-level=warning
npx --yes esbuild@0.23.1 extensions/pipeline.ts  --bundle --format=esm --platform=node \
  --external:@earendil-works/pi-coding-agent --external:@earendil-works/pi-tui \
  --outfile=/tmp/pipeline.js --log-level=warning   # pipeline has no tests — prove it compiles
```

End-to-end load (explicit path, or install the package — see below):

```sh
pi -ne -e ./extensions/ui/index.ts --help   # exit 0, no extension errors
```

## What is now real

- **Pipeline HITL wiring.** `/pipeline` (without `--no-grill`) now asks its
  acceptance-criteria + constraints questions through the opencode-look modal,
  not two plain `ctx.ui.input` prompts. The downstream contract is unchanged: the
  call site still gets two plain strings, `criteria` and `constraints`, exactly
  as before. The mapping and three fallbacks (non-TUI mode, `askQuestions`
  throw / missing overlay, cancel) are documented in `docs/ui.md`. The pipeline
  has no tests, so it is proven by a clean esbuild bundle.
- **Backdrop on.** `questions.ts` sets `BACKDROP = 0.5` (number strictly between
  0 and 1) and `width: "100%"` on the overlay; the `backdrop` type is now
  `number`. Stock pi-tui ignores the key, so this is safe on both builds.
- **Install path.** The extension is loaded by installing the pi-workflow
  package (`pi install ./path/to/pi-workflow`, or via fleek's `pi.nix`
  activation), not `-e` only. `package.json` already declares
  `"pi": { "extensions": ["./extensions"] }`, so one install loads
  `pipeline.ts` + `ui/`. Instructions: `docs/ui.md`.

## Still pending (honest)

- **Patched pi not switched into the active profile.** The active `pi` on `PATH`
  is stock **0.81.1**; the patched **0.85.1** (`feat/pi-ui` in the fleek
  worktree) is built but not yet wired into the running profile. So on the
  active binary the backdrop does not dim (key ignored, graceful) and the
  transcript cards do not render (no seam). The modal + pipeline grill work on
  both. Switching the profile is a fleek/home-manager change — out of scope here.
- **No pixel verification.** No visual TUI check was possible headlessly.
  Behaviour is proven by width suites, the T7 reachability suite, and a real
  extension-load check — not by pixels. A human should eyeball `/ui-kit`,
  `/ui-dock`, `/ui-questions`, and one `/pipeline` run once.
- **T4 cross-call grouping.** Real pi renders one component per tool call, so the
  prototype's single box wrapping all calls is not reachable. The "latest 3 open"
  rule is best-effort via a module-level recent-call list. See `tools.ts`.
- **`--pr` is still manual.** `finishClean` records the intent; it does not
  create a PR. Unchanged by this branch.

## Install (persistent)

```sh
pi install ./path/to/pi-workflow     # package.json pi.extensions loads pipeline.ts + ui/
pi list | grep pi-workflow           # verify
```

Or via fleek's `pi.nix` `home.activation` loop (installs
`git:github.com/Roni1993/pi-workflow`). Two branch prerequisites: `feat/ui-opencode`
for the extension, and `feat/pi-ui` (fleek worktree) for the patched 0.85.1 pi that
the transcript seam + backdrop need. Full detail: `docs/ui.md`.

## Do not merge

Work is committed on `feat/ui-integration` only. No merge.
