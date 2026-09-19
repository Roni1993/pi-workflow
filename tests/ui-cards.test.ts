// Headless width-safety harness for T5 locked custom-message cards. No framework.
// Run: bash tests/ui-cards.sh
import assert from "node:assert"
import { CARD_KINDS, MAX_CONTENT_LINES, renderCustomCard } from "../extensions/ui/cards.ts"
import { visibleWidth } from "../extensions/ui/ui-kit.ts"

const WIDTHS = [20, 40, 80, 120]

const SHORT = "spawned bg agent a1b2c3 (deepseek-v4-flash)"
const MULTILINE = "goal [active]: ship the dock\nplan: docs/plan.md\nnote: waiting on palette lock"
const VERY_LONG = Array.from({ length: 120 }, (_, i) => `line ${i + 1}: ${"lorem ipsum dolor sit amet ".repeat(3)}`).join("\n")
const EMPTY = ""

const SAMPLES: Array<[string, string]> = [
  ["short", SHORT],
  ["multi-line", MULTILINE],
  ["very-long", VERY_LONG],
  ["empty", EMPTY],
]

let checks = 0

for (const width of WIDTHS) {
  for (const kind of CARD_KINDS) {
    for (const [name, sample] of SAMPLES) {
      const lines = renderCustomCard(kind.customType, sample, width)
      assert.ok(Array.isArray(lines) && lines.length > 0, `${kind.customType}/${name} returned no lines at ${width}`)
      checks++

      for (const line of lines) {
        const vw = visibleWidth(line)
        assert.ok(vw <= width, `${kind.customType}/${name} @${width}: line ${vw} > ${width}\n${JSON.stringify(line)}`)
        checks++
      }

      // Very long content must be capped, with a visible "more lines" footer.
      if (name === "very-long") {
        const body = lines.slice(1, -1) // drop header + trailing padding line
        assert.ok(
          lines.length <= MAX_CONTENT_LINES + 4,
          `${kind.customType} @${width}: uncapped card, ${lines.length} lines`,
        )
        checks++
        assert.ok(
          lines.some((l) => l.includes("more lines")),
          `${kind.customType} @${width}: long content missing "… N more lines" footer`,
        )
        checks++
        assert.ok(body.length >= 1, `${kind.customType} @${width}: no body rendered`)
        checks++
      }
    }
  }
}

console.log(`PASS — ${checks} width checks`)
