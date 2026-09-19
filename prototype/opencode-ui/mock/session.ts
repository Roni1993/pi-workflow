// Mock full-screen session render — composes the locked surfaces into one frame
// so the design can be reviewed as a whole (and used as a test target).
// Built with a stubbed pi-tui and run under node; emits ANSI + HTML + txt.
import { mkdirSync, writeFileSync } from "node:fs"
import { visibleWidth } from "@earendil-works/pi-tui"
import { renderTranscript } from "../extensions/grill-transcript"
import { chatView, dashboardView } from "../extensions/grill-dock"
import { GrillQuestions } from "../extensions/grill-questions"

const W = 120
const OW = 100
const OUT = "/home/roni/projects/pi-opencode-ui/mock"

function center(lines: string[], width: number): string[] {
  const inner = Math.max(0, ...lines.map((l) => visibleWidth(l)))
  const left = Math.max(0, Math.floor((width - inner) / 2))
  return lines.map((l) => " ".repeat(left) + l)
}

function transcriptCards(): string[] {
  return renderTranscript(W).slice(0, -4)
}
function dockChat(): string[] {
  return chatView(W, 0).slice(0, -1)
}
function dockDashboard(): string[] {
  return dashboardView(W)
}
function questionOverlay(): string[] {
  return new GrillQuestions(() => {}).render(OW)
}
function submitOverlay(): string[] {
  const q = new GrillQuestions(() => {})
  q.handleInput("\t")
  q.handleInput("\t")
  return q.render(OW)
}

function frame(title: string, overlay: string[], dock: string[]): string[] {
  return [
    `\x1b[1m${title}\x1b[22m`,
    "",
    ...transcriptCards(),
    "",
    ...center(overlay, W),
    "",
    ...dock,
  ]
}

const frames: { title: string; lines: string[] }[] = [
  { title: "session — transcript + questions overlay + dock", lines: frame("SESSION  ·  transcript + questions overlay + dock", questionOverlay(), dockChat()) },
  { title: "dashboard — dock dashboard (workflow + nested agents)", lines: frame("DASHBOARD  ·  dock dashboard + questions overlay", questionOverlay(), dockDashboard()) },
  { title: "submit — questions submit recap", lines: frame("SUBMIT  ·  questions recap overlay", submitOverlay(), dockChat()) },
]

// ---- ANSI -> HTML -----------------------------------------------------------
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;")

function ansiToHtml(line: string): string {
  let out = ""
  let fg: string | null = null
  let bg: string | null = null
  let bold = false
  const re = /\x1b\[([0-9;]*)m/g
  let last = 0
  let m: RegExpExecArray | null
  const span = (text: string) => {
    if (!text) return ""
    const st: string[] = []
    if (fg) st.push(`color:${fg}`)
    if (bg) st.push(`background:${bg}`)
    if (bold) st.push("font-weight:700")
    return `<span style="${st.join(";")}">${esc(text)}</span>`
  }
  while ((m = re.exec(line))) {
    out += span(line.slice(last, m.index))
    last = re.lastIndex
    const codes = m[1].split(";").map(Number)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]!
      if (c === 0) { fg = null; bg = null; bold = false }
      else if (c === 1) bold = true
      else if (c === 22) bold = false
      else if (c === 39) fg = null
      else if (c === 49) bg = null
      else if (c === 38 && codes[i + 1] === 2) { fg = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; i += 4 }
      else if (c === 48 && codes[i + 1] === 2) { bg = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; i += 4 }
    }
  }
  out += span(line.slice(last))
  return out
}

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "")

mkdirSync(OUT, { recursive: true })

const ansi = frames.map((f) => `\n===== ${f.title} =====\n` + f.lines.join("\n")).join("\n")
writeFileSync(`${OUT}/session.ansi`, ansi)
writeFileSync(`${OUT}/session.txt`, strip(ansi))

const html = `<!doctype html><meta charset="utf-8"><title>pi opencode-ui mock session</title>
<style>
  body{background:#0b0b0d;color:#efdee6;font:13px/1.25 "JetBrainsMono Nerd Font",ui-monospace,monospace;margin:0;padding:24px}
  h2{font:600 14px ui-monospace,monospace;color:#a08b96;margin:28px 0 8px}
  pre{background:#000;padding:10px 0;border:1px solid #261d22;border-radius:6px;overflow-x:auto;margin:0}
  .ln{white-space:pre}
</style>
<h1 style="font:600 16px ui-monospace,monospace;color:#73d5e2">opencode-look Pi UI — mock full-screen session</h1>
${frames.map((f) => `<h2>${f.title}</h2>\n<pre>${f.lines.map((l) => `<div class="ln">${ansiToHtml(l) || "&nbsp;"}</div>`).join("")}</pre>`).join("\n")}
`
writeFileSync(`${OUT}/session.html`, html)

console.log(`wrote ${OUT}/session.{ansi,txt,html}`)
console.log(`frames: ${frames.map((f) => f.lines.length + " lines").join(", ")}`)
