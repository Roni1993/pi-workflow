// Headless width-safety harness for T8 locked transcript cards. No framework.
// Run: bash tests/ui-transcript.sh
import assert from "node:assert"
import {
  blockPlaceholders,
  blocksToParts,
  registerTranscript,
  renderAssistantCard,
  renderSummaryCard,
  renderUserCard,
} from "../extensions/ui/transcript.ts"
import { visibleWidth } from "../extensions/ui/ui-kit.ts"

const WIDTHS = [20, 40, 80, 120]

const USER = "add caching to the API client"
const ASSISTANT_TEXT = "I'll add an in-memory TTL cache in front of fetch(), keyed by URL."
const THINKING_A = "cache key should be method + URL, not URL alone"
const THINKING_B = "default TTL 30s, but make it configurable"
const THINKING_C = "never cache non-GET requests"
const EMPTY = ""
const VERY_LONG_TEXT = Array.from(
  { length: 80 },
  (_, i) => `line ${i + 1}: ${"lorem ipsum dolor sit amet ".repeat(4)}`,
).join("\n")
const VERY_LONG_THINKING = Array.from(
  { length: 40 },
  (_, i) => `thought ${i + 1}: ${"reasoning about the cache design ".repeat(4)}`,
).join("\n")

// Markdown fixture: every feature item 15 asks for, in one turn.
const MD_CODE = "const ttl = 30_000"
const MD_INLINE = "wrap `fetch()` with a `Map`"
const MD_LINK_TEXT = "MDN"
const MD_LINK_URL = "https://example.com/docs"
const MD_TABLE_CELL = "ttl"
const MD_MARKDOWN = [
  "## Cache plan",
  "",
  "Use **in-memory TTL** caching: " + MD_INLINE + ".",
  "",
  `A [${MD_LINK_TEXT}](${MD_LINK_URL}) reference.`,
  "",
  "```ts",
  MD_CODE,
  "```",
  "",
  "- key by method + URL",
  "- never cache non-GET",
  "",
  "| option | value |",
  "| ------ | ----- |",
  `| ${MD_TABLE_CELL} | 30s |`,
].join("\n")

/** A render sample: either a user prompt (string) or assistant content blocks. */
interface Sample {
  name: string
  kind: "user" | "assistant"
  content: unknown
}

const SAMPLES: Sample[] = [
  { name: "user-string", kind: "user", content: USER },
  { name: "assistant-string", kind: "assistant", content: ASSISTANT_TEXT },
  { name: "assistant-text-block", kind: "assistant", content: [{ type: "text", text: ASSISTANT_TEXT }] },
  {
    name: "assistant-text+thinking",
    kind: "assistant",
    content: [
      { type: "text", text: ASSISTANT_TEXT },
      { type: "thinking", thinking: THINKING_A },
    ],
  },
  {
    name: "assistant-multi-thinking",
    kind: "assistant",
    content: [
      { type: "thinking", thinking: THINKING_A },
      { type: "text", text: ASSISTANT_TEXT },
      { type: "thinking", thinking: THINKING_B },
      { type: "thinking", thinking: THINKING_C },
      { type: "unknown-block", whatever: 1 },
    ],
  },
  { name: "user-empty", kind: "user", content: EMPTY },
  { name: "user-whitespace", kind: "user", content: "   \n  " },
  { name: "assistant-empty", kind: "assistant", content: EMPTY },
  { name: "assistant-empty-blocks", kind: "assistant", content: [] },
  { name: "assistant-very-long-text", kind: "assistant", content: [{ type: "text", text: VERY_LONG_TEXT }] },
  {
    name: "assistant-very-long-thinking",
    kind: "assistant",
    content: [{ type: "text", text: "ok" }, { type: "thinking", thinking: VERY_LONG_THINKING }],
  },
  { name: "assistant-markdown", kind: "assistant", content: [{ type: "text", text: MD_MARKDOWN }] },
  {
    name: "assistant-markdown+thinking",
    kind: "assistant",
    content: [
      { type: "thinking", thinking: THINKING_A },
      { type: "text", text: MD_MARKDOWN },
      { type: "thinking", thinking: THINKING_B },
    ],
  },
  {
    name: "assistant-image+diff",
    kind: "assistant",
    content: [
      { type: "text", text: ASSISTANT_TEXT },
      { type: "image", data: "AAAA", mimeType: "image/png" },
      { type: "diff", patch: "--- a\n+++ b\n" },
      { type: "toolCall", name: "bash" },
    ],
  },
]

function render(kind: "user" | "assistant", content: unknown, width: number): string[] {
  return kind === "user" ? renderUserCard(content as string, width) : renderAssistantCard(content, width)
}

let checks = 0

// ── pure renderers: no throw + every line fits ──────────────────────────────
for (const width of WIDTHS) {
  for (const sample of SAMPLES) {
    let lines: string[]
    try {
      lines = render(sample.kind, sample.content, width)
    } catch (err) {
      assert.fail(`${sample.name} @${width}: threw ${(err as Error)?.message ?? err}`)
    }
    assert.ok(Array.isArray(lines), `${sample.name} @${width}: not an array`)
    checks++

    for (const line of lines) {
      const vw = visibleWidth(line)
      assert.ok(vw <= width, `${sample.name} @${width}: line ${vw} > ${width}\n${JSON.stringify(line)}`)
      checks++
    }
  }
}

// ── empty / whitespace content → no card ────────────────────────────────────
for (const width of WIDTHS) {
  for (const empty of [EMPTY, "   \n  "]) {
    assert.deepStrictEqual(renderUserCard(empty, width), [], `empty user @${width} should render nothing`)
    checks++
    assert.deepStrictEqual(renderAssistantCard(empty, width), [], `empty assistant @${width} should render nothing`)
    checks++
  }
  assert.deepStrictEqual(renderAssistantCard([], width), [], `empty blocks @${width} should render nothing`)
  checks++
}

// ── blocksToParts grouping ──────────────────────────────────────────────────
{
  const stringParts = blocksToParts(USER)
  assert.strictEqual(stringParts.text, USER)
  assert.deepStrictEqual(stringParts.thinking, [])
  checks++

  const parts = blocksToParts([
    { type: "thinking", thinking: THINKING_A },
    { type: "text", text: ASSISTANT_TEXT },
    { type: "thinking", thinking: THINKING_B },
    { type: "toolCall", name: "bash" },
  ])
  assert.strictEqual(parts.text, ASSISTANT_TEXT)
  assert.deepStrictEqual(parts.thinking, [THINKING_A, THINKING_B])
  checks++

  assert.deepStrictEqual(blocksToParts(null), { text: "", thinking: [] })
  checks++
}

// ── all thinking blocks grouped in ONE thoughts box ─────────────────────────
for (const width of WIDTHS) {
  // Expanded (ctrl+o on): header + every thinking block, in ONE box.
  const lines = renderAssistantCard(SAMPLES[4]!.content, width, true)
  const joined = lines.join("\n")
  assert.ok(joined.includes(`Thoughts · 3`), `multi-thinking @${width}: missing one 3-block header`)
  checks++
  if (width >= 80) {
    assert.ok(joined.includes("(ctrl+o collapse)"), `multi-thinking @${width}: expanded hint wrong`)
    checks++
  }
  assert.strictEqual(joined.split("Thoughts ·").length - 1, 1, `multi-thinking @${width}: more than one thoughts box`)
  checks++
  // Distinctive tokens that appear ONLY in the thinking blocks (not the body
  // text): "cache" would false-positive because ASSISTANT_TEXT also has it.
  for (const tok of ["alone", "configurable", "non-GET"]) {
    assert.ok(joined.includes(tok), `multi-thinking @${width}: missing thinking token ${JSON.stringify(tok)}`)
    checks++
  }
  assert.ok(joined.includes(ASSISTANT_TEXT.slice(0, 10)), `multi-thinking @${width}: text block missing`)
  checks++

  // Collapsed (default / ctrl+o off): header + honest hint, NO thinking text.
  const collapsed = renderAssistantCard(SAMPLES[4]!.content, width).join("\n")
  assert.ok(collapsed.includes("Thoughts · 3"), `multi-thinking @${width}: collapsed header missing`)
  checks++
  if (width >= 80) {
    assert.ok(collapsed.includes("(ctrl+o expand)"), `multi-thinking @${width}: collapsed hint wrong`)
    checks++
  }
  for (const tok of ["alone", "configurable", "non-GET"]) {
    assert.ok(!collapsed.includes(tok), `multi-thinking @${width}: thinking token leaked while collapsed: ${tok}`)
    checks++
  }
}

// ── markdown is rendered (fences, inline code, lists, links, tables) ────────
// Markdown inline styling resets the foreground mid-token, so structural
// assertions run on ANSI-stripped text (both CSI and OSC-8 link sequences).
const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g
const plain = (s: string) => s.replace(ANSI_RE, "")

for (const width of WIDTHS) {
  const lines = renderAssistantCard(MD_MARKDOWN, width)
  const joined = plain(lines.join("\n"))
  const body = lines.filter((l) => l.includes("\x1b[48;2;"))

  // Code fence: language tag + code content survive. Content is only present
  // when the fence renders (the old raw-text path would print the backticks but
  // never the highlighted line — check for the code itself).
  assert.ok(joined.includes("```ts"), `markdown @${width}: code fence opening missing`)
  checks++
  assert.ok(joined.includes(MD_CODE.slice(0, 10)), `markdown @${width}: code fence content missing`)
  checks++

  // List bullets and the table structure render, not raw `| a | b |`.
  assert.ok(joined.includes("- key by method"), `markdown @${width}: list item missing`)
  checks++
  assert.ok(joined.includes("┌") && joined.includes("│") && joined.includes("└"), `markdown @${width}: table frame missing`)
  checks++
  assert.ok(joined.includes(MD_TABLE_CELL), `markdown @${width}: table cell missing`)
  checks++
  assert.ok(!joined.includes(`| ${MD_TABLE_CELL} |`), `markdown @${width}: raw table row not converted`)
  checks++

  // Link text present (URL may be OSC-8 hyperlinked or shown inline).
  assert.ok(joined.includes(MD_LINK_TEXT), `markdown @${width}: link text missing`)
  checks++
  // Inline code content present (backticks are dropped by the renderer).
  assert.ok(joined.includes("fetch()"), `markdown @${width}: inline code content missing`)
  checks++

  // Card chrome preserved on every body line.
  assert.ok(body.length >= 3, `markdown @${width}: card body too short (${body.length})`)
  checks++
  for (const line of body) {
    assert.ok(line.includes("▌ "), `markdown @${width}: card rail missing\n${JSON.stringify(line)}`)
    checks++
  }
}

// A text+thinking mix keeps ONE thoughts box and the markdown body.
for (const width of WIDTHS) {
  const mix = SAMPLES.find((s) => s.name === "assistant-markdown+thinking")!
  const joined = plain(renderAssistantCard(mix.content, width).join("\n"))
  assert.ok(joined.includes("```ts"), `markdown+thinking @${width}: markdown body missing`)
  checks++
  assert.ok(joined.includes("Thoughts · 2"), `markdown+thinking @${width}: thoughts box missing`)
  checks++
  assert.strictEqual(joined.split("Thoughts ·").length - 1, 1, `markdown+thinking @${width}: more than one thoughts box`)
  checks++
}

// ── non-text blocks: placeholders, never thrown away ────────────────────────
{
  assert.deepStrictEqual(blockPlaceholders([{ type: "text", text: "x" }, { type: "toolCall", name: "bash" }]), [])
  checks++
  assert.deepStrictEqual(
    blockPlaceholders([{ type: "image", mimeType: "image/png" }, { type: "diff" }]),
    ["[image image/png]", "[diff]"],
  )
  checks++
  for (const width of WIDTHS) {
    const joined = renderAssistantCard(
      [{ type: "text", text: "see this" }, { type: "image", mimeType: "image/png" }],
      width,
    ).join("\n")
    assert.ok(joined.includes("[image image/png]"), `placeholder @${width}: image dropped`)
    checks++
  }
}

// ── compaction / branch summary cards ───────────────────────────────────────
{
  const compaction = { role: "compactionSummary", summary: MD_MARKDOWN, tokensBefore: 12345, timestamp: 0 }
  const branch = { role: "branchSummary", summary: "explored the cache branch", fromId: "abc", timestamp: 0 }
  // Single tokens that survive markdown rendering AND wrapping at width 20
  // (headings lose their `#`; multi-word body lines split across lines).
  const BODY_TOKENS: Record<string, string> = { compactionSummary: "30_000", branchSummary: "explored" }

  for (const width of WIDTHS) {
    for (const msg of [compaction, branch]) {
      const collapsed = renderSummaryCard(msg, width)
      assert.ok(collapsed.length > 0, `summary @${width}: nothing rendered`)
      checks++
      for (const l of collapsed) {
        assert.ok(visibleWidth(l) <= width, `summary @${width}: ${visibleWidth(l)} > ${width}`)
        checks++
      }
      // Collapsed hides the summary body and offers the ctrl+o hint.
      assert.ok(!plain(collapsed.join("\n")).includes(BODY_TOKENS[msg.role]!), `summary @${width}: body leaked while collapsed`)
      checks++
      if (width >= 60) {
        assert.ok(collapsed.join("\n").includes("ctrl+o to expand"), `summary @${width}: expand hint missing`)
        checks++
      }

      const expanded = renderSummaryCard(msg, width, true)
      for (const l of expanded) {
        assert.ok(visibleWidth(l) <= width, `summary expanded @${width}: ${visibleWidth(l)} > ${width}`)
        checks++
      }
      assert.ok(plain(expanded.join("\n")).includes(BODY_TOKENS[msg.role]!), `summary expanded @${width}: body missing when expanded`)
      checks++
    }
  }

  // Labels + token meta identify the kind.
  assert.ok(plain(renderSummaryCard(compaction, 80).join("\n")).includes("[compaction]"), "compaction label missing")
  assert.ok(plain(renderSummaryCard(compaction, 80, true).join("\n")).includes("12,345"), "token count missing")
  assert.ok(plain(renderSummaryCard(branch, 80).join("\n")).includes("[branch]"), "branch label missing")
  checks += 3

  // Unrecognisable / empty input → [] so a caller can fall back to stock.
  assert.deepStrictEqual(renderSummaryCard(null, 80), [], "null summary should render nothing")
  assert.deepStrictEqual(renderSummaryCard(undefined, 80), [], "undefined summary should render nothing")
  assert.deepStrictEqual(renderSummaryCard({ summary: "" }, 80), [], "empty summary should render nothing")
  checks += 3
}

// ── registerTranscript contract: component / undefined fallback ─────────────
{
  const registered = new Map<string, Function>()
  const pi = {
    registerMessageRenderer(key: string, renderer: Function) {
      registered.set(key, renderer)
    },
  }
  registerTranscript(pi as never)
  assert.ok(registered.has("user") && registered.has("assistant"), "role renderers not registered")
  checks++
  assert.ok(
    registered.has("compactionSummary") && registered.has("branchSummary"),
    "summary role renderers not registered (exact pi role keys)",
  )
  checks++

  // Summary renderers return undefined for empty/invalid payloads so stock pi
  // would keep its own component (currently the seam never reaches these keys).
  const compactionRenderer = registered.get("compactionSummary")!
  const branchRenderer = registered.get("branchSummary")!
  assert.strictEqual(compactionRenderer({ summary: "" }, { expanded: false }, {}), undefined)
  assert.strictEqual(branchRenderer({}, { expanded: false }, {}), undefined)
  checks += 2
  for (const width of WIDTHS) {
    const comp = compactionRenderer({ role: "compactionSummary", summary: MD_MARKDOWN, tokensBefore: 999 }, { expanded: true }, {})
    assert.ok(comp && typeof comp.render === "function", `summary @${width}: no component`)
    checks++
    for (const l of comp.render(width)) {
      assert.ok(visibleWidth(l) <= width, `registered summary @${width}: ${visibleWidth(l)} > ${width}`)
      checks++
    }
  }

  const userRenderer = registered.get("user")!
  const assistantRenderer = registered.get("assistant")!

  // Empty content → undefined, so pi keeps stock rendering.
  assert.strictEqual(userRenderer({ role: "user", content: "" }, { expanded: false, outputPad: 1 }, {}), undefined)
  checks++
  assert.strictEqual(
    assistantRenderer({ role: "assistant", content: [] }, { expanded: false, outputPad: 1 }, {}),
    undefined,
  )
  checks++

  // Non-empty content → a component whose lines stay in bounds, live-updatable.
  for (const width of WIDTHS) {
    const comp = userRenderer({ role: "user", content: USER }, { expanded: false, outputPad: 1 }, {})
    assert.ok(comp && typeof comp.render === "function", `user @${width}: no component`)
    checks++
    for (const l of comp.render(width)) {
      assert.ok(visibleWidth(l) <= width, `registered user @${width}: ${visibleWidth(l)} > ${width}`)
      checks++
    }

    const asst = assistantRenderer(
      { role: "assistant", content: [{ type: "text", text: "partial" }] },
      { expanded: false, outputPad: 1, isStreaming: true },
      {},
    )
    assert.ok(asst && typeof asst.updateContent === "function", `assistant @${width}: no streaming component`)
    checks++
    asst.updateContent({ role: "assistant", content: [{ type: "text", text: "partial grown" }, { type: "thinking", thinking: THINKING_A }] }, true)
    const streamed = asst.render(width)
    assert.ok(streamed.join("\n").includes("partial grown"), `streaming @${width}: update not reflected`)
    checks++
    for (const l of streamed) {
      assert.ok(visibleWidth(l) <= width, `streamed assistant @${width}: ${visibleWidth(l)} > ${width}`)
      checks++
    }
  }

  // A throwing message must degrade to undefined, not crash registration.
  const throwing = {}
  Object.defineProperty(throwing, "content", {
    get() {
      throw new Error("boom")
    },
  })
  const badPi = {
    registerMessageRenderer: (_key: string, renderer: Function) => {
      assert.strictEqual(renderer(throwing, { expanded: false, outputPad: 1 }, {}), undefined)
    },
  }
  registerTranscript(badPi as never)
  checks++
}

console.log(`PASS — ${checks} width checks`)
