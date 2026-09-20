// Headless width-safety harness for the T2 dock. No framework — node:assert.
// Run: bash tests/ui-dock.sh
import assert from "node:assert"
import { visibleWidth } from "../extensions/ui/ui-kit.ts"
import {
  chatView,
  dashboardView,
  deriveDockData,
  statusWidget,
  type DockData,
} from "../extensions/ui/dock.ts"

const WIDTHS = [20, 40, 80, 120]

const agent = (id: string, model: string | undefined, action: string, alive: boolean, status: string) =>
  ({ agent: { id, model, status }, alive, action }) as any

// Representative live sets: running + dead + queued + settled, an undefined
// model, and the empty case.
const RUNNING: DockData = deriveDockData([
  agent("impl-3f2a", "opencode-go/deepseek-v4-pro", "edit(src/client.ts)", true, "running"),
  agent("review1-9c", undefined, "bash(npm test)", true, "running"),
  agent("review2-7b", "opencode-go/glm-5.3-flash", "—", true, "spawning"),
])
const DEAD: DockData = deriveDockData([
  agent("impl-dead", "opencode-go/deepseek-v4-flash", "read(src/a.ts) [ERROR]", false, "running"),
  agent("done-1a", "opencode-go/deepseek-v4-pro", "settled", false, "settled"),
])
const EMPTY: DockData = deriveDockData([])
const UNDEFINED: DockData = deriveDockData([agent("ghost-9d", undefined, "—", false, "unknown")])

const CASES: Array<[string, DockData]> = [
  ["running", RUNNING],
  ["dead", DEAD],
  ["empty", EMPTY],
  ["undefined-model", UNDEFINED],
  ["malformed", { agents: [null, { id: 7 }], counts: { running: "x" } } as any],
]

let checks = 0
const bump = () => ++checks

function check(label: string, width: number, lines: unknown): void {
  assert.ok(Array.isArray(lines), `${label} @${width}: expected string[]`)
  bump()
  for (const line of lines as string[]) {
    assert.strictEqual(typeof line, "string", `${label} @${width}: non-string line`)
    bump()
    const w = visibleWidth(line)
    assert.ok(w <= width, `${label} @${width}: line too wide (${w})\n${JSON.stringify(line)}`)
    bump()
  }
}

for (const width of WIDTHS) {
  for (const [name, data] of CASES) {
    // (a) no throw + (b) every line fits. chatView is animated → try two phases.
    check(`chatView(${name},p0)`, width, chatView(width, 0, data))
    check(`chatView(${name},p9)`, width, chatView(width, 9.4, data))
    check(`dashboardView(${name})`, width, dashboardView(width, data))

    // Status widget factory: render must fit and dispose must clear its interval.
    const widget = statusWidget(() => data)({ requestRender() {} } as any, {} as any)
    check(`statusWidget(${name})`, width, widget.render(width))
    widget.dispose()
    bump()
  }
}

console.log(`PASS — ${checks} width checks`)
