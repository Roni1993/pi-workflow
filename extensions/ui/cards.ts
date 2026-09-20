// T5 — locked colour-coded cards for pi-workflow's custom messages.
// Pure extension hook: one MessageRenderer per customType emitted by
// bg (bg-output), pipeline (pipe-output), goal (goal-output) and jj (jj-output).
// The card hue matches the source (agent/primary/tertiary/magenta), the body is
// wrapped, and the output is capped so a runaway log never grows unbounded.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import type { Component } from "@earendil-works/pi-tui"
import { M, PAL, bold, card, fg, tinted, truncateAnsi, wrap, type Pair } from "./ui-kit"

/** Keep only the last N wrapped body lines; older lines become a footer count. */
export const MAX_CONTENT_LINES = 20

export interface CardKind {
  customType: string
  label: string
  pair: Pair
}

/** customType → hue + header label. bg=secondary, pipe=primary, goal=tertiary, jj=magenta. */
export const CARD_KINDS: readonly CardKind[] = [
  { customType: "bg-output", label: "bg", pair: PAL.agent },
  { customType: "pipe-output", label: "pipeline", pair: PAL.me },
  { customType: "goal-output", label: "goal", pair: PAL.think },
  { customType: "jj-output", label: "jj", pair: { rail: M.magenta, bg: tinted(M.magenta) } },
]

const byType = (kind: string): CardKind =>
  CARD_KINDS.find((k) => k.customType === kind) ?? { customType: kind, label: kind, pair: PAL.tools }

/** Coerce a message/entry payload to plain text. Never throws on odd shapes. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return p
        if (p && typeof p === "object" && "text" in p) return String((p as { text?: unknown }).text ?? "")
        return ""
      })
      .filter(Boolean)
      .join("\n")
  }
  if (typeof content === "number" || typeof content === "boolean") return String(content)
  return ""
}

/**
 * Pure renderer: one padded, railed, tinted card for a custom message.
 * Every returned line is truncated to `width`, so the result is always safe to
 * hand to the engine (a wider line or a throw exits pi).
 */
export function renderCustomCard(kind: string, content: string, width: number): string[] {
  const w = Math.max(4, Math.floor(width))
  const meta = byType(kind)
  const inner = Math.max(1, w - 2)

  const body: string[] = []
  const src = String(content ?? "").replace(/\r/g, "")
  if (!src.trim()) {
    body.push("(empty)")
  } else {
    for (const raw of src.split("\n")) {
      if (!raw) {
        body.push("")
        continue
      }
      for (const part of wrap(raw, inner)) body.push(part)
    }
  }

  const dropped = Math.max(0, body.length - MAX_CONTENT_LINES)
  const shown = body.slice(-MAX_CONTENT_LINES)

  const lines: string[] = [fg(meta.pair.rail, bold(meta.label)) + fg(PAL.dim, `  ${kind}`)]
  for (const l of shown) lines.push(fg(PAL.text, l))
  if (dropped > 0) lines.push(fg(PAL.dim, `… ${dropped} more lines`))

  return card(w, meta.pair, lines).map((l) => truncateAnsi(l, w))
}

/** Component wrapper around renderCustomCard, cached per width. */
class CustomCard implements Component {
  private cached?: string[]
  private cachedWidth?: number

  constructor(
    private readonly customType: string,
    private readonly content: string,
  ) {}

  invalidate(): void {
    this.cached = undefined
    this.cachedWidth = undefined
  }

  render(width: number): string[] {
    if (this.cached && this.cachedWidth === width) return this.cached
    this.cachedWidth = width
    this.cached = renderCustomCard(this.customType, this.content, width)
    return this.cached
  }
}

/** T5 — register a card renderer per customType. */
export function registerCards(pi: ExtensionAPI): void {
  for (const k of CARD_KINDS) {
    pi.registerMessageRenderer(k.customType, (message) =>
      new CustomCard(k.customType, textOf(message.content)),
    )
    // Durable entries carry arbitrary `data`; only render when it is textual.
    pi.registerEntryRenderer(k.customType, (entry) => {
      const text = textOf(entry.data)
      return text ? new CustomCard(k.customType, text) : undefined
    })
  }
}
