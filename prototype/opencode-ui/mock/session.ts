// Mock full-screen session render — the locked opencode-look UI as a whole,
// so it can be reviewed and used as a test target.
// Built with a stubbed pi-tui and run under node; emits ANSI + HTML + txt.
import { mkdirSync, writeFileSync } from "node:fs"
import { visibleWidth } from "@earendil-works/pi-tui"
import { renderTranscript, renderTranscriptDirect } from "../extensions/grill-transcript"
import { chatView, dashboardView, statusWidget } from "../extensions/grill-dock"
import { GrillQuestions } from "../extensions/grill-questions"
import { PAL, bgOpen, bold, card, fg, fgOpen, mix, RESET, tinted } from "../lib/ui-kit"

const W = 120
const PW = 72 // modal panel width
const DIM = 0.38 // backdrop dim factor
const OUT = process.env.UI_MOCK_OUT ?? `${process.cwd()}/mock`

// ── ANSI helpers: dim a backdrop, slice by visible columns, composite a panel ──
function dimAnsi(line: string, f: number): string {
  return line.replace(/\x1b\[(38|48);2;(\d+);(\d+);(\d+)m/g, (_s, kind, r, g, b) => {
    const s = (x: string) => Math.round(Number(x) * f)
    return `\x1b[${kind};2;${s(r)};${s(g)};${s(b)}m`
  })
}

function sliceVisible(line: string, start: number, end: number): string {
  const re = /\x1b\[([0-9;]*)m/g
  let fg: string | null = null
  let bg: string | null = null
  let bold = false
  let col = 0
  let out = ""
  let last = 0
  let m: RegExpExecArray | null
  const style = () => (fg ?? "") + (bg ?? "") + (bold ? "\x1b[1m" : "")
  const push = (text: string) => {
    if (!text) return
    const chars = [...text]
    const c0 = col
    col += chars.length
    const s = Math.max(start, c0)
    const e = Math.min(end, col)
    if (s < e) out += style() + chars.slice(s - c0, e - c0).join("")
  }
  while ((m = re.exec(line))) {
    push(line.slice(last, m.index))
    last = re.lastIndex
    const codes = m[1]!.split(";").map(Number)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]!
      if (c === 0) { fg = null; bg = null; bold = false }
      else if (c === 1) bold = true
      else if (c === 22) bold = false
      else if (c === 39) fg = null
      else if (c === 49) bg = null
      else if (c === 38 && codes[i + 1] === 2) { fg = `\x1b[38;2;${codes[i + 2]};${codes[i + 3]};${codes[i + 4]}m`; i += 4 }
      else if (c === 48 && codes[i + 1] === 2) { bg = `\x1b[48;2;${codes[i + 2]};${codes[i + 3]};${codes[i + 4]}m`; i += 4 }
    }
    if (col >= end) break
  }
  push(line.slice(last))
  return out
}

function overlayPanel(base: string, panel: string, left: number): string {
  const pw = visibleWidth(panel)
  const bw = visibleWidth(base)
  const l = sliceVisible(base, 0, left)
  const r = sliceVisible(base, left + pw, bw)
  return `\x1b[0m${l}\x1b[0m${panel}\x1b[0m${r}`
}

// ── surfaces ────────────────────────────────────────────────────────────────
const transcriptBoxed = () => renderTranscript(W).slice(0, -4) // drop prototype legend
const transcriptDirect = () => renderTranscriptDirect(W)
const dockChat = () => chatView(W, 0).slice(0, -1) // drop prototype footer
const dockDashboard = () => dashboardView(W)
const questionPanel = () => new GrillQuestions(() => {}).render(PW)
const submitPanel = () => {
  const q = new GrillQuestions(() => {})
  q.handleInput("\t")
  q.handleInput("\t")
  return q.render(PW)
}
const panelMulti = () => {
  const q = new GrillQuestions(() => {})
  q.handleInput("\t")
  return q.render(PW)
}
const panelNote = () => {
  const q = new GrillQuestions(() => {})
  q.handleInput("n")
  return q.render(PW)
}
const panelCustom = () => {
  const q = new GrillQuestions(() => {})
  q.handleInput("t")
  return q.render(PW)
}

/** Compose a modal: dim the whole base, then splice the centred panel over it. */
function modalOver(base: string[], panel: string[]): string[] {
  const dim = base.map((l) => dimAnsi(l, DIM))
  const p = panel.map((l) => sliceVisible(l, 0, PW))
  const top = Math.max(0, Math.floor((dim.length - p.length) / 2))
  const left = Math.floor((W - PW) / 2)
  return dim.map((l, i) => {
    const pi = i - top
    return pi >= 0 && pi < p.length ? overlayPanel(l, p[pi]!, left) : l
  })
}

const title = (t: string) => `\x1b[1m${t}\x1b[22m`

// ── user-message treatments IN THE NO-BOX VARIANT ───────────────────────────
function userTreatments(): { name: string; lines: string[] }[] {
  const USER = "add caching to the API client"
  const AGENT = "I'll add an in-memory TTL cache in front of fetch(), keyed by URL."
  const agentCtx = () => fg(PAL.agent.rail, "│ ") + fg(PAL.text, AGENT)
  const strong = { rail: PAL.me.rail, bg: tinted(PAL.me.rail, 0.3) }
  const onAccent = mix(PAL.me.rail, "#000000", 0.82)
  const solid = (content: string, width: number) => {
    const pad = Math.max(0, width - 2 - visibleWidth(content))
    return bgOpen(PAL.me.rail) + fgOpen(PAL.me.rail) + "▌ " + fgOpen(onAccent) + content + " ".repeat(pad) + RESET
  }
  return [
    { name: "1 · current  ›", lines: [fg(PAL.me.rail, "› ") + fg(PAL.text, USER), agentCtx()] },
    { name: "2 · bold + ❯", lines: [bold(fg(PAL.me.rail, "❯ ")) + bold(fg(PAL.text, USER)), agentCtx()] },
    { name: "3 · full rail ▌ + bold", lines: [fg(PAL.me.rail, "▌ ") + bold(fg(PAL.text, USER)), agentCtx()] },
    { name: "4 · solid accent bar, dark text", lines: [solid(USER, W), agentCtx()] },
    { name: "5 · label you + bold", lines: [fg(PAL.dim, "you  ") + bold(fg(PAL.text, USER)), agentCtx()] },
    { name: "6 · highlight fill (only boxed line)", lines: [...card(W, strong, [bold(fg(PAL.text, USER))]), agentCtx()] },
  ]
}

const frames: { title: string; lines: string[] }[] = [
  {
    title: "questions — opencode-style modal (chosen)",
    lines: [title("QUESTIONS  ·  opencode-style modal over dimmed transcript"), "", ...modalOver(transcriptBoxed(), questionPanel())],
  },
  {
    title: "session — boxed transcript + modal + dock",
    lines: [title("SESSION  ·  transcript + questions modal + dock"), "", ...modalOver([...transcriptBoxed(), "", ...dockChat()], questionPanel())],
  },
  {
    title: "session (no modal) — boxed transcript + dock",
    lines: [title("SESSION (NO MODAL)  ·  boxed transcript + dock"), "", ...transcriptBoxed(), "", ...dockChat()],
  },
  {
    title: "session (no modal) — no-box variant + dock",
    lines: [title("SESSION (NO MODAL)  ·  no-box variant + dock"), "", ...transcriptDirect(), "", ...dockChat()],
  },
  {
    title: "dashboard — workflow + nested agents + modal",
    lines: [title("DASHBOARD  ·  dock dashboard + questions modal"), "", ...modalOver([...transcriptBoxed(), "", ...dockDashboard()], questionPanel())],
  },
  {
    title: "submit — questions recap modal",
    lines: [title("SUBMIT  ·  questions recap modal"), "", ...modalOver([...transcriptBoxed(), "", ...dockChat()], submitPanel())],
  },
  {
    title: "questions — multi-select step (circle fill)",
    lines: [title("QUESTIONS  ·  multi-select step (● / ○)"), "", ...modalOver(transcriptBoxed(), panelMulti())],
  },
  {
    title: "questions — note row (n)",
    lines: [title("QUESTIONS  ·  note row (n)"), "", ...modalOver(transcriptBoxed(), panelNote())],
  },
  {
    title: "questions — focused Type something. (t)",
    lines: [title("QUESTIONS  ·  focused custom row (t)"), "", ...modalOver(transcriptBoxed(), panelCustom())],
  },
  {
    title: "dock — /dock on status widget",
    lines: [title("DOCK STATUS WIDGET  ·  /dock on (below editor)"), "", ...statusWidget({}, {}).render(W)],
  },
  {
    title: "user message — treatments (in the no-box variant)",
    lines: [title("USER MESSAGE  ·  treatments (no-box variant)"), "", ...userTreatments().flatMap((t) => [`\x1b[1m${t.name}\x1b[22m`, ...t.lines, ""])],
  },
]

// ── ANSI -> HTML ─────────────────────────────────────────────────────────────
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
    const clean = esc(text.replace(/\uE0B0/g, "❯").replace(/\uE0B2/g, "❮"))
    const st: string[] = []
    if (fg) st.push(`color:${fg}`)
    if (bg) st.push(`background:${bg}`)
    if (bold) st.push("font-weight:700")
    return st.length ? `<span style="${st.join(";")}">${clean}</span>` : clean
  }
  while ((m = re.exec(line))) {
    out += span(line.slice(last, m.index))
    last = re.lastIndex
    const codes = m[1]!.split(";").map(Number)
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
