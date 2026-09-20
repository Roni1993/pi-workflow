// Headless width-safety harness for header + footer. No framework — node:assert.
// Run: bash tests/ui-chrome.sh
import assert from "node:assert"
import { visibleWidth } from "../extensions/ui/ui-kit.ts"
import { renderHeader, renderFooter } from "../extensions/ui/chrome.ts"

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

console.log(`PASS — ${checks} width checks`)
