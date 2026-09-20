#!/usr/bin/env node
// Backdrop proof: reads two tmux captures (with and without a pi-tui overlay),
// finds a colored "witness" line outside the overlay, and asserts its truecolor
// fg was scaled toward black by the expected factor — i.e. the numeric
// `backdrop` option actually dimmed the base transcript.
//
// Usage: ansi-backdrop.mjs <baseline-file> <overlay-file> <marker> <factor>
// Exit: 0 when dimmed as expected, 1 otherwise (reason on stderr).

import { readFileSync } from "node:fs";

const [, , basePath, dimPath, marker, factorStr] = process.argv;
if (!basePath || !dimPath || !marker || factorStr === undefined) {
  console.error("usage: ansi-backdrop.mjs <baseline> <overlay> <marker> <factor>");
  process.exit(2);
}
const factor = Number(factorStr);
if (!Number.isFinite(factor) || factor <= 0 || factor >= 1) {
  console.error(`factor must be numeric in (0,1), got: ${factorStr}`);
  process.exit(2);
}

const SGR = /\u001b\[38;2;(\d+);(\d+);(\d+)m/g;

/** RGB of the last truecolor fg written before `marker` on the line that has it. */
function witnessRGB(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (const line of lines) {
    const idx = line.indexOf(marker);
    if (idx < 0) continue;
    SGR.lastIndex = 0;
    let m, last = null;
    while ((m = SGR.exec(line.slice(0, idx)))) last = [+m[1], +m[2], +m[3]];
    if (last) return last;
  }
  return null;
}

const base = witnessRGB(basePath);
const dim = witnessRGB(dimPath);
if (!base) { console.error(`witness marker not colored in baseline: ${JSON.stringify(marker)}`); process.exit(1); }
if (!dim) { console.error(`witness marker not colored in overlay frame: ${JSON.stringify(marker)}`); process.exit(1); }

const same = base.every((v, i) => v === dim[i]);
if (same) { console.error(`backdrop not applied: witness ${marker} unchanged rgb(${base})`); process.exit(1); }

const tol = (b) => Math.max(6, Math.round(0.15 * b));
for (let i = 0; i < 3; i++) {
  const expected = factor * base[i];
  if (!(dim[i] < base[i]) || Math.abs(dim[i] - expected) > tol(base[i])) {
    console.error(
      `backdrop mismatch: rgb(${base}) -> rgb(${dim}) for ${JSON.stringify(marker)}; ` +
      `expected ~x${factor} (${expected.toFixed(1)}+-${tol(base[i])})`,
    );
    process.exit(1);
  }
}
console.log(`  witness ${JSON.stringify(marker)}: rgb(${base.join(",")}) -> rgb(${dim.join(",")})  ~x${factor} dim OK`);
