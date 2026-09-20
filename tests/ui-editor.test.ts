// Headless width-safety harness for the editor chatbox framing. node:assert.
// Run: bash tests/ui-editor.sh
import assert from "node:assert"
import { visibleWidth } from "../extensions/ui/ui-kit.ts"
import { frameEditorLines } from "../extensions/ui/editor.ts"

const WIDTHS = [20, 40, 80, 120]
let checks = 0

const SAMPLES: string[][] = [
  ["type a message…"],
  ["", "a longer line of typed text that will need truncating at narrow widths", ""],
  ["\x1b[38;2;200;200;200msome\x1b[39m styled \x1b[1mbold\x1b[22m text"],
  ["unicode ✅ 🚀 日本語 mixed content"],
]

for (const w of WIDTHS) {
  for (const sample of SAMPLES) {
    for (const line of frameEditorLines(sample, w)) {
      const width = visibleWidth(line)
      assert.ok(width <= w, `over-wide editor line (${width} > ${w}): ${JSON.stringify(line)}`)
      checks++
    }
  }
}

console.log(`PASS — ${checks} width checks`)
