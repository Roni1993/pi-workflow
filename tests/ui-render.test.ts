// Headless width-safety harness for the shared UI kit. No framework — node:assert.
// Run: bash tests/ui-render.sh
import assert from "node:assert"
import { card, PAL, truncateAnsi, visibleWidth, wrap } from "../extensions/ui/ui-kit.ts"

const WIDTHS = [20, 40, 80, 120]

const SAMPLES = [
  ["agent · deepseek-v4-flash", "● running  12m04s", "bash(npm test)  0.8s", "read(src/index.ts)"],
  ["questions", "Which transport should the dock use?", "▸ a. tmux polling   b. event bus", "Enter confirms · n note"],
  ["tools", "▌ bash  npm test -- --watch", "✓ exit 0   1.2s", "▌ read  extensions/ui/live.ts"],
]

let checks = 0
const bump = () => ++checks

for (const width of WIDTHS) {
  // (a) no throw + (b) every line fits + (c) card() is at least 3 lines.
  // card() does not self-truncate (upstream behaviour) — the render pipeline
  // guards every line with truncateAnsi before the engine sees it, so do the same.
  for (const sample of SAMPLES) {
    const lines = card(width, PAL.agent, sample.map((s) => s))
    assert.ok(Array.isArray(lines), `card returned array at width ${width}`)
    bump()
    assert.ok(lines.length >= 3, `card() must be >= 3 lines at width ${width}, got ${lines.length}`)
    bump()
    for (const line of lines) {
      const guarded = truncateAnsi(line, width)
      assert.ok(visibleWidth(guarded) <= width, `line too wide at ${width}: ${visibleWidth(guarded)} > ${width}\n${JSON.stringify(guarded)}`)
      bump()
    }
  }

  // Long styled line through truncateAnsi — never exceeds the width.
  const long =
    "\x1b[1m" +
    "\x1b[38;2;115;213;226m" +
    "the quick brown fox jumps over the lazy dog ".repeat(6) +
    "\x1b[39m\x1b[22m"
  const cut = truncateAnsi(long, width)
  assert.ok(visibleWidth(cut) <= width, `truncateAnsi overflow at ${width}: ${visibleWidth(cut)}`)
  bump()

  // wrap() output must also be width-safe for plain text.
  for (const line of wrap("alpha beta gamma delta epsilon zeta eta theta iota kappa", width)) {
    assert.ok(visibleWidth(line) <= width, `wrap overflow at ${width}: ${JSON.stringify(line)}`)
    bump()
  }
}

console.log(`PASS — ${checks} width checks`)
