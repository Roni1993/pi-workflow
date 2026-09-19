// Width-safety test: every rendered line must be ≤ the requested width, or pi
// exits with "Rendered line N exceeds terminal width". No framework — asserts.
import assert from "node:assert/strict"
import { visibleWidth } from "@earendil-works/pi-tui"
import { renderTranscript, renderTranscriptDirect } from "../extensions/grill-transcript"
import { chatView, dashboardView, statusWidget } from "../extensions/grill-dock"
import { GrillQuestions } from "../extensions/grill-questions"

const WIDTHS = [20, 40, 80, 120]
const q = () => new GrillQuestions(() => {})

const surfaces: { name: string; render: (w: number) => string[] }[] = [
  { name: "transcript", render: (w) => renderTranscript(w) },
  { name: "transcriptDirect", render: (w) => renderTranscriptDirect(w) },
  { name: "dockChat", render: (w) => chatView(w, 0) },
  { name: "dockDashboard", render: (w) => dashboardView(w) },
  { name: "questions", render: (w) => q().render(w) },
  { name: "questionsMulti", render: (w) => { const c = q(); c.handleInput("\t"); return c.render(w) } },
  { name: "questionsSubmit", render: (w) => { const c = q(); c.handleInput("\t"); c.handleInput("\t"); return c.render(w) } },
  { name: "questionsNote", render: (w) => { const c = q(); c.handleInput("n"); return c.render(w) } },
  { name: "questionsCustom", render: (w) => { const c = q(); c.handleInput("t"); return c.render(w) } },
  { name: "statusWidget", render: (w) => statusWidget({}, {}).render(w) },
]

let checks = 0
for (const s of surfaces) {
  for (const w of WIDTHS) {
    const lines = s.render(w)
    assert.ok(Array.isArray(lines) && lines.length > 0, `${s.name}@${w}: non-empty array`)
    lines.forEach((l, i) => {
      const vw = visibleWidth(l)
      assert.ok(
        vw <= w,
        `${s.name}@${w} line ${i}: width ${vw} > ${w} — ${JSON.stringify(l.replace(/\x1b\[[0-9;]*m/g, ""))}`,
      )
      checks++
    })
  }
}
console.log(`PASS — ${checks} width checks across ${surfaces.length} surfaces × ${WIDTHS.length} widths`)
