// Headless width-safety harness for header + footer. No framework — node:assert.
// Run: bash tests/ui-chrome.sh
import assert from "node:assert"
import { visibleWidth } from "../extensions/ui/ui-kit.ts"
import {
  HIDDEN_THINKING_LABEL,
  WORKING_FRAMES,
  WORKING_MESSAGE,
  applyWorkingHooks,
  renderHeader,
  renderFooter,
} from "../extensions/ui/chrome.ts"

const WIDTHS = [20, 40, 80, 120]
let checks = 0

for (const w of WIDTHS) {
  const cases: string[][] = [
    renderHeader(w),
    renderFooter(w, { cwd: "/home/roni/projects/pi-workflow", branch: "feat/ui-integration", model: "opencode-go/deepseek-v4-flash" }),
    renderFooter(w, { cwd: "~/x" }),
    renderFooter(w, { cwd: "/a/very/long/path/that/should/be/truncated/cleanly/in/a/narrow/terminal", branch: "a-very-long-branch-name-here" }),
  ]
  for (const lines of cases) {
    for (const line of lines) {
      const width = visibleWidth(line)
      assert.ok(width <= w, `over-wide line (${width} > ${w}): ${JSON.stringify(line)}`)
      checks++
    }
  }
}

// ── working hooks: guarded, no throw on stock/partial ui ────────────────────
{
  const calls: string[] = []
  const full = {
    setWorkingIndicator: (o: unknown) => {
      calls.push("indicator")
      assert.deepStrictEqual(o, { frames: WORKING_FRAMES, intervalMs: 120 })
    },
    setWorkingMessage: (m?: string) => {
      calls.push("message")
      assert.strictEqual(m, WORKING_MESSAGE)
    },
    setHiddenThinkingLabel: (l?: string) => {
      calls.push("label")
      assert.strictEqual(l, HIDDEN_THINKING_LABEL)
    },
  }
  applyWorkingHooks(full as never)
  assert.deepStrictEqual(calls, ["indicator", "message", "label"], "all three hooks called in order")
  checks++

  // Stock pi: none of the hooks exist → must not throw.
  assert.doesNotThrow(() => applyWorkingHooks({} as never))
  assert.doesNotThrow(() => applyWorkingHooks(undefined))
  checks += 2

  // Partial (0.81: indicator + label present, setWorkingMessage absent).
  const partial: Record<string, unknown> = {}
  partial.setWorkingIndicator = () => calls.push("partial-indicator")
  partial.setHiddenThinkingLabel = () => calls.push("partial-label")
  assert.doesNotThrow(() => applyWorkingHooks(partial as never))
  assert.ok(!calls.includes("partial-message"), "missing setWorkingMessage must be skipped")
  checks++

  // A throwing hook must be swallowed.
  assert.doesNotThrow(() => applyWorkingHooks({ setWorkingMessage: () => { throw new Error("boom") } } as never))
  checks++
}

console.log(`PASS — ${checks} width checks`)
