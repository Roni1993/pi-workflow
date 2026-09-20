// Headless width-safety harness for wide (CJK/emoji) and zero-width glyphs.
// No framework — node:assert. Run: bash tests/ui-widechars.sh
//
// The whole point: measure with an INDEPENDENT width implementation (below),
// never ui-kit's. If ui-kit's counter ever disagrees with a real terminal, this
// catches it instead of sharing the same blind spot as the render path.
import assert from "node:assert"
import { card, PAL, truncateAnsi, visibleWidth, wrap } from "../extensions/ui/ui-kit.ts"

// ── independent terminal width, written from the Unicode East Asian Width
// property by hand. Deliberately a separate implementation from ui-kit. ──────
const ZERO = new Set([
  0x200b, 0x200c, 0x200d, 0xfeff, // ZWSP/ZWNJ/ZWJ/BOM
])
function indepWidth(s: string): number {
  let n = 0
  for (const ch of s.replace(/\x1b\[[0-9;]*m/g, "")) {
    const cp = ch.codePointAt(0)!
    if (
      (cp >= 0x0300 && cp <= 0x036f) ||
      (cp >= 0x1ab0 && cp <= 0x1aff) ||
      (cp >= 0x1dc0 && cp <= 0x1dff) ||
      (cp >= 0x20d0 && cp <= 0x20ff) ||
      (cp >= 0xfe00 && cp <= 0xfe0f) ||
      (cp >= 0xfe20 && cp <= 0xfe2f) ||
      ZERO.has(cp)
    ) {
      continue // zero width
    }
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x20000 && cp <= 0x3fffd)
    // Powerline PUA is width 1 by design (terminal compensation).
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
  const w = indepWidth(line)
  assert.ok(w <= width, `${label} @${width}: independent width ${w} > ${width}\n${JSON.stringify(line)}`)
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
}

// ui-kit's counter must agree with the independent one on every sample, or the
// render path is measuring something a terminal will not measure the same way.
for (const [, text] of PLAIN_SAMPLES) {
  assert.strictEqual(visibleWidth(text), indepWidth(text), `width disagreement on ${JSON.stringify(text)}`)
  bump()
}
assert.strictEqual(visibleWidth(PUA), indepWidth(PUA), "PUA width disagreement")
bump()

console.log(`PASS — ${checks} wide-char width checks`)
