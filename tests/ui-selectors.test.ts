// Headless width-safety harness for the model-selector modal. node:assert.
// Run: bash tests/ui-selectors.sh
import assert from "node:assert"
import { visibleWidth } from "../extensions/ui/ui-kit.ts"
import { renderModelModal, type SelectorData } from "../extensions/ui/selectors.ts"

const WIDTHS = [20, 40, 80, 120]
let checks = 0

const model = (provider: string, id: string) => ({ provider, id })
const data = (models: unknown[], current?: unknown): SelectorData => ({
  models: models as SelectorData["models"],
  current: current as SelectorData["current"],
  select: () => {},
  cancel: () => {},
})

const CASES: SelectorData[] = [
  data([], undefined),
  data([model("opencode-go", "deepseek-v4-flash")], model("opencode-go", "deepseek-v4-flash")),
  data(
    Array.from({ length: 40 }, (_, i) => model("provider-with-a-long-name", `model-${i}`)),
    model("provider-with-a-long-name", "model-7"),
  ),
  data([{ provider: undefined, id: undefined }], undefined),
]

for (const w of WIDTHS) {
  for (const d of CASES) {
    for (const focus of [0, 3, 11, 39]) {
      for (const line of renderModelModal(d, focus, w)) {
        const width = visibleWidth(line)
        assert.ok(width <= w, `over-wide model modal (${width} > ${w}): ${JSON.stringify(line)}`)
        checks++
      }
    }
  }
}

console.log(`PASS — ${checks} width checks`)
