// UI performance harness for the T2 dock. READ-ONLY against ~/.pi/agent/bg.
// Run: bash tests/ui-perf.sh            (report)
//      PERF_PROFILE=1 bash tests/ui-perf.sh   (report + CPU profile summary)
//
// Measures the suspected dominant cost (per-agent tmux spawn) and the render
// cost of the three dock views against synthetic snapshots. No source file is
// modified; the only writes are fixtures under /tmp.
import { spawnSync } from "node:child_process"
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import {
  chatView,
  dashboardView,
  deriveDockData,
  statusView,
  type DockData,
} from "../extensions/ui/dock.ts"
import { INDEX, liveState, readLiveState, hasSession, type BgAgent, type LiveState } from "../extensions/ui/live.ts"

const FRAME_MS = 110 // dock.ts FRAME_MS
const POLL_MS = 1500 // dock.ts POLL_MS
const RENDER_RUNS = 15
const INDEX_RUNS = 20
const SINGLE_TMUX_RUNS = 20
const NAMES_50_RUNS = 5
const LIVE_STATE_RUNS = 10
const NS = [0, 10, 50, 100, 200, 469]
const WIDTHS = [80, 120]

// ── tiny stats ──────────────────────────────────────────────────────────────
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = (s.length - 1) / 2
  return s.length % 2 ? s[Math.floor(m)]! : (s[Math.floor(m)]! + s[Math.ceil(m)]!) / 2
}
function timeIt(fn: () => void, runs: number, warm = 3): number {
  for (let i = 0; i < warm; i++) fn()
  const xs: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    fn()
    xs.push(performance.now() - t)
  }
  return median(xs)
}
async function timeAsync(fn: () => Promise<unknown>, runs: number, warm = 1): Promise<number> {
  for (let i = 0; i < warm; i++) await fn()
  const xs: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    await fn()
    xs.push(performance.now() - t)
  }
  return median(xs)
}
const ms = (n: number) => n.toFixed(2)
const pad = (s: string | number, n: number) => String(s).padStart(n)
const padR = (s: string | number, n: number) => String(s).padEnd(n)

// ── synthetic snapshots (no filesystem) ─────────────────────────────────────
const MODELS = [
  "opencode-go/deepseek-v4-pro",
  "opencode-go/deepseek-v4-flash",
  "opencode-go/glm-5.3-flash",
]
const CLEAN_ACTIONS = [
  "bash(npm test -- --runInBand)",
  "edit(src/client.ts)",
  "read(src/a.ts)",
  "glob(**/*.ts)",
  "write(dist/out.js)",
  "—",
  "settled",
]
const MESSY_ACTIONS = [...CLEAN_ACTIONS, "bash(git status) [ERROR]"]

/** Mirror the real index distribution: ~12.8% spawning, rest running. */
function synthStates(n: number, alive: boolean, actions: string[]): LiveState[] {
  const out: LiveState[] = []
  for (let i = 0; i < n; i++) {
    const spawning = i % 8 === 7
    const agent: BgAgent = {
      id: `agent-${String(i).padStart(4, "0")}`,
      tmux: `pi-bg-agent-${String(i).padStart(4, "0")}`,
      dir: join(tmpdir(), "ui-perf-nonexistent", String(i)),
      sessionDir: "",
      cwd: "",
      model: MODELS[i % MODELS.length]!,
      prompt: "",
      createdAt: "",
      status: spawning ? "spawning" : "running",
    }
    out.push({ agent, alive, action: actions[i % actions.length]! })
  }
  return out
}
const synthData = (n: number, alive: boolean) => deriveDockData(synthStates(n, alive, alive ? CLEAN_ACTIONS : MESSY_ACTIONS))

// ── report header ───────────────────────────────────────────────────────────
console.log("")
console.log("═══ pi-workflow dock performance report ═══")
console.log(`node ${process.version}   tmux ${tmuxVersion()}   ${new Date().toISOString()}`)
console.log(`real index: ${INDEX}`)
console.log(`budget constants: FRAME_MS=${FRAME_MS}  POLL_MS=${POLL_MS}`)
console.log("")

// ── 1. render cost ──────────────────────────────────────────────────────────
console.log(`── 1. RENDER COST (median of ${RENDER_RUNS} runs, warmup 3) ──────────────────────────`)
for (const [variant, alive] of [["stale (alive=false → all blocked→standalone)", false], ["live  (alive=true → all active→workflow)", true]] as const) {
  console.log("")
  console.log(`  variant: ${variant}`)
  console.log(`  ${padR("N", 5)} ${padR("width", 5)} | ${padR("chatView", 16)} | ${padR("dashboardView", 16)} | ${padR("statusView", 16)}`)
  console.log(`  ${padR("", 5)} ${padR("", 5)} | ${padR("ms", 7)} ${padR("lines", 8)} | ${padR("ms", 7)} ${padR("lines", 8)} | ${padR("ms", 7)} ${padR("lines", 8)}`)
  for (const width of WIDTHS) {
    for (const n of NS) {
      const data = synthData(n, alive)
      let cLines = 0
      let dLines = 0
      let sLines = 0
      const cMs = timeIt(() => { cLines = chatView(width, 0.7, data).length }, RENDER_RUNS)
      const dMs = timeIt(() => { dLines = dashboardView(width, data).length }, RENDER_RUNS)
      const sMs = timeIt(() => { sLines = statusView(width, 0.7, data).length }, RENDER_RUNS)
      console.log(
        `  ${pad(n, 5)} ${pad(width, 5)} | ${pad(ms(cMs), 7)} ${pad(cLines, 8)} | ${pad(ms(dMs), 7)} ${pad(dLines, 8)} | ${pad(ms(sMs), 7)} ${pad(sLines, 8)}`,
      )
    }
  }
}
console.log("")

// ── 2. index read ───────────────────────────────────────────────────────────
console.log("── 2. INDEX READ (real ~/.pi/agent/bg/index.json) ────────────────────")
{
  let bytes = 0
  try {
    bytes = (await stat(INDEX)).size
  } catch {
    console.log("  index missing — skipped")
  }
  const raw = await readFile(INDEX, "utf8")
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const agentCount = Object.keys(parsed).length
  const parseMedian = timeIt(() => { JSON.parse(raw) }, INDEX_RUNS)
  const readMedian = await timeAsync(() => readLiveState(), INDEX_RUNS)
  console.log(`  file bytes            : ${bytes} (${(bytes / 1024).toFixed(1)} KiB)`)
  console.log(`  agents in index       : ${agentCount}`)
  console.log(`  JSON.parse median     : ${ms(parseMedian)} ms  (${INDEX_RUNS} runs)`)
  console.log(`  readLiveState() median: ${ms(readMedian)} ms  (readFile + parse + normalize + sort, ${INDEX_RUNS} runs)`)
}
console.log("")

// ── 3. per-agent liveness (tmux) ────────────────────────────────────────────
console.log("── 3. PER-AGENT LIVENESS — hasSession() via Promise.all (poller shape) ──")
let tmuxNames: string[] = ["pi-bg-__ui_perf_probe__"]
let tmuxAvailable = true
{
  const v = tmuxVersion()
  if (v === "absent") {
    tmuxAvailable = false
    console.log("  tmux ABSENT — skipping liveness measurements")
  } else {
    try {
      const idx = JSON.parse(await readFile(INDEX, "utf8")) as Record<string, { tmux?: string }>
      tmuxNames = Object.keys(idx).map((k) => idx[k]?.tmux || `pi-bg-${k}`)
    } catch {
      /* keep probe name */
    }
    if (tmuxNames.length === 0) tmuxNames = ["pi-bg-__ui_perf_probe__"]
    const one = tmuxNames[0]!
    const oneMs = await timeAsync(() => hasSession(one), SINGLE_TMUX_RUNS)
    const fifty = tmuxNames.slice(0, 50)
    const fiftyMs = await timeAsync(() => Promise.all(fifty.map(hasSession)), NAMES_50_RUNS)
    console.log(`  (a) 1 name   median : ${ms(oneMs)} ms   (${SINGLE_TMUX_RUNS} runs)`)
    console.log(`  (b) 50 names median : ${ms(fiftyMs)} ms   (Promise.all, ${NAMES_50_RUNS} runs)`)
    if (tmuxNames.length >= 100) {
      const t = performance.now()
      const res = await Promise.all(tmuxNames.map(hasSession))
      const allMs = performance.now() - t
      console.log(`  (c) ${tmuxNames.length} names (all, ONE run, bounded): ${ms(allMs)} ms   alive=${res.filter(Boolean).length}`)
      console.log(`      → ${ms(allMs / tmuxNames.length)} ms/agent amortized`)
      console.log(`      → ${((allMs / POLL_MS) * 100).toFixed(0)}% of the ${POLL_MS}ms POLL_MS budget consumed by tmux alone`)
    }
  }
}
console.log("")

// ── 4. per-agent file read ──────────────────────────────────────────────────
console.log("── 4. PER-AGENT FILE READ — liveState(): fixture dir vs missing dir ────")
{
  const fx = join(tmpdir(), "ui-perf-fixture")
  rmSync(fx, { recursive: true, force: true })
  mkdirSync(fx, { recursive: true })
  const outPath = join(fx, "out.jsonl")
  const lines: string[] = []
  for (let i = 0; i < 2000; i++) {
    if (i % 50 === 0) lines.push(JSON.stringify({ type: "tool_execution_start", toolName: "bash", args: { cmd: `echo line ${i}` } }))
    else lines.push(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `token-${i} `.repeat(4) } }))
  }
  const body = lines.join("\n") + "\n"
  writeFileSync(outPath, body)
  const missingDir = join(tmpdir(), "ui-perf-missing-dir")
  rmSync(missingDir, { recursive: true, force: true })
  const TX = "pi-bg-__ui_perf_fixture__" // same nonexistent tmux for both → tmux cost cancels
  const mk = (dir: string): BgAgent => ({
    id: "fixture", tmux: TX, dir, sessionDir: "", cwd: "", model: MODELS[0]!, prompt: "", createdAt: "", status: "running",
  })
  const withFile = mk(fx)
  const without = mk(missingDir)

  const fileIoMs = await timeAsync(async () => {
    await stat(outPath)
    await readFile(outPath, "utf8")
  }, LIVE_STATE_RUNS)
  const parseMs = timeIt(() => { for (const l of lines) { try { JSON.parse(l) } catch {} } }, LIVE_STATE_RUNS)
  const existingMs = await timeAsync(() => liveState(withFile), LIVE_STATE_RUNS)
  const missingMs = await timeAsync(() => liveState(without), LIVE_STATE_RUNS)
  console.log(`  fixture out.jsonl     : ${body.length} bytes, ${lines.length} lines`)
  console.log(`  stat+readFile median  : ${ms(fileIoMs)} ms   (${LIVE_STATE_RUNS} runs)`)
  console.log(`  JSON.parse all lines  : ${ms(parseMs)} ms   (${LIVE_STATE_RUNS} runs)`)
  console.log(`  liveState(exists)     : ${ms(existingMs)} ms   (includes 1 tmux spawn, ${LIVE_STATE_RUNS} runs)`)
  console.log(`  liveState(missing dir): ${ms(missingMs)} ms   (stat fail + 1 tmux spawn, ${LIVE_STATE_RUNS} runs)`)
  console.log(`  ⇒ file-IO delta       : ${ms(existingMs - missingMs)} ms`)
  console.log(`  ⇒ tmux spawn (implied): ${ms(missingMs - fileIoMs)} ms`)
}
console.log("")

// ── 5. full poll replication ────────────────────────────────────────────────
console.log("── 5. FULL POLL REPLICATION (readLiveState → Promise.all(liveState) → deriveDockData), ONE run ──")
{
  const t0 = performance.now()
  const { agents } = await readLiveState()
  const t1 = performance.now()
  const states: LiveState[] = await Promise.all(
    (agents ?? []).map(async (agent): Promise<LiveState> => {
      try {
        return await liveState(agent)
      } catch {
        return { agent, alive: false, action: "—" }
      }
    }),
  )
  const t2 = performance.now()
  const data: DockData = deriveDockData(states)
  const t3 = performance.now()
  const total = t3 - t0
  const stale = data.agents.filter((a) => !a.alive).length
  const staleDashLines = dashboardView(120, data).length
  console.log(`  agents               : ${agents.length}`)
  console.log(`  readLiveState        : ${ms(t1 - t0)} ms`)
  console.log(`  Promise.all(liveState): ${ms(t2 - t1)} ms`)
  console.log(`  deriveDockData       : ${ms(t3 - t2)} ms`)
  console.log(`  TOTAL poll           : ${ms(total)} ms`)
  console.log(`  alive / stale        : ${agents.length - stale} / ${stale}`)
  console.log(`  dashboard lines @469 : ${staleDashLines}`)
  console.log(`  verdict              : ${total <= POLL_MS ? "FITS" : "EXCEEDS"} the ${POLL_MS}ms POLL_MS budget by ${ms(total - POLL_MS)} ms`)
}
console.log("")

// ── extra: 469-agent dashboard lines + implied lines/second ─────────────────
console.log("── 6. OUTPUT VOLUME at N=469 ──────────────────────────────────────────")
{
  for (const [variant, alive] of [["stale", false], ["live", true]] as const) {
    const data = synthData(469, alive)
    const lines = dashboardView(120, data).length
    console.log(`  dashboard @469 ${padR(variant, 6)}: ${lines} lines  → ${(lines / (FRAME_MS / 1000)).toFixed(0)} lines/sec at a ${FRAME_MS}ms frame`)
  }
}
console.log("")
console.log("done.")

function tmuxVersion(): string {
  const r = spawnSync("tmux", ["-V"], { encoding: "utf8" })
  if (r.error || r.status !== 0) return "absent"
  return (r.stdout || "").trim() || "present"
}
