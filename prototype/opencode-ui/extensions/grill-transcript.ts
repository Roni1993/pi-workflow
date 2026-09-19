/**
 * PROTOTYPE — throwaway. Transcript style, locked on #24.
 *
 * Sections: me · agent · thoughts · tools — each a padded colour card using the
 * shared ui-kit (matugen palette, subtle role tints, full-width backgrounds).
 *   - thoughts: ONE box, all expanded, count + total
 *   - tools: ONE box, single padding section, 1 line between calls, latest 3
 *     open; whole tool line takes the tool colour
 *
 *   Run:  pi --extension ~/projects/pi-opencode-ui/extensions/grill-transcript.ts
 *   Then: /grill-transcript        (q closes)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui"
import { PAL, bold, card, fg, wrap } from "../lib/ui-kit"

const USER = "add caching to the API client"
const SPEECH = "I'll add an in-memory TTL cache in front of fetch(), keyed by URL, and keep the old test output collapsed."

const THOUGHTS = [
  { ms: 148, text: "cache key should be method + URL, not URL alone" },
  { ms: 217, text: "default TTL 30s, but make it configurable" },
  { ms: 246, text: "never cache non-GET requests" },
]
const THOUGHT_TOTAL = THOUGHTS.reduce((a, t) => a + t.ms, 0)

interface Tool {
  kind: string
  name: string
  detail: string
  summary: string
  body?: string[]
  diff?: { old: string[]; new: string[] }
}

const GLYPH: Record<string, string> = { bash: "●", read: "●", edit: "✎", glob: "◇", write: "✚" }

const TOOLS: Tool[] = [
  { kind: "bash", name: "Bash", detail: "rg -n 'fetch' src", summary: "3 matches", body: ["src/client.ts:12: async function fetchJson", "src/client.ts:40: return fetch(url)", "src/client.ts:61: cache.get(key)"] },
  { kind: "glob", name: "Glob", detail: "**/*.test.ts", summary: "4 files" },
  { kind: "read", name: "Read", detail: "src/client.ts:1-80", summary: "80 lines" },
  { kind: "bash", name: "Bash", detail: "npm test -- cache", summary: "1 failed", body: ["FAIL src/cache.test.ts", "  expected fresh value, got cached"] },
  {
    kind: "edit",
    name: "Edit",
    detail: "src/client.ts",
    summary: "+18 −2",
    diff: {
      old: ["89  - [ ] #20 billed-cost measurement", "90  - [ ] #21 failure-mode fingerprint", "91  - [ ] #22 fork rpiv-ask-user-question", "92  - [ ] #23 evaluate/adopt DW primitives"],
      new: ["89  - [ ] #20 billed-cost measurement", "90  - [ ] #21 failure-mode fingerprint", "91  - [ ] #22 fork rpiv-ask-user-question", "92  - [ ] #23 evaluate/adopt DW primitives", "93  + [ ] #24 Prototype: opencode-look Pi UI"],
    },
  },
  { kind: "bash", name: "Bash", detail: "npm test -- cache", summary: "4 passed", body: ["PASS src/cache.test.ts (4 tests)", "Tests: 4 passed, 4 total"] },
  { kind: "write", name: "Write", detail: "src/cache.ts", summary: "+41" },
  { kind: "read", name: "Read", detail: "src/cache.ts", summary: "41 lines" },
]

function diffLines(width: number, oldL: string[], newL: string[]): string[] {
  const half = Math.max(8, Math.floor((width - 5) / 2))
  const rows: string[] = []
  const n = Math.max(oldL.length, newL.length)
  for (let i = 0; i < n; i++) {
    const l = oldL[i]
    const r = newL[i]
    const lc = l === undefined ? "" : truncateToWidth(fg(PAL.ctx, l), half)
    let rc = ""
    if (r !== undefined) {
      rc = l !== undefined && r === l
        ? truncateToWidth(fg(PAL.ctx, r), half)
        : truncateToWidth(fg(PAL.add, bold(r)), half)
    }
    const gap = " ".repeat(Math.max(0, half - visibleWidth(lc)))
    rows.push(lc + gap + fg(PAL.tools.rail, " │ ") + rc)
  }
  return rows
}

function thoughtsCard(width: number): string[] {
  const body = [fg(PAL.think.rail, "✦ ") + fg(PAL.text, `Thoughts · ${THOUGHTS.length}`) + fg(PAL.dim, `  ${THOUGHT_TOTAL}ms   (ctrl+o expand)`)]
  for (const th of THOUGHTS) body.push(fg(PAL.dim, `  ${th.ms}ms  `) + fg(PAL.text, th.text))
  return card(width, PAL.think, body)
}

function toolLine(tool: Tool): string {
  const col = PAL.icon[tool.kind] ?? PAL.tools.rail
  return bold(fg(col, GLYPH[tool.kind] ?? "●")) + " " + fg(col, `${tool.name}  ${tool.detail}  →  ${tool.summary}`)
}

function toolsCard(width: number): string[] {
  const body: string[] = []
  TOOLS.forEach((tool, i) => {
    const open = i >= TOOLS.length - 3
    body.push(toolLine(tool))
    if (open) {
      if (tool.diff) body.push(...diffLines(width, tool.diff.old, tool.diff.new))
      else if (tool.body) for (const b of tool.body) body.push(fg(PAL.text, "   " + b))
    }
    if (i < TOOLS.length - 1) body.push("")
  })
  return card(width, PAL.tools, body)
}

function toolLegend(width: number): string[] {
  const items = ["bash", "read", "edit", "glob", "write"]
  const line = items
    .map((k) => bold(fg(PAL.icon[k] ?? PAL.tools.rail, GLYPH[k] ?? "●")) + " " + fg(PAL.icon[k] ?? PAL.tools.rail, k))
    .join(fg(PAL.dim, "   "))
  return card(width, PAL.tools, [fg(PAL.dim, "tool colours   ") + line])
}

function renderTranscript(width: number): string[] {
  const out: string[] = []
  out.push(...card(width, PAL.me, [fg(PAL.text, USER)]))
  out.push("")
  out.push(...card(width, PAL.agent, wrap(fg(PAL.text, SPEECH), width - 3)))
  out.push("")
  out.push(...thoughtsCard(width))
  out.push("")
  out.push(...toolsCard(width))
  out.push("")
  out.push(...toolLegend(width))
  return out
}

class GrillTranscript implements Component {
  private readonly done: (v: string | null) => void
  private cachedWidth?: number
  private cached?: string[]

  constructor(done: (v: string | null) => void) {
    this.done = done
  }

  handleInput(data: string): void {
    if (data === "q" || matchesKey(data, "escape")) this.done("closed")
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cached = undefined
  }

  render(width: number): string[] {
    if (this.cached && this.cachedWidth === width) return this.cached
    const header = fg(PAL.me.rail, bold("transcript · matugen palette")) + fg(PAL.dim, "   q close")
    const lines = [truncateToWidth(header, width), "", ...renderTranscript(width), "", fg(PAL.dim, "PROTOTYPE — #24; next: /grill-dock.")]
    this.cachedWidth = width
    this.cached = lines.map((l) => truncateToWidth(l, width))
    return this.cached
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("grill-transcript", {
    description: "PROTOTYPE: transcript style — matugen palette, tinted cards",
    handler: async (_args, ctx) => {
      await ctx.ui.custom<string | null>(
        (tui, _theme, _keybindings, done) => {
          const comp = new GrillTranscript(done)
          return {
            render: (w: number) => comp.render(w),
            invalidate: () => comp.invalidate(),
            handleInput: (data: string) => {
              comp.handleInput(data)
              tui.requestRender()
            },
          }
        },
        { overlay: true },
      )
    },
  })
}
