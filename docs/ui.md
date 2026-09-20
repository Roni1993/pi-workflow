# UI extension (opencode look)

`extensions/ui/` is the visual layer for pi-workflow. It is one Pi extension:
`extensions/ui/index.ts` is the entry, and pi loads a directory containing an
`index.ts` as a single extension, so the sibling modules are plain imports — not
separately-loaded extensions.

This document is the contract for the UI work. It is written for branch
`feat/ui-integration` (based on `feat/ui-opencode`).

## Architecture — which module owns what

| Module | Owns | Notes |
|---|---|---|
| `ui-kit.ts` | matugen palette (`M`, `PAL`, role tints), full-width padded cards, ANSI-aware `truncateAnsi`, local code-point `visibleWidth` (PUA-cheveron safe). | No pi-tui import, so it is headless-testable. |
| `live.ts` | The read-only live-state contract. | Defensive: missing files, malformed JSON, no tmux → never throws. |
| `dock.ts` | `/ui-dock` preview + `/dock on\|off` widget below the editor. | Polls `live.ts`; timers cleared in `dispose()`. |
| `questions.ts` | HITL modal: powerline stepper, preview box, inverted focused row, circle-fill multi-select, notes, real typed input, Submit recap. Exports `askQuestions(ui, questions)`. | Used by the pipeline (see below) and by `/ui-questions`. |
| `tools.ts` | Re-registers every built-in tool with a self-rendered locked row, forwarding `execute` to the built-in factory. | Honest limitation documented in the file header. |
| `cards.ts` | Locked colour-coded cards for `bg-output` / `pipe-output` / `goal-output` / `jj-output`. | One `MessageRenderer` per customType. |
| `transcript.ts` | Locked user/assistant cards via the T7 seam (`registerMessageRenderer("user"\|"assistant", …)`). | Requires the patched pi (see prerequisites). |

`extensions/pipeline.ts` (owned by the pipeline, not the UI) imports
`askQuestions` from `extensions/ui/questions.ts` for its pre-flight grill.

## Live-state contract

Read-only, identical to `extensions/bg.ts`:

```
~/.pi/agent/bg/index.json        -> { <id>: BgAgent }
~/.pi/agent/bg/<id>/out.jsonl    -> event stream (tail, bounded at 128 KiB)
tmux has-session -t pi-bg-<id>   -> liveness
```

`out.jsonl` events understood by `live.ts`: `agent_start`, `agent_settled`,
`message_update` (`assistantMessageEvent.type === "text_delta"`), the
`tool_execution_start` / `tool_execution_end` pair (last tool = current action),
`queue_update`, `auto_retry_start`, `extension_error`, `extension_ui_request`.
No session-JSONL parsing for tokens or cost.

## Pipeline HITL wiring

`extensions/pipeline.ts` previously asked two free-text `ctx.ui.input` prompts
("Acceptance criteria…" and "Constraints / out-of-scope?"). It now routes them
through `askQuestions` so the opencode-look modal is used, while keeping the
**same downstream value contract**: the call site still receives two plain
strings, `criteria` and `constraints`, consumed exactly as before
(`log(p, …)`, `p.statement = "…Acceptance: ${criteria || "(as I judge best)"}
…Constraints: ${constraints || "none"}"`).

The mapping, and why it is conservative:

- **Acceptance criteria** → a `Question` with **no options**. It is answer-only,
  entered on the `Type something.` row. The old prompt returned raw free text
  into a single string; the modal's `custom` text is the same string. Neither a
  preset option nor a multi-select would preserve that.
- **Constraints** → a `Question` with one `none` option plus the same custom row.
  The answer is flattened to a comma-joined string.
- `answerText()` flattens `Answer.selected` + `Answer.custom` back to the plain
  string. There is no `note` in the pipeline path, so it is not included.

**Fallbacks (the pipeline must never break):**

1. **Mode guard.** The modal is terminal-only. In any non-`tui` mode
   (`rpc`/`print`/`json`) the code takes the old `ctx.ui.input` path unchanged.
2. **Throw guard.** Any `askQuestions` failure — a missing/undefined overlay, an
   unpatched pi, an `ui.custom` rejection — is caught and control falls through
   to the old `ctx.ui.input` pair. The grill never throws out of `grill(ctx)`.
3. **Cancel.** `askQuestions` returns `null` when the user cancels. This maps to
   `{ criteria: "", constraints: "" }` exactly like a cancelled `ui.input`
   (`undefined` was rendered as `"(as I judge best)"` / `"none"` before). Empty
   strings keep that same downstream behaviour.

The values are `.trim()`-ed, matching the old `ui.input` return (which was
already trimmed by pi's dialog).

### Why the pipeline stays lazy on richer typing

The modal supports per-question notes and multi-select. The pipeline does **not**
use them: notes have no field in the `Pipeline` record or the generated
implementer prompt, and inventing one would change the pipeline's contract. If a
later ticket wants notes in the plan, add a field and thread it deliberately —
do not smuggle it through `criteria`.

## The backdrop

`questions.ts` sets:

```ts
const BACKDROP = 0.5
const overlayOptions: OverlayOptions & { backdrop: number } = {
  anchor: "center",
  width: "100%",
  maxHeight: "90%",
  backdrop: BACKDROP,
}
```

- The dim factor must be a **number strictly between 0 and 1**. The pi-tui patch
  treats `boolean`, `0` and `1` as no-ops.
- `width: "100%"` keeps the overlay full-width. (The current patch dims the
  whole base buffer regardless of overlay width, but the full-width overlay also
  prevents the transcript from peeking through beside the panel.)
- On stock/unpatched pi-tui the `backdrop` key is simply ignored, so setting it
  is safe either way — the modal renders undimmed, nothing breaks.

Backdrop limitations (from `pi-patches/pi-tui-backdrop.md`): the dim only scales
truecolor (`38;2`/`48;2`) sequences; palette-number (`38;5;N`) themes and
256-colour terminals silently no-op. Cost is one regex pass per rendered line per
frame while a backdrop overlay is visible — negligible for a modal.

## Installing the extension (persistent, not `-e`)

The extension is loaded from the **pi-workflow package**, whose `package.json`
declares `"pi": { "extensions": ["./extensions"], "skills": ["./skills"] }` — so
installing the package loads `extensions/pipeline.ts` and `extensions/ui/`
together. You do not need `-e`.

```sh
# From the pi-workflow checkout (uses the working tree on the current branch):
pi install ./path/to/pi-workflow

# Verify:
pi list | grep pi-workflow
```

`pi install ./local/path` adds the source to `~/.pi/agent/settings.json`
(`packages[]`). To use it project-locally instead, add `-l` (writes
`.pi/settings.json`).

Via Nix / Home Manager: `programs.pi.coding-agent` + the `home.activation`
install loop in fleek's `pi.nix` installs
`git:github.com/Roni1993/pi-workflow` and the other packages. To install this
branch's checkout instead, either switch the activation source to the local
path or run `pi install ./path/to/pi-workflow` once (it is guarded by
`pi list` in that file).

### Prerequisites (two branches)

| Need | Branch / worktree |
|---|---|
| The extension modules (`extensions/ui/`) | `feat/ui-opencode` (this extension's base) |
| Patched pi 0.85.1: transcript seam + numeric backdrop | `feat/pi-ui` in the fleek worktree (`/home/roni/projects/fleek-pi-ui`) |

The stock/npm pi (`0.81.1` currently on `PATH`, alongside the patched `0.85.1`
in the nix store) runs the pipeline + modal fine, but:

- `registerMessageRenderer("user"|"assistant")` (transcript cards) requires the
  transcript-seam patch.
- The dimmed backdrop requires the pi-tui-backdrop patch.

Neither patch is switched into the **active** profile yet — see REPORT.md.

## Run / verify commands

```sh
# Type-check / bundle the extension exactly as pi would load it (clean = no output):
npx --yes esbuild@0.23.1 extensions/ui/index.ts --bundle --format=esm \
  --platform=node --external:@earendil-works/pi-coding-agent \
  --external:@earendil-works/pi-tui --outfile=/tmp/ui.js --log-level=warning

# The pipeline is critical and has no tests — prove it bundles:
npx --yes esbuild@0.23.1 extensions/pipeline.ts --bundle --format=esm \
  --platform=node --external:@earendil-works/pi-coding-agent \
  --external:@earendil-works/pi-tui --outfile=/tmp/pipeline.js --log-level=warning

# Headless suites (no framework, no pi):
bash tests/ui-render.sh       # ui-kit cards          — 107 checks
bash tests/ui-questions.sh    # questions modal       — 564 checks
bash tests/ui-dock.sh         # dock                  — 1652 checks
bash tests/ui-tools.sh        # tools box             — 282 checks
bash tests/ui-cards.sh        # custom message cards  — 740 checks
bash tests/ui-transcript.sh   # transcript cards      — 2414 checks
PERF_PROFILE=1 bash tests/ui-perf.sh   # read-only perf + --cpu-prof summary

# Load against a pi build (patched 0.85.1 requires the unminified dist entry):
pi -ne -e ./extensions/ui/index.ts --help   # exit 0, no extension errors
```

Every render suite bundles with `--alias:@earendil-works/pi-tui=./tests/pi-tui-stub.mjs`
and asserts, at widths 20/40/80/120, that nothing throws and no line is wider
than the terminal.

## Perf / scope caveats

- **Width safety is the hard contract.** Every rendered line is truncated with
  code-point counting so PUA powerline chevrons stay 1 cell. A line-wider-than-
  terminal is a fatal TUI crash, hence the width suites.
- **T4 tools grouping.** Real pi renders one component per tool call; the
  prototype's single box wrapping all calls is not reachable. The "latest 3
  open" rule is best-effort via a module-level recent-call list. See
  `tools.ts` header.
- **Transcript seam is all-or-nothing.** When the seam is present, the UI owns
  user/assistant rendering; when absent, pi's default rendering is used. There is
  no per-message mix.
- **The dock poll** runs every ~1.5 s and reads `index.json` + one `out.jsonl`
  tail + one `tmux has-session` per agent. Measured in `tests/ui-perf.ts`; it is
  read-only and never writes to `~/.pi/agent/bg`.
- **No pixel verification.** All suites are headless; visual appearance is
  asserted only indirectly (width bounds, ANSI shape). A human still has to
  eyeball `/ui-kit`, `/ui-dock`, `/ui-questions`, `/pipeline`.
