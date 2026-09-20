// T4 — headless width-safety harness for the locked tools box. No framework.
// Run: bash tests/ui-tools.sh
import assert from "node:assert"
import { visibleWidth } from "../extensions/ui/ui-kit.ts"
import {
  registerTools,
  renderToolRow,
  renderToolBody,
  type ToolBodyInput,
} from "../extensions/ui/tools.ts"

const WIDTHS = [20, 40, 80, 120]

const ROWS: Array<[string, string, string, string]> = [
  ["bash", "bash", "rg -n 'fetch' src", "3 matches"],
  ["read", "read", "src/client.ts:1-80", "80 lines"],
  ["edit", "edit", "src/client.ts", "+18 −2"],
  ["glob", "find", "**/*.test.ts", "4 files"],
  ["write", "write", "src/cache.ts", "+41"],
  ["unknown_tool", "widget", "some detail here", "42"],
  // deliberately wider than every test terminal
  ["bash", "bash", "npm test -- --watch --coverage ".repeat(4), "long ".repeat(20)],
]

const DIFF = "@@ -1,3 +1,4 @@\n context line\n-removed line\n+added line\n+second added\n context tail"

const BODIES: Array<[string, ToolBodyInput]> = [
  ["bash", ["src/client.ts:12: async function fetchJson", "src/client.ts:40: return fetch(url)"]],
  ["read", "line one\nline two\nline three"],
  ["edit", { diff: DIFF }],
  ["edit", { old: ["a".repeat(80), "b", "c".repeat(80)], new: ["a".repeat(80), "B", "c".repeat(80), "d"] }],
  ["glob", ["src/a.test.ts", "src/b.test.ts", "src/c.test.ts"]],
  ["write", ["Successfully wrote 41 bytes"]],
  ["unknown_tool", ["nothing famous", "second line ".repeat(10)]],
]

let checks = 0
const bump = () => ++checks

for (const width of WIDTHS) {
  for (const [kind, name, detail, summary] of ROWS) {
    const lines = renderToolRow(kind, name, detail, summary, width)
    assert.ok(Array.isArray(lines) && lines.length >= 3, `row lines at w=${width}`)
    bump()
    for (const line of lines) {
      assert.ok(
        visibleWidth(line) <= width,
        `row overflow w=${width}: ${visibleWidth(line)} > ${width} ${JSON.stringify(line)}`,
      )
      bump()
    }
  }

  for (const [kind, body] of BODIES) {
    const lines = renderToolBody(kind, body, width)
    assert.ok(Array.isArray(lines) && lines.length >= 3, `body lines at w=${width}`)
    bump()
    for (const line of lines) {
      assert.ok(
        visibleWidth(line) <= width,
        `body overflow w=${width}: ${visibleWidth(line)} > ${width} ${JSON.stringify(line)}`,
      )
      bump()
    }
  }
}

// Registration is synchronous: the built-in replacements must all be in the
// registry the moment registerTools() returns, so they cannot race pi's startup.
{
  const registered: string[] = []
  registerTools({ registerTool: (t: any) => registered.push(t.name) } as any)
  assert.deepStrictEqual(
    registered.sort(),
    ["bash", "edit", "find", "grep", "ls", "read", "write"],
    `synchronous registration missed tools: ${registered.join(",")}`,
  )
  bump()
}

// Defensive: registration must never throw when the pi surface is odd.
assert.doesNotThrow(() => registerTools({} as any))
bump()
assert.doesNotThrow(() => registerTools({ registerTool: () => {} } as any))
bump()

console.log(`PASS — ${checks} width checks`)