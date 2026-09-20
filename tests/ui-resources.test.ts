// Headless width-safety harness for the loaded-resources sections. node:assert.
// Run: bash tests/ui-resources.sh
import assert from "node:assert"
import { visibleWidth } from "../extensions/ui/ui-kit.ts"
import { renderResourceSection, sectionComponent, type LoadedSection } from "../extensions/ui/resources.ts"

const long = ("skills, prompts, themes, " as string).repeat(30)

const SECTIONS: LoadedSection[] = [
  { name: "Context", header: "[Context]", collapsedBody: "AGENTS.md", expandedBody: `AGENTS.md\nCONTEXT.md\n${long}`, color: "mdHeading", expanded: false },
  { name: "Skills", header: "[Skills]", collapsedBody: "ask-matt, bg, ponytail", expandedBody: "ask-matt\nbg\nponytail", color: "mdHeading", expanded: true },
  { name: "Extensions", header: "[Extensions]", collapsedBody: "", expandedBody: "ui", color: "mdHeading", expanded: false },
  { name: "Unknown", header: "[Unknown]", collapsedBody: "x".repeat(500), expandedBody: "", color: "mdHeading", expanded: true },
  // Diagnostics section names. The loaded-resources seam never dispatches these
  // (they bypass addLoadedSection — see resources.ts header), but the same
  // renderer must stay width-safe if that seam is later widened.
  { name: "Skill conflicts", header: "[Skill conflicts]", collapsedBody: "demo conflicts with demo2", expandedBody: `${long}`, color: "warning", expanded: false },
  { name: "Extension issues", header: "[Extension issues]", collapsedBody: "boom.ts: failed to load", expandedBody: "", color: "warning", expanded: true },
]

const WIDTHS = [20, 40, 80, 120]
let checks = 0

for (const w of WIDTHS) {
  for (const section of SECTIONS) {
    for (const line of renderResourceSection(section, w)) {
      const width = visibleWidth(line)
      assert.ok(width <= w, `over-wide line (${width} > ${w}): ${JSON.stringify(line)}`)
      checks++
    }
    // memoised component path must agree and be width-safe too
    const comp = sectionComponent(section)
    for (const line of comp.render(w)) {
      assert.ok(visibleWidth(line) <= w, `component over-wide > ${w}`)
      checks++
    }
  }
}

console.log(`PASS — ${checks} width checks`)
