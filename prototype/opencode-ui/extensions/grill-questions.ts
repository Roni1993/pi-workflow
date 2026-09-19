/**
 * PROTOTYPE — throwaway. Grill #3: HITL questions overlay (locked layout).
 *
 * Steps: question 1 → question 2 → Submit (recap). Powerline chevron stepper.
 * Locked checkbox = circle fill (● / ○). Preview sits above tightly-stacked
 * options; the focused row inverts (solid accent, dark text, rail unchanged);
 * "Type something." is always the last navigable row; a note row appears on n.
 *
 *   Run:  pi --extension ~/projects/pi-opencode-ui/extensions/grill-questions.ts
 *   Then: /grill-questions
 *         ↑↓ focus · space/enter select · tab step · n note · t type · q close
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { matchesKey, visibleWidth, type Component } from "@earendil-works/pi-tui"
import { M, PAL, RESET, type Pair, bgOpen, bold, card, fg, fgOpen, lighten, mix, tinted } from "../lib/ui-kit"

interface Option {
  label: string
  desc: string
  preview: string[]
  recommended?: boolean
}
interface Question {
  header: string
  question: string
  options: Option[]
  multi?: boolean
}

const QUESTIONS: Question[] = [
  {
    header: "Caching strategy",
    question: "Which caching approach should I implement?",
    options: [
      { label: "TTL map", desc: "simplest — entries expire after 30s", recommended: true, preview: ["const cache = new Map<string, { v: string; exp: number }>()", "get(k) { const e = cache.get(k); return e && e.exp > now() ? e.v : undefined }"] },
      { label: "LRU map", desc: "bounded size, evicts least-recent", preview: ["class LRU {", "  get(k) { bump(k) }", "  set(k, v) { if (size > N) evictTail() }", "}"] },
      { label: "No cache", desc: "leave it; measure first", preview: ["// no change", "// revisit when p95 > 200ms"] },
    ],
  },
  {
    header: "Testing",
    question: "Which tests should I add?",
    multi: true,
    options: [
      { label: "Unit", desc: "cache hit / miss / expiry", preview: ["test('expires after TTL', ...)"] },
      { label: "Integration", desc: "against a real fetch stub", preview: ["test('dedupes inflight', ...)"] },
      { label: "E2E", desc: "full request through the harness", preview: ["test('cold then warm', ...)"] },
    ],
  },
]

const ANSWERS = [["TTL map"], ["Unit", "E2E"]]
const NOTES = ["keep it behind a flag", ""]

const ACCENT = M.secondary
const ON_ACCENT = mix(M.secondary, "#000000", 0.82)
const QB: Pair = { rail: M.secondary, bg: tinted(M.secondary) }

function qLine(width: number, bg: string, railHex: string, styled: string): string {
  const pad = Math.max(0, width - 2 - visibleWidth(styled))
  return bgOpen(bg) + fgOpen(railHex) + "▌ " + styled + " ".repeat(pad) + RESET
}
/** Inverted row: solid accent background, dark same-hue text, rail unchanged. */
function invertedLine(width: number, plain: string): string {
  const pad = Math.max(0, width - 2 - visibleWidth(plain))
  return bgOpen(ACCENT) + fgOpen(QB.rail) + "▌ " + fgOpen(ON_ACCENT) + plain + " ".repeat(pad) + RESET
}

/** Answer row: deeper 2nd background level, starting at an inner rail (like the dock). */
function answerLine(width: number, content: string): string {
  const deep = mix(QB.bg, "#000000", 0.22)
  const inner = lighten(ACCENT, 0.3)
  const left = bgOpen(QB.bg) + fgOpen(QB.rail) + "▌ "
  const right = bgOpen(deep) + fgOpen(inner) + "▏ " + content
  const pad = Math.max(0, width - 4 - visibleWidth(content))
  return left + right + " ".repeat(pad) + RESET
}

/** Strip ANSI so we can count display cells ourselves. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}
function cellCount(s: string): number {
  return [...stripAnsi(s)].length
}

/** Full header line, sized by our own cell count so PUA chevrons don't skew it. */
function headerLine(width: number, content: string): string {
  const pad = Math.max(0, width - 2 - cellCount(content))
  return bgOpen(QB.bg) + fgOpen(QB.rail) + "▌ " + content + " ".repeat(pad) + RESET
}

/** Powerline breadcrumb (U+E0B2 cap, U+E0B0 transitions/trailing). */
function stepper(active: number): string {
  const RIGHT = "\uE0B0"
  const LEFT = "\uE0B2"
  const labels = [...QUESTIONS.map((q) => q.header), "Submit"]
  // 3 shades of the one accent: upcoming (light) → done (mid) → active (solid)
  const doneBg = mix(QB.bg, ACCENT, 0.45)
  const doneFg = PAL.text
  const upBg = mix(QB.bg, ACCENT, 0.12)
  const bg = labels.map((_, i) => (i < active ? doneBg : i === active ? ACCENT : upBg))
  const fg = labels.map((_, i) => (i < active ? doneFg : i === active ? ON_ACCENT : PAL.dim))

  let s = bgOpen(QB.bg) + fgOpen(bg[0]!) + LEFT // left cap
  labels.forEach((label, i) => {
    s += bgOpen(bg[i]!) + fgOpen(fg[i]!) + ` ${label} `
    const next = i < labels.length - 1 ? bg[i + 1]! : QB.bg
    s += bgOpen(next) + fgOpen(bg[i]!) + RIGHT
  })
  return s
}

export class GrillQuestions implements Component {
  private qi = 0
  private focused = 0
  private picker = 0
  private readonly checked = new Set<number>([0, 2])
  private notes = false
  private custom = false
  private readonly done: (v: string | null) => void
  private cachedWidth?: number
  private cached?: string[]

  constructor(done: (v: string | null) => void) {
    this.done = done
  }

  private onSubmit(): boolean {
    return this.qi >= QUESTIONS.length
  }
  private q(): Question {
    return QUESTIONS[Math.min(this.qi, QUESTIONS.length - 1)]!
  }
  private move(d: number): void {
    if (this.onSubmit()) this.picker = Math.max(0, Math.min(1, this.picker + d))
    else this.focused = Math.max(0, Math.min(this.q().options.length, this.focused + d))
  }
  private advance(): void {
    this.qi = (this.qi + 1) % (QUESTIONS.length + 1)
    this.focused = 0
    this.picker = 0
  }

  handleInput(data: string): void {
    const q = this.q()
    if (matchesKey(data, "up")) this.move(-1)
    else if (matchesKey(data, "down")) this.move(1)
    else if (matchesKey(data, "enter")) {
      if (this.onSubmit()) {
        this.done(this.picker === 0 ? "submit" : null)
        return
      }
      if (this.focused === q.options.length) this.custom = true
      else if (q.multi) this.checked.has(this.focused) ? this.checked.delete(this.focused) : this.checked.add(this.focused)
      else this.advance()
    } else if (data === " ") {
      if (this.onSubmit()) this.picker = this.picker
      else if (this.focused === q.options.length) this.custom = !this.custom
      else if (q.multi) this.checked.has(this.focused) ? this.checked.delete(this.focused) : this.checked.add(this.focused)
    } else if (matchesKey(data, "tab")) {
      this.advance()
    } else if (data === "n") this.notes = !this.notes
    else if (data === "t") {
      this.focused = q.options.length
      this.custom = true
    } else if (data === "q" || matchesKey(data, "escape")) {
      this.done(this.onSubmit() ? null : `q${this.qi + 1}`)
      return
    }
    this.invalidate()
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cached = undefined
  }

  private submitView(width: number): string[] {
    const out: string[] = []
    // same header shape as a question: stepper + title (keeps the layout stable)
    out.push(headerLine(width, ""), headerLine(width, stepper(this.qi)), headerLine(width, fg(PAL.text, bold("Review your answers"))), headerLine(width, ""))
    out.push(qLine(width, QB.bg, QB.rail, ""))
    // all Q&A in ONE box; the answer line sits on a deeper (2nd) background with an inner rail
    const recap: string[] = [qLine(width, QB.bg, QB.rail, "")]
    QUESTIONS.forEach((q, i) => {
      const ans = ANSWERS[i]!.length ? ANSWERS[i]!.join(", ") : "(unanswered)"
      recap.push(qLine(width, QB.bg, QB.rail, fg(PAL.dim, q.header)))
      recap.push(answerLine(width, fg(PAL.text, ans)))
      if (NOTES[i]) recap.push(answerLine(width, fg(PAL.dim, "note   ") + fg(PAL.text, NOTES[i]!)))
      if (i < QUESTIONS.length - 1) recap.push(qLine(width, QB.bg, QB.rail, "")) // spacer
    })
    recap.push(qLine(width, QB.bg, QB.rail, ""))
    out.push(...recap)
    out.push(qLine(width, QB.bg, QB.rail, ""))
    const pick = ["Submit answers", "Cancel"]
    pick.forEach((p, i) => {
      out.push(i === this.picker ? invertedLine(width, "  " + p) : qLine(width, QB.bg, QB.rail, fg(PAL.dim, "  " + p)))
    })
    out.push(qLine(width, QB.bg, QB.rail, ""))
    out.push(qLine(width, QB.bg, QB.rail, fg(PAL.dim, "  ↑↓ choose · enter confirm · tab back · esc cancel")))
    return out
  }

  private questionView(width: number): string[] {
    const q = this.q()
    const o = q.options[this.focused]
    const out: string[] = []
    out.push(headerLine(width, ""), headerLine(width, stepper(this.qi)), headerLine(width, fg(PAL.text, bold(q.question))), headerLine(width, ""))
    out.push(qLine(width, QB.bg, QB.rail, ""))
    const preview = o ? o.preview : ["type your own answer in the row below"]
    out.push(...card(width, PAL.tools, [fg(PAL.dim, o ? "preview" : "your answer"), ...preview.map((p) => fg(PAL.text, "  " + p))]))
    out.push(qLine(width, QB.bg, QB.rail, ""))
    out.push(qLine(width, QB.bg, QB.rail, "")) // answers box: top padding

    q.options.forEach((opt, i) => {
      const on = i === this.focused
      const checked = this.checked.has(i)
      const mark = q.multi ? (checked ? "● " : "○ ") : on ? "▸ " : "  "
      if (on) {
        out.push(invertedLine(width, `${mark}${opt.label}   ${opt.desc}${opt.recommended ? "   recommended" : ""}`))
      } else {
        const box = q.multi ? fg(checked ? ACCENT : PAL.dim, checked ? "●" : "○") + " " : "  "
        out.push(qLine(width, QB.bg, QB.rail, box + fg(PAL.text, opt.label) + fg(PAL.dim, `   ${opt.desc}`) + (opt.recommended ? fg(PAL.think.rail, "   recommended") : "")))
      }
    })
    {
      const on = this.focused === q.options.length
      const text = this.custom ? "› your answer" + (on ? "█" : "") : "Type something."
      const mark = q.multi ? (this.custom ? "● " : "○ ") : on ? "▸ " : "  "
      if (on) {
        out.push(invertedLine(width, mark + text))
      } else {
        const box = q.multi ? fg(this.custom ? ACCENT : PAL.dim, this.custom ? "●" : "○") + " " : "  "
        out.push(qLine(width, QB.bg, QB.rail, box + fg(PAL.dim, text)))
      }
    }
    if (this.notes) {
      out.push(qLine(width, QB.bg, QB.rail, "  " + fg(PAL.dim, "note   ") + fg(PAL.text, "remember: keep it behind a flag") + fg(PAL.me.rail, "█")))
    }
    out.push(qLine(width, QB.bg, QB.rail, "")) // answers box: bottom padding
    out.push(qLine(width, QB.bg, QB.rail, ""))
    out.push(qLine(width, QB.bg, QB.rail, fg(PAL.dim, "  ↑↓ focus · space/enter select · tab step · n note · esc cancel")))
    return out
  }

  render(width: number): string[] {
    if (this.cached && this.cachedWidth === width) return this.cached
    // No final truncate: pi-tui miscounts the powerline glyphs, which was
    // trimming the line and leaving the box background short.
    this.cached = this.onSubmit() ? this.submitView(width) : this.questionView(width)
    this.cachedWidth = width
    return this.cached
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("grill-questions", {
    description: "PROTOTYPE: HITL questions overlay — preview, inverted selection, powerline stepper, submit recap",
    handler: async (_args, ctx) => {
      await ctx.ui.custom<string | null>(
        (tui, _theme, _keybindings, done) => {
          const comp = new GrillQuestions(done)
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
