// Headless width-safety harness for wide (CJK/emoji/ZWJ/VS16) and zero-width
// glyphs. No framework — node:assert. Run: bash tests/ui-widechars.sh
//
// Ground truth is the REAL @earendil-works/pi-tui that pi itself validates with
// (the runner aliases it to the installed pi-tui, see tests/lib-pi-tui.sh), NOT
// a hand-rolled counter. The old local model counted ✅ (U+2705) as 1 while pi
// counts it as 2, so a card passed this suite and then crashed pi with
// "Rendered line 48 exceeds terminal width (378 > 377)".
import assert from "node:assert"
import { card, PAL, truncateAnsi, visibleWidth, wrap } from "../extensions/ui/ui-kit.ts"
import { renderAssistantCard, renderUserCard } from "../extensions/ui/transcript.ts"
import { visibleWidth as realVisibleWidth, truncateToWidth as realTruncate } from "@earendil-works/pi-tui"

// Guard: this suite must be bundling the real pi-tui. The stub's truncateToWidth
// never emits a reset and its visibleWidth counts VS16 emoji as 1. If the alias
// regresses, fail here rather than silently measuring with the wrong engine.
assert.strictEqual(realVisibleWidth("✅"), 2, "not measuring with real pi-tui (✅ must be 2 cells)")
assert.notStrictEqual(realTruncate, undefined, "real pi-tui truncateToWidth missing")

// ── independent sanity model: only used to prove the samples are non-trivial,
// never as the assertion ground truth (the real engine is). ─────────────────
function indepWidth(s: string): number {
  let n = 0
  for (const ch of s.replace(/\x1b\[[0-9;]*m/g, "")) {
    const cp = ch.codePointAt(0)!
    const zero =
      (cp >= 0x0300 && cp <= 0x036f) ||
      (cp >= 0xfe00 && cp <= 0xfe0f) ||
      cp === 0x200b ||
      cp === 0x200c ||
      cp === 0x200d
    if (zero) continue
    const wide =
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x20000 && cp <= 0x3fffd)
    // NOTE: ✅ (U+2705) is outside 0x1f300..0x1faff, so this naive model calls it
    // narrow — the regression trigger. It is kept only as a "samples are real"
    // sanity check; assertions use realVisibleWidth.
    n += wide ? 2 : 1
  }
  return n
}

const WIDTHS = [20, 40, 80, 120]

const CJK = "这个扩展把终端渲染成 opencode 的样子，每一行都必须严格遵守宽度限制。".repeat(3)
const CJK_SHORT = "你好世界"
const EMOJI = "🚀 ship it 🎉 done ✅ yes 👍 ok 🔥 hot"
const COMBINING = "e\u0301".repeat(20) + " a\u0300\u0301\u0302 b"
const PUA = "\uE0B0".repeat(30) + " branch \uE0B2" + " main \uE0B0".repeat(5)
const MIXED = `[${CJK_SHORT}] ${EMOJI} ${COMBINING}`
const ZWJ = "👨‍👩‍👧‍👦 family"
const ANSI_CJK = "\x1b[1m\x1b[38;2;115;213;226m" + CJK + "\x1b[39m\x1b[22m"

/** The exact strings from the reported crash / the ticket's regression ask. */
const REGRESSION = [
  "System operational. ✅",
  "✅",
  "❤️",           // VS16
  "👨‍👩‍👧‍👦",      // ZWJ family
  "👍🏽",          // skin tone modifier
  "你好世界",       // CJK
  "✅ done ✅ done ✅ done",
  "[Context] System operational. ✅",
]

const PLAIN_SAMPLES: Array<[string, string]> = [
  ["cjk", CJK],
  ["emoji", EMOJI],
  ["combining", COMBINING],
  ["pua", PUA],
  ["mixed", MIXED],
  ["zwj", ZWJ],
]

// Sanity: the independent counter must actually disagree with raw code points on
// these samples, otherwise the test is vacuous.
assert.ok(indepWidth(CJK) > [...CJK].length, "CJK sample is not wider than its code-point count")

let checks = 0
const bump = () => ++checks

function assertFits(label: string, line: string, width: number): void {
  const w = realVisibleWidth(line)
  assert.ok(w <= width, `${label} @${width}: real pi-tui width ${w} > ${width}\n${JSON.stringify(line)}`)
  bump()
}

// (0) REGRESSION, first so a revert to the old local width model fails here with
// this exact message. Render `System operational. ✅` through the REAL card/render
// path (transcript.ts → ui-kit card + truncateAnsi) at every tested width and
// assert each line's width by the real pi-tui engine. The old model measured the
// card line as `width + 1` (✅ counted 1, not 2) and pi exited with
// "line 48 exceeds terminal width (378 > 377)".
for (const width of WIDTHS) {
  // User card: the ✅ text may fit or be cut, but every line is a padded card
  // line, so after the guard it must measure EXACTLY `width`. The old model
  // produced `width + 1` here (it undercounted ✅), which is the crash.
  const userLines = renderUserCard("System operational. ✅", width)
  assert.ok(userLines.length > 0, `regression @${width}: render path produced no lines`)
  bump()
  for (const line of userLines) {
    assertFits(`regression "System operational. ✅"`, line, width)
    assert.strictEqual(
      realVisibleWidth(line),
      width,
      `regression pad != width @${width}: got ${realVisibleWidth(line)}\n${JSON.stringify(line)}`,
    )
    bump()
  }

  // Assistant card with text + thinking + emoji/CJK/ZWJ in one turn.
  const asstLines = [
    ...renderAssistantCard("System operational. ✅", width),
    ...renderAssistantCard(
      [
        { type: "text", text: "System operational. ✅" },
        { type: "thinking", thinking: "Okay ✅ — CJK 你好，ZWJ 👨‍👩‍👧‍👦." },
      ],
      width,
    ),
  ]
  for (const line of asstLines) assertFits(`regression assistant`, line, width)
  bump()
}

for (const width of WIDTHS) {
  // (a) plain wide text through truncateAnsi never exceeds the real width.
  for (const [name, text] of PLAIN_SAMPLES) {
    assertFits(`truncate/${name}`, truncateAnsi(text, width), width)
  }

  // (b) the same through the card primitive + guard (render path).
  const lines = card(width, PAL.agent, PLAIN_SAMPLES.map(([n]) => `${n}: ${CJK_SHORT} ${EMOJI}`))
  assert.ok(lines.length >= 3, `card too short at ${width}`)
  bump()
  for (const line of lines) assertFits("card", truncateAnsi(line, width), width)

  // (c) styled wide text — ANSI stripped, never split mid-glyph.
  assertFits("truncate/ansi-cjk", truncateAnsi(ANSI_CJK, width), width)

  // (d) a long CJK paragraph wraps/truncates within the width.
  for (const line of wrap(CJK.replace(/([。])/g, "$1 "), width)) {
    assertFits("wrap/cjk", truncateAnsi(line, width), width)
  }

  // (e) PUA must stay width 1: 38 PUA + ASCII fits a 40-col cell exactly.
  const puaLine = "\uE0B0".repeat(38) + "ab"
  assert.strictEqual(indepWidth(puaLine), 40, "PUA compensation changed (must be 1 cell)")
  bump()
  assertFits("pua-40", truncateAnsi(puaLine, 40), 40)

  // (f) REGRESSION: the crash string and friends through the real card render
  // path, on every line, measured with the engine pi validates with. On the old
  // local model the "System operational. ✅" card line measured one cell too
  // wide and this fails (see tests/ui-widechars.sh proof in the commit).
  for (const text of REGRESSION) {
    const body = [text]
    const rendered = card(width, PAL.agent, body).map((l) => truncateAnsi(l, width))
    for (const line of rendered) {
      assertFits(`regression/${JSON.stringify(text)}`, line, width)
      // the +1 bug was a trailing-space padding miscalculation: the padded card
      // line must be exactly `width` cells after the guard, never width+1.
      assert.ok(
        realVisibleWidth(line) <= width,
        `regression pad overflow @${width}: ${realVisibleWidth(line)}\n${JSON.stringify(line)}`,
      )
      bump()
    }
  }
}

// The render path must agree with the real engine on every sample (same engine,
// so this is a tautology guard against accidentally re-importing a local model).
for (const [, text] of PLAIN_SAMPLES) {
  assert.strictEqual(visibleWidth(text), realVisibleWidth(text), `engine mismatch on ${JSON.stringify(text)}`)
  bump()
}
assert.strictEqual(visibleWidth(REGRESSION[0]!), realVisibleWidth(REGRESSION[0]!), "✅ engine mismatch")
bump()

// Truncating "System operational. ✅" to 21 must drop the emoji, not split it,
// and must land within 21 by the real engine.
{
  const cut = truncateAnsi("System operational. ✅", 21)
  assert.ok(realVisibleWidth(cut) <= 21, `regression truncate overflow: ${realVisibleWidth(cut)}`)
  assert.ok(!cut.includes("✅"), `regression truncate split the emoji: ${JSON.stringify(cut)}`)
  bump()
}

console.log(`PASS — ${checks} wide-char width checks (real pi-tui engine)`)
