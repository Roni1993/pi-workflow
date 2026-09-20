// Headless width-safety harness for the T3 questions modal. No framework — node:assert.
// Run: bash tests/ui-questions.sh
import assert from "node:assert"
import { type Question, type QuestionsState, renderQuestions } from "../extensions/ui/questions.ts"
import { visibleWidth } from "../extensions/ui/ui-kit.ts"

const QUESTIONS: Question[] = [
  {
    header: "Caching strategy",
    question: "Which caching approach should I implement?",
    options: [
      { label: "TTL map", desc: "simplest — entries expire after 30s", recommended: true, preview: ["const cache = new Map()"] },
      { label: "LRU map", desc: "bounded size, evicts least-recent", preview: ["class LRU {}", "  set(k, v) {}"] },
      { label: "No cache", desc: "leave it; measure first", preview: ["// no change"] },
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

function base(over: Partial<QuestionsState> = {}): QuestionsState {
  return {
    questions: QUESTIONS,
    qi: 0,
    focused: 0,
    picker: 0,
    checked: [[], []],
    picked: [null, null],
    notes: ["", ""],
    custom: ["", ""],
    noteOpen: false,
    editing: null,
    ...over,
  }
}

// Representative states: single focused, multi with checks, note open, typed custom
// row focused, and the submit recap with answers + notes.
const STATES: [string, QuestionsState][] = [
  ["single-select focused", base({ focused: 1 })],
  ["multi-select with checks", base({ qi: 1, focused: 0, checked: [[], [0, 2]] })],
  ["note open", base({ noteOpen: true, editing: "note", notes: ["keep it behind a flag", ""] })],
  ["custom row focused", base({ focused: 3, custom: ["wrap it in a helper", ""], editing: "custom" })],
  ["custom row focused (type something)", base({ focused: 3 })],
  [
    "submit recap with answers+notes",
    base({ qi: QUESTIONS.length, picker: 1, picked: [0, null], checked: [[], [0, 2]], notes: ["keep it behind a flag", ""], custom: ["", "plus a smoke test"] }),
  ],
]

const WIDTHS = [20, 40, 80, 120]

let checks = 0

for (const width of WIDTHS) {
  for (const [name, state] of STATES) {
    let lines: string[]
    assert.doesNotThrow(() => {
      lines = renderQuestions(state, width)
    }, `render threw: ${name} @ ${width}`)
    checks++
    assert.ok(Array.isArray(lines!), `not array: ${name} @ ${width}`)
    checks++
    for (const line of lines!) {
      const w = visibleWidth(line)
      assert.ok(
        w <= width,
        `line too wide (${name} @ ${width}): ${w} > ${width}\n${JSON.stringify(line)}`,
      )
      checks++
    }
  }
}

// A struct of absurd input must still not throw and must stay in bounds.
for (const width of WIDTHS) {
  const evil = base({ qi: 1, focused: 99, checked: [[5, 5], [42]], notes: ["x".repeat(500), ""], custom: ["y".repeat(500), ""] })
  const lines = renderQuestions(evil, width)
  checks++
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= width, `evil line too wide @ ${width}: ${visibleWidth(line)}`)
    checks++
  }
}

console.log(`PASS — ${checks} width checks`)
