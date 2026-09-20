// Summarise a V8 .cpuprofile: top self-time functions by percentage.
// Usage: node tests/ui-prof-summary.mjs /tmp/perf-prof/ui-perf.cpuprofile
import { readFileSync } from "node:fs"

const file = process.argv[2]
if (!file) {
  console.error("usage: node tests/ui-prof-summary.mjs <file.cpuprofile>")
  process.exit(1)
}
const prof = JSON.parse(readFileSync(file, "utf8"))
const nodes = new Map()
for (const n of prof.nodes ?? []) nodes.set(n.id, n)

// Self time = sum of timeDeltas for samples attributed to this node.
const self = new Map()
let total = 0
const samples = prof.samples ?? []
const deltas = prof.timeDeltas ?? []
for (let i = 0; i < samples.length; i++) {
  const dt = deltas[i] ?? 0
  total += dt
  const id = samples[i]
  self.set(id, (self.get(id) ?? 0) + dt)
}

// Collapse duplicate frames (same function+url+line) into one row.
const merged = new Map()
for (const [id, time] of self) {
  const f = nodes.get(id)?.callFrame ?? {}
  const name = f.functionName || "(anonymous)"
  const url = (f.url || "").replace(/^file:\/\//, "")
  const key = `${name}\u0000${url}\u0000${f.lineNumber ?? 0}`
  const prev = merged.get(key) ?? { name, url, line: (f.lineNumber ?? 0) + 1, time: 0 }
  prev.time += time
  merged.set(key, prev)
}
const rows = [...merged.values()]
rows.sort((a, b) => b.time - a.time)

const totalMs = total / 1000
console.log("")
console.log(`── CPU PROFILE SELF TIME (${file}) ─────────────────────────`)
console.log(`  captured ${totalMs.toFixed(0)} ms across ${samples.length} samples`)
console.log("")
console.log(`  ${"#".padEnd(3)} ${"self ms".padStart(9)} ${"self %".padStart(7)}  function`)
for (let i = 0; i < Math.min(5, rows.length); i++) {
  const r = rows[i]
  const pct = total ? (r.time / total) * 100 : 0
  const loc = r.url ? `${r.url}:${r.line}` : ""
  console.log(`  ${String(i + 1).padEnd(3)} ${(r.time / 1000).toFixed(1).padStart(9)} ${pct.toFixed(1).padStart(6)}%  ${r.name}  ${loc}`)
}
const idle = rows.filter((r) => r.name === "(idle)" || r.name === "(program)").reduce((s, r) => s + r.time, 0)
console.log("")
console.log(`  idle/(program) self time: ${(idle / 1000).toFixed(1)} ms (${total ? ((idle / total) * 100).toFixed(1) : "0"}%) — waiting, e.g. child processes`)
