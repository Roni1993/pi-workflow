// Model selector, restyled as the opencode modal. Consumes the pi-ui
// `setModelSelector` seam (patched pi only); on stock pi the hook is absent and
// this no-ops, leaving pi's stock selector.
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent"
import { matchesKey, type Component } from "@earendil-works/pi-tui"
import { M, PAL, type Pair, bgOpen, bold, fg, fgOpen, mix, tinted, truncateAnsi, visibleWidth, RESET } from "./ui-kit"

interface ModelLike {
  provider?: unknown
  id?: unknown
}

export interface SelectorData {
  models: ModelLike[]
  current?: ModelLike
  select: (model: unknown, persist?: boolean) => void
  cancel: () => void
}

function modelLabel(m: ModelLike | undefined): string {
  const p = typeof m?.provider === "string" ? m.provider : "?"
  const id = typeof m?.id === "string" ? m.id : "?"
  return `${p}/${id}`
}

const ACCENT = M.secondary
const ON_ACCENT = mix(M.secondary, "#000000", 0.82)
const QB: Pair = { rail: M.secondary, bg: tinted(M.secondary) }
const MAX_ROWS = 12

function qLine(width: number, styled: string): string {
  const pad = Math.max(0, width - 2 - visibleWidth(styled))
  return bgOpen(QB.bg) + fgOpen(QB.rail) + "▌ " + styled + " ".repeat(pad) + RESET
}
function invertedLine(width: number, plain: string): string {
  const pad = Math.max(0, width - 2 - visibleWidth(plain))
  return bgOpen(ACCENT) + fgOpen(QB.rail) + "▌ " + fgOpen(ON_ACCENT) + plain + " ".repeat(pad) + RESET
}

/** Pure renderer for the model modal (headless-testable). */
export function renderModelModal(data: SelectorData, focused: number, width: number): string[] {
  const w = Math.max(0, Math.floor(width))
  if (w <= 0) return [""]
  const models = Array.isArray(data?.models) ? data.models : []
  const current = data?.current ? modelLabel(data.current) : ""
  const out: string[] = []
  out.push(qLine(w, fg(PAL.text, bold("model")) + fg(PAL.dim, `   ${models.length} available`)))
  out.push(qLine(w, ""))
  const shown = models.slice(0, MAX_ROWS)
  shown.forEach((m, i) => {
    const label = modelLabel(m)
    const isCurrent = current !== "" && label === current
    const suffix = isCurrent ? "   current" : ""
    if (i === Math.max(0, Math.min(focused, shown.length - 1))) {
      out.push(invertedLine(w, ` ${label}${suffix}`))
    } else {
      out.push(qLine(w, fg(isCurrent ? ACCENT : PAL.text, ` ${label}`) + fg(PAL.dim, suffix)))
    }
  })
  if (models.length > shown.length) out.push(qLine(w, fg(PAL.dim, `  … ${models.length - shown.length} more`)))
  out.push(qLine(w, ""))
  out.push(fg(PAL.dim, "  ↑↓ move · enter select · esc cancel"))
  return out.map((l) => truncateAnsi(l, w))
}

class ModelModal implements Component {
  private focused = 0
  constructor(private readonly data: SelectorData) {}

  handleInput(key: string): void {
    const n = Array.isArray(this.data?.models) ? this.data.models.length : 0
    if (matchesKey(key, "up")) this.focused = Math.max(0, this.focused - 1)
    else if (matchesKey(key, "down")) this.focused = Math.min(Math.max(0, n - 1), this.focused + 1)
    else if (matchesKey(key, "enter")) {
      const m = this.data.models[this.focused]
      if (m) this.data.select(m, false)
      return
    } else if (matchesKey(key, "escape") || key === "q") {
      this.data.cancel()
      return
    }
    this.invalidate()
  }

  invalidate(): void {}

  render(width: number): string[] {
    try {
      return renderModelModal(this.data, this.focused, width)
    } catch {
      return [truncateAnsi("", Math.max(0, Math.floor(width)))]
    }
  }
}

interface SeamUI {
  setModelSelector?: (factory: (data: SelectorData, tui: unknown, theme: unknown) => Component | undefined) => void
}

export function registerSelectors(pi: ExtensionAPI): void {
  pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
    const ui = ctx?.ui as unknown as (ExtensionUIContext & SeamUI) | undefined
    if (typeof ui?.setModelSelector !== "function") return
    try {
      ui.setModelSelector((data) => new ModelModal(data))
    } catch {
      // seam unavailable — keep the stock selector
    }
  })
}
