// Headless width-safety harness for T8 locked transcript cards. No framework.
// Run: bash tests/ui-transcript.sh
import assert from "node:assert"
import {
  blocksToParts,
  registerTranscript,
  renderAssistantCard,
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
  const lines = renderAssistantCard(SAMPLES[4]!.content, width)
  const joined = lines.join("\n")
  assert.ok(joined.includes(`Thoughts · 3`), `multi-thinking @${width}: missing one 3-block header`)
  checks++
  assert.strictEqual(joined.split("Thoughts ·").length - 1, 1, `multi-thinking @${width}: more than one thoughts box`)
  checks++
  for (const t of [THINKING_A, THINKING_B, THINKING_C]) {
    // Wrapping may split a phrase; the first word is always intact.
    assert.ok(joined.includes(t.split(" ")[0]!), `multi-thinking @${width}: missing thinking text ${JSON.stringify(t.slice(0, 20))}`)
    checks++
  }
  assert.ok(joined.includes(ASSISTANT_TEXT.slice(0, 10)), `multi-thinking @${width}: text block missing`)
  checks++
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
