#!/usr/bin/env node
// pi-workflow benchmark harness — drives /pipeline runs and scores them.
// Zero dependencies. Node >= 18.
//
// Usage:
//   node bench/run-bench.mjs [--scenario <id|all>] [--models m1,m2,...]
//         [--arms A,B] [--n <runs>] [--cap <concurrency>] [--outdir <dir>]
//         [--probe-only] [--judge-model <model>] [--max-runs <n>]
//
// Recommended wrapper (prevents suspend): bench/run-inhibited.sh

import { spawnSync, spawn } from "node:child_process"

import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, readdirSync, statSync, cpSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"


const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOME = homedir()
const PIPELINES_IDX = path.join(HOME, ".pi", "agent", "pi-workflow", "pipelines", "index.json")
const BG_DIR = path.join(HOME, ".pi", "agent", "bg")
const DEFAULT_JUDGE = "opencode-go/deepseek-v4-flash"

const FREE_MODELS = [
  "opencode-go/ox-alpha-free",
  "opencode/hy3-free",
  "opencode/mimo-v2.5-free",
  "opencode/muse-spark-1.2-contributor-free",
  "opencode/nemotron-3.5-lightning-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/x-preview-f-free",
]
const ANCHOR_MODEL = "opencode-go/deepseek-v4-flash"
const DEFAULT_MODELS = [...FREE_MODELS, ANCHOR_MODEL]

function piBin() {
  if (process.env.PI_BIN) return process.env.PI_BIN
  const p = path.join(HOME, ".npm-pi", "bin", "pi")
  if (existsSync(p)) return p
  return "pi"
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name)
  if (i < 0) return dflt
  const v = process.argv[i + 1]
  return v === undefined ? true : v
}

function sha(s) {
  let h = 0
  for (const c of s) h = (h * 31 + c.codePointAt(0)) | 0
  return (h >>> 0).toString(36)
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const r = spawnSync(cmd, args, {
      timeout: opts.timeout ?? 60000,
      cwd: opts.cwd,
      maxBuffer: 32 << 20,
      encoding: "utf8",
    })
    resolve({ ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" })
  })
}

function loadScenario(id) {
  const dir = path.join(HERE, "scenarios", id)
  const cfg = JSON.parse(readFileSync(path.join(dir, "scenario.json"), "utf8"))
  cfg.dir = dir
  cfg.statement = readFileSync(path.join(dir, cfg.statements), "utf8")
  return cfg
}

// ---------- probe ----------
async function probeModel(model) {
  const t0 = Date.now()
  const r = await runCmd(piBin(), ["-p", "--no-tools", "--model", model, "Reply with exactly: OK"], { timeout: 90_000 })
  return { model, ok: r.ok, ms: Date.now() - t0, err: r.ok ? null : r.stderr.slice(0, 200) }
}

// ---------- one-shot LLM ----------
async function oneShot(model, message, timeoutMs = 300_000) {
  return runCmd(piBin(), ["-p", "--no-tools", "--model", model, message], { timeout: timeoutMs })
}

// ---------- session usage ----------
function sumUsage(sessionDir) {
  const out = { n: 0, input: 0, output: 0, cacheRead: 0, reason: 0, cost: 0 }
  if (!existsSync(sessionDir)) return out
  for (const f of readdirSync(sessionDir)) {
    if (!f.endsWith(".jsonl")) continue
    for (const line of readFileSync(path.join(sessionDir, f), "utf8").split("\n")) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line)
        const u = e.usage ?? e.message?.usage ?? (e.data && e.data.usage)
        if (!u || !u.totalTokens) continue
        out.n += 1
        out.input += u.input ?? 0
        out.output += u.output ?? 0
        out.cacheRead += u.cacheRead ?? 0
        out.reason += u.reasoning ?? 0
        out.cost += (u.cost && u.cost.total) ?? 0
      } catch {}
    }
  }
  return out
}

function agentActivity(bgDir) {
  const a = { turns: 0, toolcalls: 0, thinking: 0, lines: 0 }
  const p = path.join(bgDir, "out.jsonl")
  if (!existsSync(p)) return a
  const f = readFileSync(p, "utf8")
  a.lines = f.split("\n").filter(Boolean).length
  for (const line of f.split("\n")) {
    if (line.includes('"role":"assistant"') && line.includes('"type":"message_end"')) a.turns += 1
    else if (line.includes("toolcall_start") && line.includes("toolName")) a.toolcalls += 1
    else if (line.includes('"type":"thinking"') && line.includes("think")) a.thinking += 1
  }
  return a
}

// ---------- hidden tests ----------
async function scoreHidden(scenario, artifactDir, runDir) {
  const scoreDir = path.join(runDir, "score")
  rmSync(scoreDir, { recursive: true, force: true })
  if (artifactDir && existsSync(artifactDir)) cpSync(artifactDir, scoreDir, { recursive: true })
  const hiddenSrc = path.join(scenario.dir, scenario.hiddenDir)
  const hiddenDst = path.join(scoreDir, "hidden")
  mkdirSync(hiddenDst, { recursive: true })
  for (const t of scenario.hiddenTests) cpSync(path.join(hiddenSrc, t), path.join(hiddenDst, t))
  writeFileSync(path.join(hiddenDst, "package.json"), JSON.stringify({ type: "commonjs" }))
  const pkgPath = path.join(scoreDir, "package.json")
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
      if (pkg.type === "module") {
        pkg.type = "commonjs"
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
      }
    } catch {}
  }
  const r = await runCmd("node", ["--test", ...scenario.hiddenTests.map((t) => path.join("hidden", t))], {
    cwd: scoreDir,
    timeout: scenario.hiddenTimeoutMs ?? 120_000,
  })
  const m = (r.stdout ?? "") + (r.stderr ?? "")
  const summary = {}
  for (const key of ["tests", "pass", "fail", "skipped"]) {
    const mm = m.match(new RegExp(`ℹ ${key} (\\d+)`))
    if (mm) summary[key] = parseInt(mm[1], 10)
  }
  return {
    exitCode: r.ok ? 0 : 1,
    tests: summary.tests ?? -1,
    pass: summary.pass ?? -1,
    fail: summary.fail ?? -1,
    out: m.slice(-500),
  }
}

// ---------- judge ----------
async function judge(scenario, artifactDir, hiddenRes, judgeModel) {
  if (!artifactDir || !existsSync(artifactDir)) return { judgeModel, error: "no artifact", score: null }
  const stmt = scenario.statement.slice(0, 900)
  const files = []
  function walk(d, rel = "") {
    for (const ent of readdirSync(d)) {
      if (ent.startsWith(".") || ent === "node_modules" || ent === "hidden") continue
      const fp = path.join(d, ent)
      const st = statSync(fp)
      if (st.isDirectory()) walk(fp, path.join(rel, ent))
      else if (st.size < 200_000) files.push({ rel: path.join(rel, ent), size: st.size })
    }
  }
  walk(artifactDir)
  const code = []
  for (const f of files.slice(0, 40)) {
    try {
      const c = readFileSync(path.join(artifactDir, f.rel), "utf8")
      if (c.length > 6000) continue
      code.push(`\n--- ${f.rel} (${c.length} bytes) ---\n${c}`)
    } catch {}
  }
  const prompt = `You are a strict code-review judge in a benchmark. Score the artifact delivered for the task below.

TASK (truncated):
${stmt}

FILES: ${files.map((f) => f.rel).join(", ")}

CODE:
${code.join("").slice(0, 40_000)}

HIDDEN ACCEPTANCE TESTS: pass=${hiddenRes ? hiddenRes.pass : "?"} fail=${hiddenRes ? hiddenRes.fail : "?"} tests=${hiddenRes ? hiddenRes.tests : "?"}

Score 0-2 per criterion (0 = absent/broken, 1 = present but shaky, 2 = done well):
1. best practices (idiomatic, robust)
2. library use (appropriate, minimal, no reinvented wheels)
3. architectural soundness (clean separation, testable, no hidden state)
4. HARD YANGI simplicity (no over-engineering, no speculative layers)
5. code reuse (DRY, consistent naming, uses existing utilities)

Respond with ONLY a JSON object: {"cri1":0,"cri2":0,"cri3":0,"cri4":0,"cri5":0,"verdict":"PASS|FAIL","note":"<one line>"}`

  const r = await oneShot(judgeModel, prompt, 300_000)
  if (!r.ok) return { judgeModel, error: r.stderr.slice(0, 300), score: null }
  const m = r.stdout.match(/\{[\s\S]*\}/)
  try {
    const j = JSON.parse(m ? m[0] : r.stdout)
    const sum = Object.keys(j).filter((k) => /^cri\d+$/.test(k)).reduce((a, k) => a + (Number(j[k]) || 0), 0)
    return { judgeModel, score: sum, data: j }
  } catch {
    return { judgeModel, error: "unparseable judge output", raw: r.stdout.slice(0, 400), score: null }
  }
}

// ---------- helpers ----------
function pipelineMeta(p) {
  const out = { watchdogFires: 0, rca: false, steer: 0, phaseLog: [] }
  for (const line of p.log ?? []) {
    if (line.includes("watchdog")) out.watchdogFires += 1
    if (line.includes("RCA")) out.rca = true
    if (line.includes("steer")) out.steer += 1
    out.phaseLog.push(line)
  }
  return out
}

async function readPipe(id) {
  try { return JSON.parse(readFileSync(PIPELINES_IDX, "utf8"))[id] ?? null } catch { return null }
}

function findPipeline(before) {
  let pipes = {}
  try { pipes = JSON.parse(readFileSync(PIPELINES_IDX, "utf8")) } catch { return null }
  for (const k of Object.keys(pipes)) {
    if (before.includes(k)) continue
    const rec = pipes[k]
    if (rec && ["implementing", "reviewing", "fixing", "clean", "failed", "cancelled"].includes(rec.phase)) {
      return { rec, id: k }
    }
  }
  return null
}

// ---------- single run ----------
async function runOne(sc, model, arm, n, ctx) {
  const runId = `${sc.id}.${model.replace(/[^A-Za-z0-9]/g, "_")}.${arm}.${n}`
  const runDir = path.join(ctx.outdir, "runs", runId)
  const recordPath = path.join(ctx.outdir, "results.jsonl")
  mkdirSync(runDir, { recursive: true })
  const startedAt = new Date().toISOString()
  const stmt = sc.statement
  const capMs = sc.capsMinutes[arm] * 60_000
  const log = []
  const logline = (s) => {
    const t = new Date().toISOString().slice(11, 19)
    log.push(`[${t}] ${s}`)
    try { appendFileSync(path.join(runDir, "run.log"), `[${t}] ${s}\n`) } catch {}
  }

  try {
    // 1) fresh clone + jj init (isolation; harmless if it fails)
    let r = await runCmd("git", ["clone", "-q", "--depth", "1", sc.repo, path.join(runDir, "repo")])
    if (!r.ok) throw new Error(`clone failed: ${r.stderr}`)
    const repoDir = path.join(runDir, "repo")
    await runCmd("jj", ["git", "init"], { cwd: repoDir })
    const repoState = await runCmd("git", ["rev-parse", "HEAD"], { cwd: repoDir })

    // 2) spawn pi RPC driver process (hosts the pipeline monitor; stdin = RPC)
    const sessionDir = path.join(runDir, "session")
    console.log(`[run] ${runId}: spawning pi driver (model=${model}, arm=${arm})`)
    const promptMsg = `/pipeline --no-grill ${arm === "A" ? "--reviewers 0 " : ""}--model ${model} ${stmt.trim()}`

    let drive = spawnPi(repoDir, sessionDir, runId, model, runDir, logline)
    let before = []
    try { before = Object.keys(JSON.parse(readFileSync(PIPELINES_IDX, "utf8"))) } catch {}

    await sleep(6_000)
    drive.proc.stdin.write(JSON.stringify({ id: "req-1", type: "prompt", message: promptMsg }) + "\n")

    for (let i = 0; i < 20; i++) {
      await sleep(2_000)
      const out = existsSync(path.join(runDir, "out.jsonl")) ? readFileSync(path.join(runDir, "out.jsonl"), "utf8") : ""
      if (out.includes('"id":"req-1"') && out.includes('"success":true')) break
    }

    // 3) track the pipeline to terminal phase or deadline
    let pipe = null
    let pipeId = null
    let deadlineHit = false
    const deadline = Date.now() + capMs
    let respawns = 0
    for (;;) {
      await sleep(20_000)
      const found = findPipeline(before)
      if (found) { pipe = found.rec; pipeId = found.id }
      // keep a monitor alive: respawn the pi driver if it died mid-run
      if (pipe && !["clean", "failed", "cancelled"].includes(pipe.phase) && drive.proc.exitCode !== null && respawns < 5) {
        respawns += 1
        logline(`driver pi died; respawning monitor (#${respawns})`)
        drive = spawnPi(repoDir, sessionDir, runId, model, runDir, logline)
        await sleep(3_000)
      }
      if (!pipe) {
        if (Date.now() > deadline) { deadlineHit = true; break }
        continue
      }
      if (["clean", "failed", "cancelled"].includes(pipe.phase)) break
      if (Date.now() > deadline) { deadlineHit = true; break }
    }

    if (deadlineHit) {
      logline(`deadline exceeded (${sc.capsMinutes[arm]} min); canceling ${pipeId}`)
      try { drive.proc.stdin.write(JSON.stringify({ id: "req-c", type: "prompt", message: `/pipeline cancel ${pipeId}` }) + "\n") } catch {}
      await sleep(30_000)
      const rec = pipeId ? await readPipe(pipeId) : null
      if (rec) pipe = rec
      if (pipe && !["failed", "cancelled"].includes(pipe.phase)) {
        for (const aid of [pipe.implId, pipe.fixerId, pipe.rcaId, ...(pipe.reviewers ?? [])].filter(Boolean)) {
          await runCmd("tmux", ["kill-session", "-t", `pi-bg-${aid}`]).catch(() => {})
        }
        logline("kill-session fallback done")
      }
    }

    pipe = pipeId ? await readPipe(pipeId) : pipe
    const endedAt = new Date().toISOString()

    // 4) assemble record
    const record = {
      runId,
      scenario: sc.id,
      model,
      arm,
      n,
      startedAt,
      endedAt,
      phase: pipe?.phase ?? "unknown",
      pipeline: pipe
        ? {
            id: pipeId,
            model: pipe.model,
            reviewRound: pipe.reviewRound,
            reviewers: pipe.reviewers ?? [],
            implWorkDir: pipe.implWorkDir,
            doPr: pipe.doPr ?? false,
          }
        : null,
      agents: {},
      costsByRole: {},
      costTotal: 0,
      hiddenTests: null,
      judge: null,
      files: null,
      snapshot: {
        extCommit: ctx.extCommit,
        piVersion: ctx.piVersion,
        judgeModel: ctx.judgeModel,
        statementHash: sha(stmt),
        repoHead: repoState.stdout?.trim() ?? "",
      },
      log,
    }

    if (pipe) {
      const roles = [
        ["impl", pipe.implId],
        ["rca", pipe.rcaId],
        ["fixer", pipe.fixerId],
        ...(pipe.reviewers ?? []).map((r, i) => [`review${i}`, r]),
      ]
      for (const [role, id] of roles) {
        if (!id) continue
        const d = path.join(BG_DIR, id)
        const u = sumUsage(path.join(d, "session"))
        const act = agentActivity(d)
        record.agents[role] = { id, usage: u, activity: act }
        record.costsByRole[role] = u.cost
        record.costTotal += u.cost
      }
      const du = sumUsage(sessionDir)
      record.costsByRole["driver"] = du.cost
      record.costTotal += du.cost
      const meta = pipelineMeta(pipe)
      record.watchdogFires = meta.watchdogFires
      record.rcaSpawned = meta.rca
      record.steer = meta.steer
      record.phaseLog = meta.phaseLog

      const art = path.join(runDir, "artifact")
      rmSync(art, { recursive: true, force: true })
      if (pipe.implWorkDir && existsSync(pipe.implWorkDir)) {
        cpSync(pipe.implWorkDir, art, { recursive: true })
        rmSync(path.join(art, ".jj"), { recursive: true, force: true })
        record.files = {
          planExpanded: existsSync(path.join(pipe.implWorkDir, "plan.md")),
          planBytes: existsSync(path.join(pipe.implWorkDir, "plan.md")) ? statSync(path.join(pipe.implWorkDir, "plan.md")).size : 0,
          notesWritten: existsSync(path.join(pipe.implWorkDir, "notes.txt")),
          srcFiles: existsSync(path.join(pipe.implWorkDir, "src")) ? readdirSync(path.join(pipe.implWorkDir, "src")).length : 0,
          testFiles: existsSync(path.join(pipe.implWorkDir, "test")) ? readdirSync(path.join(pipe.implWorkDir, "test")).length : 0,
        }
      }

      record.hiddenTests = await scoreHidden(sc, art, runDir)
      if (ctx.noJudge) {
        record.judge = null
        record.judgePending = true
      } else {
        record.judge = await judge(sc, art, record.hiddenTests, ctx.judgeModel)
      }
    }

    appendFileSync(recordPath, JSON.stringify(record) + "\n")
    const done = JSON.parse(existsSync(ctx.statePath) ? readFileSync(ctx.statePath, "utf8") : "{}")
    done.done = { ...(done.done ?? {}), [runId]: true }
    writeFileSync(ctx.statePath, JSON.stringify(done, null, 2))
    console.log(
      `[done] ${runId} | phase=${record.phase} | hidden=${record.hiddenTests?.pass ?? "-"}/${record.hiddenTests?.tests ?? "-"} | judge=${record.judge?.score ?? "-"} | cost=$${record.costTotal.toFixed(2)}`,
    )
    return record
  } catch (e) {
    logline(`run failed: ${e instanceof Error ? e.message : String(e)}`)
    appendFileSync(recordPath, JSON.stringify({ runId, scenario: sc.id, model, arm, n, startedAt, error: String(e) }) + "\n")
    return null
  }
}

function spawnPi(cwd, sessionDir, name, model, runDir, logline) {
  const proc = spawn(piBin(), ["--mode", "rpc", "--session-dir", sessionDir, "--name", name, "--model", model], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  })
  proc.stdout.on("data", (d) => { try { appendFileSync(path.join(runDir, "out.jsonl"), d) } catch {} })
  proc.stderr.on("data", (d) => { try { appendFileSync(path.join(runDir, "err.log"), d) } catch {} })
  proc.on("exit", (c) => logline(`pi process exited code=${c}`))
  return { proc }
}

// ---------- main ----------
async function main() {
  // API key lookup order: OPENCODE_API_KEY env -> bench/.key (gitignored) -> auth.json
  if (!process.env.OPENCODE_API_KEY) {
    const keyFile = path.join(HERE, ".key")
    if (existsSync(keyFile)) {
      try { process.env.OPENCODE_API_KEY = readFileSync(keyFile, "utf8").trim() } catch {}
    }
  }
  if (!process.env.OPENCODE_API_KEY) {
    const authP = path.join(HOME, ".local", "share", "opencode", "auth.json")
    try {
      const auth = JSON.parse(readFileSync(authP, "utf8"))
      const key = Object.values(auth).find((v) => v && v.type === "api")?.key
      if (key) process.env.OPENCODE_API_KEY = key
    } catch {}
  }
  if (!process.env.OPENCODE_API_KEY) console.error("WARNING: no OPENCODE_API_KEY found; probes/agents will fail auth")

  const scenarioId = arg("scenario", "all")
  const modelsArg = arg("models", null)
  const arms = String(arg("arms", "A,B")).split(",")
  const n = parseInt(arg("n", "10"), 10)
  const cap = parseInt(arg("cap", "4"), 10)
  const outdir = arg("outdir", path.join(HERE, "results"))
  const judgeModel = arg("judge-model", DEFAULT_JUDGE)
  const probeOnly = arg("probe-only", false)
  const judgeOnly = arg("judge-only", false)
  const noJudge = arg("no-judge", false)
  const maxRuns = arg("max-runs", null)
  mkdirSync(outdir, { recursive: true })
  const statePath = path.join(outdir, "state.json")
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { done: {}, queue: [] }

  if (judgeOnly) {
    // Phase 2: judge every run record that is missing a score (idempotent, resumes).
    const resultsPath = path.join(outdir, "results.jsonl")
    const records = existsSync(resultsPath)
      ? readFileSync(resultsPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : []
    if (!records.length) { console.error(`no records in ${resultsPath}`); return }
    let scored = 0
    for (const rec of records) {
      rec.error = undefined
      if (rec.judge && rec.judge.score != null) continue
      const sc = loadScenario(rec.scenario)
      const art = path.join(outdir, "runs", rec.runId, "artifact")
      if (!existsSync(art)) {
        console.log(`[skip] ${rec.runId}: artifact missing (clean outdir? run was recorded before? )`)
        continue
      }
      const hidden = rec.hiddenTests ?? { tests: "-", pass: "-", fail: "-" }
      rec.judge = await judge(sc, art, hidden, judgeModel)
      rec.judgePending = false
      rec.judgedAt = new Date().toISOString()
      scored += 1
      console.log(`[judge] ${rec.runId} score=${rec.judge.score ?? "ERR"} ${rec.judge.error ?? ""}`)
    }
    writeFileSync(resultsPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n")
    console.log(`judged ${scored}/${records.length} records`)
    return
  }

  const models = modelsArg ? modelsArg.split(",").map((s) => s.trim()) : DEFAULT_MODELS
  const scenarios = scenarioId === "all"
    ? ["kalah-poc", "expr-eval"].map(loadScenario)
    : [loadScenario(scenarioId)]

  const ctx = { outdir, statePath, judgeModel, noJudge }
  ctx.piVersion = (await runCmd(piBin(), ["--version"])).stdout.trim()
  ctx.extCommit = (await runCmd("git", ["rev-parse", "--short", "HEAD"], { cwd: path.resolve(HERE, "..") })).stdout.trim()

  // 0) probe every model for rate limits / availability
  console.log("probe:", models.join(", "))
  const probeResults = []
  for (const m of models) {
    const p = await probeModel(m)
    probeResults.push(p)
    console.log(`  probe ${m}: ${p.ok ? `ok ${p.ms}ms` : `FAIL ${p.err}`}`)
    if (!p.ok) await sleep(5_000)
  }
  writeFileSync(path.join(outdir, "probe.json"), JSON.stringify(probeResults, null, 2))
  if (probeOnly) { console.log("probe only; done"); return }
  const rateLimited = new Set(probeResults.filter((p) => /429|rate|quota|limit/i.test(p.err ?? "")).map((p) => p.model))

  // 1) queue cartesian, skip done
  let queue = []
  for (const sc of scenarios) for (const m of models) for (const a of arms) for (let i = 1; i <= n; i++) {
    const runId = `${sc.id}.${m.replace(/[^A-Za-z0-9]/g, "_")}.${a}.${i}`
    if (state.done[runId]) continue
    queue.push({ sc, model: m, arm: a, n: i, runId })
  }
  state.queue = queue.map((q) => q.runId)
  writeFileSync(statePath, JSON.stringify(state, null, 2))
  if (maxRuns) queue = queue.slice(0, parseInt(maxRuns, 10))
  console.log(`queue: ${queue.length} runs | rateLimited: ${[...rateLimited].join(", ") || "none"} | cap=${cap}`)

  // 2) scheduler
  let idx = 0
  const results = []
  async function worker() {
    while (true) {
      const item = queue[idx++]
      if (!item) return
      const r = await runOne(item.sc, item.model, item.arm, item.n, ctx)
      if (r) results.push(r)
    }
  }
  const workers = []
  for (let w = 0; w < Math.min(cap, queue.length); w++) workers.push(worker())
  await Promise.all(workers)

  if (results.length) {
    console.log("\n=== summary ===")
    console.table(results.map((r) => ({
      run: r.runId.slice(0, 48),
      phase: r.phase,
      hidden: `${r.hiddenTests?.pass ?? "-"}/${r.hiddenTests?.tests ?? "-"}`,
      judge: r.judge?.score ?? "-",
      cost: `$${(r.costTotal ?? 0).toFixed(2)}`,
    })))
  }
  console.log(`all results: ${path.join(outdir, "results.jsonl")}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
