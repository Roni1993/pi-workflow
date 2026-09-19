/**
 * PROTOTYPE — throwaway. Grill #4: multi-select checkbox treatments.
 *
 * The questions overlay uses the locked layout; this grill varies only the
 * checkbox affordance. 7 options (1-7).
 *
 *   Run:  pi --extension ~/projects/pi-opencode-ui/extensions/grill-checkbox.ts
 *   Then: /grill-checkbox     (1-7 variant · ↑↓ focus · space toggle · q close)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui"
import { M, PAL, RESET, type Pair, bgOpen, bold, card, fg, fgOpen, mix, tinted } from "../lib/ui-kit"

const QUESTION = "Which tests should I add?"
const OPTIONS = [
  { label: "Unit", desc: "cache hit / miss / expiry" },
  { label: "Integration", desc: "against a real fetch stub" },
  { label: "E2E", desc: "full request through the harness" },
  { label: "Snapshot", desc: "freeze the rendered output" },
  { label: "None", desc: "skip tests for now" },
]

const ACCENT = M.secondary
const ON_ACCENT = mix(M.secondary, "#000000", 0.82)
const QB: Pair = { rail: M.secondary, bg: tinted(M.secondary) }

const VARIANTS: { name: string; glyph: (on: boolean) => string }[] = [
  { name: "ascii box  [x] / [ ]", glyph: (on) => (on ? "[x]" : "[ ]") },
  { name: "ballot  ☑ / ☐", glyph: (on) => (on ? "☑" : "☐") },
  { name: "check / dot  ✓ / ·", glyph: (on) => (on ? "✓" : "·") },
  { name: "circle fill  ● / ○", glyph: (on) => (on ? "●" : "○") },
  { name: "square fill  ■ / □", glyph: (on) => (on ? "■" : "□") },
  { name: "bracket dot  [●] / [ ]", glyph: (on) => (on ? "[●]" : "[ ]") },
  { name: "heavy circle  ◉ / ◯", glyph: (on) => (on ? "◉" : "◯") },
]

function qLine(width: number, bg: string, railHex: string, styled: string): string {
  const pad = Math.max(0, width - 2 - visibleWidth(styled))
  return bgOpen(bg) + fgOpen(railHex) + "▌ " + styled + " ".repeat(pad) + RESET
}
function invertedLine(width: number, plain: string): string {
  const pad = Math.max(0, width - 2 - visibleWidth(plain))
  return bgOpen(ACCENT) + fgOpen(QB.rail) + "▌ " + fgOpen(ON_ACCENT) + plain + " ".repeat(pad) + RESET
}

class CheckboxGrill implements Component {
  private variant = 0
  private focused = 1
  private readonly checked = new Set<number>([0, 2])
  private readonly done: (v: string | null) => void
  private cachedWidth?: number
  private cached?: string[]

  constructor(done: (v: string | null) => void) {
    this.done = done
  }

  handleInput(data: string): void {
    const n = Number.parseInt(data, 10)
    if (n >= 1 && n <= VARIANTS.length) this.variant = n - 1
    else if (matchesKey(data, "up")) this.focused = Math.max(0, this.focused - 1)
    else if (matchesKey(data, "down")) this.focused = Math.min(OPTIONS.length - 1, this.focused + 1)
    else if (data === " ") {
      this.checked.has(this.focused) ? this.checked.delete(this.focused) : this.checked.add(this.focused)
    } else if (data === "q" || matchesKey(data, "escape")) {
      this.done(`option ${this.variant + 1}: ${VARIANTS[this.variant]!.name}`)
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
    const v = VARIANTS[this.variant]!
    const out: string[] = []

    out.push(...card(width, QB, [
      fg(PAL.dim, "multi-select   ·   choose any"),
      fg(PAL.text, bold(QUESTION)),
    ]))
    out.push("")

    // options, tight; focused row inverted
    OPTIONS.forEach((opt, i) => {
      const on = this.checked.has(i)
      const g = v.glyph(on)
      const focused = i === this.focused
      if (focused) {
        out.push(invertedLine(width, `${g}  ${opt.label}   ${opt.desc}`))
      } else {
        const gcol = on ? ACCENT : PAL.dim
        out.push(qLine(width, QB.bg, QB.rail, fg(gcol, g) + "  " + fg(PAL.text, opt.label) + fg(PAL.dim, `   ${opt.desc}`)))
      }
    })

    const picked = [...this.checked].sort((a, b) => a - b).map((i) => OPTIONS[i]!.label)
    out.push("")
    out.push(fg(PAL.dim, "  selected: ") + (picked.length ? fg(PAL.text, picked.join(", ")) : fg(PAL.dim, "(none)")))
    out.push("")
    out.push(fg(PAL.dim, `  variant ${this.variant + 1}/${VARIANTS.length} · ${v.name}`))
    out.push(fg(PAL.dim, "  ↑↓ focus · space toggle · 1-7 variant · esc close"))

    this.cachedWidth = width
    this.cached = out.map((l) => truncateToWidth(l, width))
    return this.cached
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("grill-checkbox", {
    description: "PROTOTYPE: grill multi-select checkbox treatments — 7 options",
    handler: async (_args, ctx) => {
      const chosen = await ctx.ui.custom<string | null>(
        (tui, _theme, _keybindings, done) => {
          const comp = new CheckboxGrill(done)
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
      if (chosen) ctx.ui.notify(`checkbox grill → ${chosen}`, "info")
    },
  })
}
