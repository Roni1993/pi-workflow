// T8 — locked transcript cards for the BUILT-IN user/assistant turns.
//
// pi (with the T7 transcript seam, `pi.registerMessageRenderer("user"|"assistant")`)
// hands each built-in turn to a renderer `(message, options, theme) => Component`.
// This module is that renderer: the locked opencode-look user card (PAL.me) and
// assistant card (PAL.agent), with every thinking block collapsed into ONE
// PAL.think thoughts box — exactly the prototype
// `pi-opencode-ui/extensions/grill-transcript.ts` look.
//
// Contract notes (transcript-seam.md):
//   - message.content is a string OR ContentBlock[]; blocks are
//     {type:"text",text} / {type:"thinking",thinking}; unknown types tolerated.
//   - Return undefined when there is nothing to render, so pi keeps stock.
//   - Live streaming: the seam reuses the component and re-renders as text
//     arrives; we re-read message.content on every render (never cache content).
//   - Width safety is non-negotiable: every line goes through truncateAnsi or
//     pi exits with "Rendered line exceeds terminal width".
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Markdown, type Component, type MarkdownTheme } from "@earendil-works/pi-tui"
import { M, PAL, bold, card, fg, truncateAnsi, wrap } from "./ui-kit"

/** Parsed view of a turn: plain text + the text of every thinking block. */
export interface TranscriptParts {
  text: string
  thinking: string[]
}

/** A ContentBlock we know how to read; unknown blocks are ignored. */
interface Block {
  type?: unknown
  text?: unknown
  thinking?: unknown
}

/**
 * Coerce a turn's content (string | ContentBlock[] | anything) into text +
 * thinking strings. Never throws, tolerates unknown block types.
 */
export function blocksToParts(content: unknown): TranscriptParts {
  if (typeof content === "string") return { text: content, thinking: [] }
  if (content === null || content === undefined) return { text: "", thinking: [] }
  if (!Array.isArray(content)) return { text: "", thinking: [] }

  const texts: string[] = []
  const thinking: string[] = []
  for (const raw of content) {
    if (typeof raw === "string") {
      texts.push(raw)
      continue
    }
    if (!raw || typeof raw !== "object") continue
    const b = raw as Block
    if (b.type === "text") texts.push(String(b.text ?? ""))
    else if (b.type === "thinking") thinking.push(String(b.thinking ?? b.text ?? ""))
    // unknown block types (image, toolCall, …) are tolerated and skipped
  }
  return { text: texts.join("\n"), thinking }
}

/** Plain text of a turn, for the user card. */
function plainText(content: unknown): string {
  return blocksToParts(content).text
}

/** Wrap a multi-line plain string, emitting empty lines for blank input lines. */
function bodyLines(text: string, inner: number): string[] {
  const out: string[] = []
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    if (!raw) {
      out.push("")
      continue
    }
    for (const part of wrap(raw, Math.max(1, inner))) out.push(part)
  }
  return out
}

/**
 * Markdown theme for the card body. pi's stock `getMarkdownTheme()` pulls the
 * interactive theme's own colours; inside this card we style with the matugen
 * palette instead. Every function uses `fg()` (or a reset-pair SGR), which
 * resets *foreground only* (`\x1b[39m`) — never a full `\x1b[0m` reset — so the
 * tinted card background opened later by `cardLine` survives every inline
 * reset. `bold()` is ui-kit's `\x1b[1m…\x1b[22m` pair.
 */
const MARKDOWN_THEME: MarkdownTheme = {
  heading: (t) => bold(fg(PAL.text, t)),
  link: (t) => fg(M.primary, t),
  linkUrl: (t) => fg(PAL.dim, t),
  code: (t) => fg(M.tertiary, t),
  codeBlock: (t) => fg(PAL.text, t),
  codeBlockBorder: (t) => fg(PAL.ctx, t),
  quote: (t) => fg(PAL.dim, t),
  quoteBorder: (t) => fg(PAL.ctx, t),
  hr: (t) => fg(PAL.ctx, t),
  listBullet: (t) => fg(M.primary, t),
  bold: (t) => bold(t),
  italic: (t) => `\x1b[3m${t}\x1b[23m`,
  underline: (t) => `\x1b[4m${t}\x1b[24m`,
  strikethrough: (t) => `\x1b[9m${t}\x1b[29m`,
}

/**
 * Render a markdown string into the card's content width via pi-tui's own
 * `Markdown` component (the same renderer stock `AssistantMessageComponent`
 * uses; bundled with the real pi-tui that validates line widths). `paddingX=0`
 * keeps every line inside the card; `defaultTextStyle.color` re-applies
 * `PAL.text` after each inline reset (inline code, links, …) instead of letting
 * it fall back to the terminal default. Trailing pad spaces are trimmed — the
 * card adds its own full-width tinted padding. Lines are not width-guarded here;
 * every caller runs `truncateAnsi` over the finished card.
 */
function markdownLines(text: string, width: number): string[] {
  const inner = Math.max(1, width - 2)
  let rendered: string[]
  try {
    rendered = new Markdown(text.replace(/\r/g, ""), 0, 0, MARKDOWN_THEME, {
      color: (t) => fg(PAL.text, t),
    }).render(inner)
  } catch {
    return bodyLines(text, inner).map((l) => fg(PAL.text, l))
  }
  return rendered.map((l) => (l ? fg(PAL.text, l.replace(/ +$/, "")) : ""))
}

/**
 * Short placeholder for a known non-text block. `image`/`diff` are surfaced as
 * one dim line rather than dropped silently; unknown/toolCall blocks are left
 * to pi's own inline rendering and return undefined.
 */
function placeholderFor(block: Block): string | undefined {
  if (block.type === "image") {
    const mime = typeof (block as { mimeType?: unknown }).mimeType === "string" ? ` ${(block as { mimeType: string }).mimeType}` : ""
    return `[image${mime}]`
  }
  if (block.type === "diff") return "[diff]"
  return undefined
}

/** Placeholder lines for the known non-text blocks of a turn (image/diff). */
export function blockPlaceholders(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const out: string[] = []
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue
    const placeholder = placeholderFor(raw as Block)
    if (placeholder) out.push(placeholder)
  }
  return out
}

/**
 * Locked user card: `PAL.me` rail + tinted full-width background, min 3 lines
 * (ui-kit `card` buffer). Returns [] for empty content so the caller can fall
 * back to pi's stock rendering.
 */
export function renderUserCard(text: string, width: number): string[] {
  const w = Math.max(4, Math.floor(width))
  const src = String(text ?? "").replace(/\r/g, "")
  if (!src.trim()) return []
  const body = bodyLines(src, w - 3).map((l) => fg(PAL.text, l))
  return card(w, PAL.me, body).map((l) => truncateAnsi(l, w))
}

/** ONE thoughts box: all thinking blocks expanded, with count + total chars. */
function thoughtsBox(width: number, thinking: string[]): string[] {
  const total = thinking.reduce((a, t) => a + t.length, 0)
  const body: string[] = [
    fg(PAL.think.rail, "✦ ") +
      fg(PAL.text, `Thoughts · ${thinking.length}`) +
      fg(PAL.dim, `   ${total} chars   (ctrl+o expand)`),
  ]
  for (const t of thinking) {
    const lines = bodyLines(String(t ?? ""), width - 5)
    if (!lines.length || (lines.length === 1 && lines[0] === "")) {
      body.push(fg(PAL.dim, "  (empty)"))
      continue
    }
    for (const l of lines) body.push(fg(PAL.dim, "  ") + fg(PAL.text, l))
  }
  return card(width, PAL.think, body)
}

/**
 * Locked assistant card: text in a `PAL.agent` card, ALL thinking blocks in ONE
 * `PAL.think` box below it. Returns [] when there is nothing renderable.
 * `content` may be a string or a ContentBlock[].
 */
export function renderAssistantCard(content: unknown, width: number): string[] {
  const w = Math.max(4, Math.floor(width))
  const { text, thinking } = blocksToParts(content)
  const placeholders = blockPlaceholders(content)
  const body = text.trim() ? markdownLines(text, w) : []
  if (text.trim() && placeholders.length) body.push("")
  for (const p of placeholders) body.push(fg(PAL.dim, p))

  const out: string[] = []
  if (body.some((l) => l.trim())) out.push(...card(w, PAL.agent, body))
  if (thinking.length) {
    if (out.length) out.push("")
    out.push(...thoughtsBox(w, thinking))
  }
  return out.map((l) => truncateAnsi(l, w))
}

/** Pull `content` off a pi message; tolerate a bare content value. */
function contentOf(message: unknown): unknown {
  if (message && typeof message === "object" && "content" in (message as Record<string, unknown>)) {
    return (message as { content?: unknown }).content
  }
  return message
}

/**
 * Component around the pure renderers. The T7 seam rebuilds it with the latest
 * partial message on every stream tick, but we also implement `updateContent`
 * (and the optional setExpanded/setOutputPad hooks) so an update in place works.
 * Content is re-read on each render; a throw degrades to no lines, never to a
 * crashed pi.
 */
class TranscriptTurn implements Component {
  private cached?: string[]
  private cachedWidth?: number

  constructor(
    private readonly kind: "user" | "assistant",
    private message: unknown,
    private streaming = false,
  ) {}

  /** Streaming seam hook: same instance, grown message. */
  updateContent(message: unknown, streaming = false): void {
    this.message = message
    this.streaming = streaming
    this.invalidate()
  }
  setExpanded(): void {}
  setOutputPad(): void {}

  invalidate(): void {
    this.cached = undefined
    this.cachedWidth = undefined
  }

  render(width: number): string[] {
    if (this.cached && this.cachedWidth === width) return this.cached
    let lines: string[] = []
    try {
      const content = contentOf(this.message)
      lines =
        this.kind === "user"
          ? renderUserCard(plainText(content), width)
          : renderAssistantCard(content, width)
    } catch {
      lines = []
    }
    this.cachedWidth = width
    this.cached = lines
    return lines
  }
}

/** A message is renderable when it has text, thinking, or a known placeholder block. */
function renderable(content: unknown): boolean {
  const { text, thinking } = blocksToParts(content)
  return !!text.trim() || thinking.length > 0 || blockPlaceholders(content).length > 0
}

/** The T7 seam adds `isStreaming` to MessageRenderOptions; read it defensively. */
function isStreaming(options: unknown): boolean {
  return !!(options as { isStreaming?: unknown } | undefined)?.isStreaming
}

/**
 * T8 — register the built-in role renderers. A registered renderer with nothing
 * to draw returns undefined so pi keeps its stock component; a throw is caught
 * here too (the seam also swallows throws).
 */
export function registerTranscript(pi: ExtensionAPI): void {
  if (typeof (pi as { registerMessageRenderer?: unknown })?.registerMessageRenderer !== "function") return

  pi.registerMessageRenderer("user", (message, options) => {
    try {
      if (!renderable(contentOf(message))) return undefined
      return new TranscriptTurn("user", message, isStreaming(options))
    } catch {
      return undefined
    }
  })

  pi.registerMessageRenderer("assistant", (message, options) => {
    try {
      if (!renderable(contentOf(message))) return undefined
      return new TranscriptTurn("assistant", message, isStreaming(options))
    } catch {
      return undefined
    }
  })
}
