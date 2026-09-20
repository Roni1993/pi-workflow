// T3 — HITL questions modal. Port of pi-opencode-ui/extensions/grill-questions.ts:
// Powerline chevron stepper, preview box above tightly-stacked options, inverted
// focused row, circle-fill multi-select, "Type something." as the last navigable
// row, and a one-box Submit recap on a deeper second background.
//
// Two entry points:
//   renderQuestions(state, width)  — pure, headless-testable renderer
//   askQuestions(ui, questions)    — modal over ctx.ui.custom, returns answers
//
// Real typed input (notes + custom answers) uses pi-tui's Input. While the editor
// is open every key routes to it; Enter commits the text and returns to the list.
import type { ExtensionAPI, ExtensionCommandContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent"
import { Input, matchesKey, type Component, type OverlayOptions } from "@earendil-works/pi-tui"
import {
  M,
  PAL,
  type Pair,
  bgOpen,
  bold,
  card,
  cardLine,
  fg,
  fgOpen,
  lighten,
  mix,
  tinted,
  truncateAnsi,
  visibleWidth,
} from "./ui-kit"

export interface QuestionOption {
  label: string
  desc: string
  preview: string[]
  recommended?: boolean
}

export interface Question {
  header: string
  question: string
  options: QuestionOption[]
  multi?: boolean
}

/** One answer per question. `custom` is the typed "Type something." text. */
export interface Answer {
  header: string
  selected: string[]
  note?: string
  custom?: string
}

/**
 * Pure render state. `qi === questions.length` means the Submit recap step.
 * `focused === options.length` means the "Type something." row.
 * `checked` / `picked` / `notes` / `custom` are indexed per question.
 */
export interface QuestionsState {
  questions: Question[]
  qi: number
  focused: number
  picker: number
  checked: number[][]
  picked: (number | null)[]
  notes: string[]
  custom: string[]
  noteOpen: boolean
  editing: "note" | "custom" | null
}

const ACCENT = M.secondary
const ON_ACCENT = mix(M.secondary, "#000000", 0.82)
const QB: Pair = { rail: M.secondary, bg: tinted(M.secondary) }

/** T9: set true once the pi-tui backdrop patch lands (dims behind the modal). */
const BACKDROP = false

/** Inverted focused row: solid accent background, dark same-hue text, rail unchanged. */
function invertedLine(width: number, plain: string): string {
  const pad = Math.max(0, width - 2 - visibleWidth(plain))
  return bgOpen(ACCENT) + fgOpen(QB.rail) + "▌ " + fgOpen(ON_ACCENT) + plain + " ".repeat(pad) + "\x1b[0m"
}

/** Recap answer row: deeper second background starting at an inner rail. */
function answerLine(width: number, content: string): string {
  const deep = mix(QB.bg, "#000000", 0.22)
  const inner = lighten(ACCENT, 0.3)
  const left = bgOpen(QB.bg) + fgOpen(QB.rail) + "▌ "
  const right = bgOpen(deep) + fgOpen(inner) + "▏ " + content
  const pad = Math.max(0, width - 4 - visibleWidth(content))
  return left + right + " ".repeat(pad) + "\x1b[0m"
}

/** Powerline breadcrumb (U+E0B2 cap, U+E0B0 transitions/trailing). */
function stepper(state: QuestionsState): string {
  const RIGHT = "\uE0B0"
  const LEFT = "\uE0B2"
  const active = state.qi
  const labels = [...state.questions.map((q) => q.header), "Submit"]
  // 3 shades of the one accent: upcoming (light) → done (mid) → active (solid)
  const doneBg = mix(QB.bg, ACCENT, 0.45)
  const upBg = mix(QB.bg, ACCENT, 0.12)
  const bg = labels.map((_, i) => (i < active ? doneBg : i === active ? ACCENT : upBg))
  const fgCol = labels.map((_, i) => (i < active ? PAL.text : i === active ? ON_ACCENT : PAL.dim))

  let s = bgOpen(QB.bg) + fgOpen(bg[0]!) + LEFT // left cap
  labels.forEach((label, i) => {
    s += bgOpen(bg[i]!) + fgOpen(fgCol[i]!) + ` ${label} `
    const next = i < labels.length - 1 ? bg[i + 1]! : QB.bg
    s += bgOpen(next) + fgOpen(bg[i]!) + RIGHT
  })
  return s
}

function selectedLabels(state: QuestionsState, q: Question, i: number): string[] {
  if (q.multi) {
    return [...(state.checked[i] ?? [])]
      .sort((a, b) => a - b)
      .filter((k) => q.options[k])
      .map((k) => q.options[k]!.label)
  }
  const p = state.picked[i]
  return p != null && q.options[p] ? [q.options[p]!.label] : []
}

function questionView(state: QuestionsState, width: number): string[] {
  const q = state.questions[state.qi]!
  const o = q.options[state.focused]
  const out: string[] = []
  out.push(cardLine(width, QB, ""), cardLine(width, QB, stepper(state)), cardLine(width, QB, fg(PAL.text, bold(q.question))), cardLine(width, QB, ""))
  out.push("")
  const preview = o ? o.preview : ["type your own answer in the row below"]
  out.push(...card(width, PAL.tools, [fg(PAL.dim, o ? "preview" : "your answer"), ...preview.map((p) => fg(PAL.text, "  " + p))]))
  out.push("")
  out.push(cardLine(width, QB, "")) // answers box: top padding

  q.options.forEach((opt, i) => {
    const on = i === state.focused
    const checked = (state.checked[state.qi] ?? []).includes(i)
    const mark = q.multi ? (checked ? "● " : "○ ") : on ? "▸ " : "  "
    if (on) {
      out.push(invertedLine(width, `${mark}${opt.label}   ${opt.desc}${opt.recommended ? "   recommended" : ""}`))
    } else {
      const box = q.multi ? fg(checked ? ACCENT : PAL.dim, checked ? "●" : "○") + " " : "  "
      out.push(
        cardLine(
          width,
          QB,
          box + fg(PAL.text, opt.label) + fg(PAL.dim, `   ${opt.desc}`) + (opt.recommended ? fg(PAL.think.rail, "   recommended") : ""),
        ),
      )
    }
  })

  {
    const on = state.focused === q.options.length
    const typed = state.custom[state.qi] ?? ""
    const text = typed ? "› " + typed : "Type something."
    const cursor = state.editing === "custom" ? "█" : ""
    const mark = q.multi ? (typed ? "● " : "○ ") : on ? "▸ " : "  "
    if (on) {
      out.push(invertedLine(width, mark + text + cursor))
    } else {
      const box = q.multi ? fg(typed ? ACCENT : PAL.dim, typed ? "●" : "○") + " " : "  "
      out.push(cardLine(width, QB, box + fg(PAL.dim, text)))
    }
  }

  if (state.noteOpen) {
    const txt = state.notes[state.qi] ?? ""
    const cursor = state.editing === "note" ? "█" : ""
    out.push(cardLine(width, QB, "  " + fg(PAL.dim, "note   ") + fg(PAL.text, txt) + fg(PAL.me.rail, cursor)))
  }
  out.push(cardLine(width, QB, "")) // answers box: bottom padding
  out.push("")
  out.push(fg(PAL.dim, "  ↑↓ focus · space/enter select · tab step · n note · t type · esc cancel"))
  return out
}

function submitView(state: QuestionsState, width: number): string[] {
  const out: string[] = []
  out.push(cardLine(width, QB, ""), cardLine(width, QB, stepper(state)), cardLine(width, QB, fg(PAL.text, bold("Review your answers"))), cardLine(width, QB, ""))
  out.push("")
  // all Q&A in ONE box; the answer line sits on a deeper (2nd) background with an inner rail
  const recap: string[] = [cardLine(width, QB, "")]
  state.questions.forEach((q, i) => {
    const parts = selectedLabels(state, q, i)
    const custom = (state.custom[i] ?? "").trim()
    if (custom) parts.push(custom)
    const ans = parts.length ? parts.join(", ") : "(unanswered)"
    recap.push(cardLine(width, QB, fg(PAL.dim, q.header)))
    recap.push(answerLine(width, fg(PAL.text, ans)))
    if (state.notes[i]) recap.push(answerLine(width, fg(PAL.dim, "note   ") + fg(PAL.text, state.notes[i]!)))
    if (i < state.questions.length - 1) recap.push(cardLine(width, QB, "")) // spacer
  })
  recap.push(cardLine(width, QB, ""))
  out.push(...recap)
  out.push("")
  const pick = ["Submit answers", "Cancel"]
  pick.forEach((p, i) => {
    out.push(i === state.picker ? invertedLine(width, "  " + p) : cardLine(width, QB, fg(PAL.dim, "  " + p)))
  })
  out.push("")
  out.push(fg(PAL.dim, "  ↑↓ choose · enter confirm · tab back · esc cancel"))
  return out
}

/**
 * Pure renderer for the questions modal. Every line is ANSI-truncated to `width`;
 * the kit counts code points so the PUA chevrons stay 1 cell wide.
 */
export function renderQuestions(state: QuestionsState, width: number): string[] {
  const w = Math.max(1, width)
  const view = state.qi >= state.questions.length ? submitView(state, w) : questionView(state, w)
  return view.map((l) => truncateAnsi(l, w))
}

class QuestionsComponent implements Component {
  private qi = 0
  private focused = 0
  private picker = 0
  private readonly checked: number[][]
  private readonly picked: (number | null)[]
  private readonly notes: string[]
  private readonly custom: string[]
  private noteOpen = false
  private editing: "note" | "custom" | null = null
  private input: Input | null = null
  private cachedWidth?: number
  private cached?: string[]

  constructor(
    private readonly questions: Question[],
    private readonly done: (v: Answer[] | null) => void,
  ) {
    this.checked = questions.map(() => [])
    this.picked = questions.map(() => null)
    this.notes = questions.map(() => "")
    this.custom = questions.map(() => "")
  }

  private submitStep(): boolean {
    return this.qi >= this.questions.length
  }
  private q(): Question {
    return this.questions[Math.min(this.qi, this.questions.length - 1)]!
  }
  private move(d: number): void {
    if (this.submitStep()) this.picker = Math.max(0, Math.min(1, this.picker + d))
    else this.focused = Math.max(0, Math.min(this.q().options.length, this.focused + d))
  }
  private advance(): void {
    this.qi = (this.qi + 1) % (this.questions.length + 1)
    this.focused = 0
    this.picker = 0
  }

  /** Open the real text editor for a note or a custom answer; Enter commits. */
  private openEditor(kind: "note" | "custom"): void {
    const qi = this.qi
    const input = new Input()
    const seed = kind === "note" ? this.notes[qi]! : this.custom[qi]!
    if (seed) input.setValue(seed)
    input.onSubmit = (text: string) => {
      if (kind === "note") this.notes[qi] = text
      else this.custom[qi] = text
      this.editing = null
      this.input = null
      this.invalidate()
    }
    input.onEscape = () => {
      this.editing = null
      this.input = null
      this.invalidate()
    }
    this.input = input
    this.editing = kind
  }

  /** Mirror live editor text into render state so the row shows what is typed. */
  private syncEditor(): void {
    if (!this.editing) return
    const v = this.input?.getValue() ?? ""
    if (this.editing === "note") this.notes[this.qi] = v
    else this.custom[this.qi] = v
  }

  private state(): QuestionsState {
    return {
      questions: this.questions,
      qi: this.qi,
      focused: this.focused,
      picker: this.picker,
      checked: this.checked,
      picked: this.picked,
      notes: this.notes,
      custom: this.custom,
      noteOpen: this.noteOpen,
      editing: this.editing,
    }
  }

  private answers(): Answer[] {
    return this.questions.map((q, i) => {
      const selected = selectedLabels(this.state(), q, i)
      const custom = (this.custom[i] ?? "").trim()
      const note = (this.notes[i] ?? "").trim()
      return {
        header: q.header,
        selected,
        ...(note ? { note } : {}),
        ...(custom ? { custom } : {}),
      }
    })
  }

  handleInput(data: string): void {
    if (this.editing) {
      this.input?.handleInput(data)
      this.syncEditor()
      this.invalidate()
      return
    }
    const q = this.q()
    const submit = this.submitStep()
    if (matchesKey(data, "up")) this.move(-1)
    else if (matchesKey(data, "down")) this.move(1)
    else if (matchesKey(data, "enter")) {
      if (submit) {
        this.done(this.picker === 0 ? this.answers() : null)
        return
      }
      if (this.focused === q.options.length) this.openEditor("custom")
      else if (q.multi) {
        const set = this.checked[this.qi]!
        const at = set.indexOf(this.focused)
        at >= 0 ? set.splice(at, 1) : set.push(this.focused)
      } else {
        this.picked[this.qi] = this.focused
        this.advance()
      }
    } else if (data === " ") {
      if (submit) this.picker = this.picker
      else if (this.focused === q.options.length) this.openEditor("custom")
      else if (q.multi) {
        const set = this.checked[this.qi]!
        const at = set.indexOf(this.focused)
        at >= 0 ? set.splice(at, 1) : set.push(this.focused)
      } else this.picked[this.qi] = this.focused
    } else if (matchesKey(data, "tab")) this.advance()
    else if (data === "n") {
      if (submit) {
        // no note affordance on the Submit recap
      } else if (this.noteOpen) this.noteOpen = false
      else {
        this.noteOpen = true
        this.openEditor("note")
      }
    } else if (data === "t") {
      if (!submit) {
        this.focused = q.options.length
        this.openEditor("custom")
      }
    } else if (data === "q" || matchesKey(data, "escape")) {
      this.done(null)
      return
    }
    this.invalidate()
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cached = undefined
  }

  render(width: number): string[] {
    if (this.cached && this.cachedWidth === width) return this.cached
    this.syncEditor()
    this.cached = renderQuestions(this.state(), width)
    this.cachedWidth = width
    return this.cached
  }
}

/** T9: the pi-tui backdrop patch reads `backdrop`; unpatched pi-tui ignores it. */
const overlayOptions: OverlayOptions & { backdrop: boolean } = {
  anchor: "center",
  maxHeight: "90%",
  backdrop: BACKDROP,
}

/**
 * Show the HITL questions modal and resolve with the answers, or null when the
 * user cancels. This is the reusable API for the pipeline (#22); pipeline.ts is
 * intentionally not touched here.
 */
export async function askQuestions(ui: ExtensionUIContext, questions: Question[]): Promise<Answer[] | null> {
  return ui.custom<Answer[] | null>(
    (tui, _theme, _keybindings, done) => {
      const comp = new QuestionsComponent(questions, done)
      return {
        render: (w: number) => comp.render(w),
        invalidate: () => comp.invalidate(),
        handleInput: (data: string) => {
          comp.handleInput(data)
          tui.requestRender()
        },
      }
    },
    { overlay: true, overlayOptions },
  )
}

const DEMO: Question[] = [
  {
    header: "Caching strategy",
    question: "Which caching approach should I implement?",
    options: [
      {
        label: "TTL map",
        desc: "simplest — entries expire after 30s",
        recommended: true,
        preview: [
          "const cache = new Map<string, { v: string; exp: number }>()",
          "get(k) { const e = cache.get(k); return e && e.exp > now() ? e.v : undefined }",
        ],
      },
      {
        label: "LRU map",
        desc: "bounded size, evicts least-recent",
        preview: ["class LRU {", "  get(k) { bump(k) }", "  set(k, v) { if (size > N) evictTail() }", "}"],
      },
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

export function registerQuestions(pi: ExtensionAPI): void {
  pi.registerCommand("ui-questions", {
    description: "HITL questions modal — stepper, preview, multi-select, real typed answers",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const answers = await askQuestions(ctx.ui, DEMO)
      if (answers) ctx.ui.notify(`answered ${answers.length} question(s)`, "info")
    },
  })
}
