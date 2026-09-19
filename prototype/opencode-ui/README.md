# pi-opencode-ui — PROTOTYPE (throwaway) — LOCKED baseline

Answers: **how close can Pi's extension TUI get to opencode's look?** All three
surfaces are locked on issue #24. This is the baseline for building the real
package (Path A: recreate under `@earendil-works/pi-tui`, keep Pi's engine).

## Files

| File | Purpose |
|---|---|
| `lib/ui-kit.ts` | shared kit: matugen palette, colour helpers, padded full-width cards |
| `extensions/grill-transcript.ts` | transcript / message style |
| `extensions/grill-dock.ts` | chatbox + background agent/workflow dock |
| `extensions/grill-questions.ts` | HITL questions overlay (stepper, options, submit recap) |
| `extensions/grill-checkbox.ts` | multi-select checkbox treatments (grill; winner = circle fill) |

## Run

```sh
pi --extension ~/projects/pi-opencode-ui/extensions/grill-transcript.ts   # /grill-transcript
pi --extension ~/projects/pi-opencode-ui/extensions/grill-dock.ts         # /grill-dock, /dock on
pi --extension ~/projects/pi-opencode-ui/extensions/grill-questions.ts    # /grill-questions
pi --extension ~/projects/pi-opencode-ui/extensions/grill-checkbox.ts     # /grill-checkbox
```

## Mock full-screen render (test target)

`mock/session.{html,ansi,txt}` is a composed mock of the locked UI:
- **questions** — opencode-style modal over a dimmed transcript (chosen)
- **session / dashboard / submit** — transcript + dock with the modal
- **transcript variant** — answers & thoughts rendered directly (no box), only the tools bundle boxed

Open `mock/session.html` in a browser for the truecolor version.

Rebuild:

```sh
npx --yes esbuild@0.23.1 mock/session.ts --bundle --format=esm --platform=node \
  --alias:@earendil-works/pi-tui=/tmp/pi-tui-stub.js --outfile=/tmp/session.mjs
node /tmp/session.mjs
```

(`/tmp/pi-tui-stub.js` is a 10-line stub exporting `visibleWidth`, `truncateToWidth`,
`matchesKey`; the render functions are exported from the grills for this.)

## Locked decisions

**Shared language** — palette read live from matugen (`~/.cache/matugen/scheme.json`);
subtle role tints (`surface_container` + ~14% hue); padded full-width cards;
colour spans reset **foreground only** (a full reset clears the card bg);
header/stepper lines are sized by our own ANSI-stripped cell count and skip
pi-tui truncation, because pi-tui miscounts powerline PUA glyphs.

**Transcript** — colour-coded padded cards (rail + bg share a hue); every card
min 3 lines; thoughts in one box, all expanded; tool calls in one box, single
padding section, 1 blank line between calls, latest 3 open, whole tool line
takes the tool colour; per-tool colour on the icon.

**Dock** — `chat` mode: opencode-style chatbox (prompt · blank · session meta ·
blank · workflow status); the rail is a **thinking indicator** (saturated band
travels up/down, magenta ⇄ cyan hue shift). `dashboard`: workflow card with
agents nested via two-tone bg (deep shade starts at the inner `▏` rail), then a
separate `standalone agents` box. `/dock on` installs the status line below the
editor.

**Questions** — powerline chevron stepper (3 shades of the accent); preview box
above tightly-stacked options; focused row inverted (solid accent, dark same-hue
text, rail unchanged); `Type something.` is always the last navigable row; note
row appears on `n`; multi-select uses circle fill `●`/`○`; answers box has
bg-filled padding rows; Submit step = one recap box (answers on a deeper 2nd bg
level with an inner rail) + `Submit answers / Cancel`.

## Not production

No tests, no persistence (except the dock widget), no real key-to-text input
(notes/custom are static). Path B (opentui + SolidJS shell driving Pi over RPC)
is the escalation if Path A isn't enough.
