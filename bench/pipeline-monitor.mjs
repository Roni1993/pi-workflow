#!/usr/bin/env node
// Standalone pipeline monitor for the benchmark harness.
// Re-implements the pi extension's tick loop OUTSIDE pi (in this build the in-pi
// timer does not fire reliably). Uses the same files + lock protocol, so it is
// safe to run next to the pi-hosted monitors.
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

const HOME = homedir()
const WORKFLOW_DIR = path.join(HOME, ".pi", "agent", "pi-workflow")
const PIPELINES = path.join(WORKFLOW_DIR, "pipelines", "index.json")
const BG_INDEX = path.join(HOME, ".pi", "agent", "bg", "index.json")
const LOCK_DIR = path.join(WORKFLOW_DIR, "tick.lock")
const MONITOR_MS = parseInt(process.env.PI_BENCH_TICK_MS ?? "5000", 10)
const GEN_RAND = () => Math.random().toString(36).slice(2, 6)

function runCmd(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { timeout: opts.timeout ?? 60_000, cwd: opts.cwd, maxBuffer: 32 << 20, encoding: "utf8" })
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

function readJson(file, dflt) {
  try { return JSON.parse(readFileSync(file, "utf8")) } catch { return dflt }
}
function writeJson(file, data) {
  const tmp = `${file}.tmp.${process.pid}`
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  const r = runCmd("mv", ["-f", tmp, file])
  if (!r.ok) throw new Error(r.stderr)
}

function piBin() {
  if (process.env.PI_BIN) return process.env.PI_BIN
  const p = path.join(HOME, ".npm-pi", "bin", "pi")
  return existsSync(p) ? p : "pi"
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (p, msg) => {
  p.log.push(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
  p.updatedAt = new Date().toISOString()
}

function genId(label) {
  return `${label}-${GEN_RAND()}`
}

function isJjRepo(cwd) {
  return existsSync(path.join(cwd, ".jj"))
}

async function setupJjWorkspace(cwd, workDir, wsName) {
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })
  const r = runCmd("jj", ["workspace", "add", "--name", wsName, workDir], { cwd })
  if (!r.ok) throw new Error(`jj workspace add failed (${wsName}): ${r.stderr.slice(0, 200)}`)
  return workDir
}

function agentSettled(dir) {
  try {
    const content = readFileSync(path.join(dir, "out.jsonl"), "utf8")
    return content.split("\n").some((l) => {
      try { return JSON.parse(l).type === "agent_settled" } catch { return false }
    })
  } catch {
    return false
  }
}

function agentLastActivity(dir) {
  try { return statSync(path.join(dir, "out.jsonl")).mtimeMs } catch { return Date.now() }
}

async function spawnBgAgent(opts) {
  const id = opts.id ?? genId(opts.label)
  const dir = path.join(HOME, ".pi", "agent", "bg", id)
  const sessionDir = path.join(dir, "session")
  const workDir = path.join(dir, "work")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(workDir, { recursive: true })

  const agentCwd = opts.jjIsolation && isJjRepo(opts.cwd)
    ? await setupJjWorkspace(opts.cwd, workDir, `ws-${id}`)
    : opts.cwd

  const outFile = JSON.stringify(path.join(dir, "out.jsonl"))
  const errFile = JSON.stringify(path.join(dir, "err.log"))
  const cmd = `${JSON.stringify(piBin())} --mode rpc --session-dir ${JSON.stringify(sessionDir)} --name ${id} --model ${JSON.stringify(opts.model)} > ${outFile} 2> ${errFile}`
  const r = runCmd("tmux", ["new-session", "-d", "-s", `pi-bg-${id}`, "-c", agentCwd, cmd])
  if (!r.ok) throw new Error(`tmux spawn failed: ${r.stderr.slice(0, 200)}`)

  const bgIndex = readJson(BG_INDEX, {})
  bgIndex[id] = { id, dir, sessionDir, cwd: agentCwd, prompt: opts.prompt, status: "spawning" }
  writeJson(BG_INDEX, bgIndex)

  await sleep(2_500)
  const err = readFileSync(path.join(dir, "err.log"), "utf8").catch?.(() => "") ?? ""
  const err2 = existsSync(path.join(dir, "err.log")) ? readFileSync(path.join(dir, "err.log"), "utf8") : ""
  if (err2.trim() && !err2.includes("update check")) {
    bgIndex[id].status = "stopped"
    writeJson(BG_INDEX, bgIndex)
    runCmd("tmux", ["kill-session", "-t", `pi-bg-${id}`])
    throw new Error(`${id} failed to start: ${err2.trim().slice(0, 400)}`)
  }

  const payload = { id: "p0", type: "prompt", message: opts.prompt }
  runCmd("tmux", ["send-keys", "-t", `pi-bg-${id}`, "-l", JSON.stringify(payload)])
  runCmd("tmux", ["send-keys", "-t", `pi-bg-${id}`, "Enter"])

  bgIndex[id].status = "running"
  writeJson(BG_INDEX, bgIndex)
  return { id, dir, cwd: agentCwd }
}

async function readReviewVerdicts(p) {
  const files = []
  let allPass = true
  for (const rId of p.reviewers) {
    const f = path.join(WORKFLOW_DIR, "pipelines", p.id, `review-${rId}.md`)
    try {
      const content = readFileSync(f, "utf8")
      const m = content.match(/Verdict:\s*(PASS|FAIL)/i)
      if (m?.[1]?.toUpperCase() === "FAIL") allPass = false
      files.push(f)
    } catch { allPass = false }
  }
  return { files, allPass }
}

async function collectFindings(p) {
  const parts = []
  for (const rId of p.reviewers) {
    const f = path.join(WORKFLOW_DIR, "pipelines", p.id, `review-${rId}.md`)
    try {
      const content = readFileSync(f, "utf8")
      const m = content.match(/## Findings([\s\S]*?)(?=## Overall|$)/)
      if (m?.[1]?.trim()) parts.push(`-- reviewer ${rId} --\n${m[1].trim()}`)
    } catch {}
  }
  return parts.join("\n\n") || "(no findings section)"
}

function buildImplPrompt(p) {
  return `You are the implementation agent. Task: ${p.statement}

First expand the plan at ${p.planPath} (structure: goal / scope / files / plan / acceptance / verification), then implement it in this workspace. Work autonomously and stop when the acceptance criteria are met. Summarize what you did and how it was verified. Keep the change minimal and clean.`
}

async function startReview(p) {
  const implDir = path.join(HOME, ".pi", "agent", "bg", p.implId ?? "")
  const implWork = p.implWorkDir ?? implDir
  p.reviewers = []
  for (let n = 0; n < (p.maxReviewers ?? 2); n++) {
    const id = genId(`review${n + 1}`)
    const outFile = path.join(WORKFLOW_DIR, "pipelines", p.id, `review-${id}.md`)
    const prompt = `You are reviewer #${n + 1} in the pi-workflow review pipeline.

Review the change implemented by another agent.
Change location (worktree): ${implWork}
Review standards: best practices; library use; architectural soundness; HARD YANGI simplicity; code reuse.

Inspect the files under ${implWork} (that is the deliverable). Grade each of the five criteria per the standards. Write your review to this exact file: ${outFile} — use the reviewer output contract (Verdict: PASS|FAIL, one section per criterion, ## Findings, ## Overall). No padding.`
    const { id: rId } = await spawnBgAgent({ prompt, model: p.model, cwd: implWork, label: `review${n + 1}`, jjIsolation: false, id })
    p.reviewers.push(rId)
  }
  log(p, `review round ${p.reviewRound} started (${p.reviewers.length} reviewers)`)
}

async function startFix(p) {
  const findings = await collectFindings(p)
  const implWork = p.implWorkDir ?? path.join(HOME, ".pi", "agent", "bg", p.implId ?? "")
  const prompt = `You are the fix agent in the pi-workflow pipeline. Reviewers found issues with the implementation at ${implWork}.

Findings:
${findings.slice(0, 4000)}

Fix the concrete issues directly in ${implWork} (edit the files there). Do not over-engineer — apply the minimal correct fixes. When done, summarize exactly what you changed. Stop when addressed.`
  const { id } = await spawnBgAgent({ prompt, model: p.model, cwd: implWork, label: `fix${p.reviewRound}`, jjIsolation: false })
  p.fixerId = id
  log(p, `fix round ${p.reviewRound} spawned (${id})`)
}

async function finishClean(p) {
  const { files } = await readReviewVerdicts(p)
  const resultPath = path.join(WORKFLOW_DIR, "pipelines", p.id, "result.md")
  const prPath = path.join(WORKFLOW_DIR, "pipelines", p.id, "pr.md")
  writeFileSync(resultPath, `# Pipeline result — ${p.id}\n\n- statement: ${p.statement}\n- implementer: ${p.implId}\n- worktree: ${p.implWorkDir}\n- plan: ${p.planPath}\n- review rounds: ${p.reviewRound}\n- reviews: ${files.join(", ")}\n- status: clean\n`)
  writeFileSync(prPath, `# PR: ${p.statement}\n\n## Summary\n${p.statement}\n\n## Change\n- worktree: ${p.implWorkDir}\n\n## Review\n- all ${p.maxReviewers ?? 2} reviewers PASS (round ${p.reviewRound})\n`)
  p.phase = "clean"
  log(p, `all reviews PASS after ${p.reviewRound} round(s); artifacts written`)
}

async function startRca(p) {
  const rcaPath = path.join(WORKFLOW_DIR, "pipelines", p.id, "rca.md")
  const implDir = path.join(HOME, ".pi", "agent", "bg", p.implId ?? "")
  let tail = "(empty)"
  try {
    const content = readFileSync(path.join(implDir, "out.jsonl"), "utf8")
    const events = content.split("\n").filter(Boolean).slice(-25).map((l) => {
      try {
        const e = JSON.parse(l)
        const ev = e.assistantMessageEvent
        const a = e.args
        return `[${e.type}]${ev && ev.type ? ` ${ev.type}` : ""}${a && a.command ? ` cmd=${String(a.command).slice(0, 120)}` : ""}${ev && ev.delta ? ` ${String(ev.delta).slice(0, 120)}` : ""}`
      } catch { return "" }
    }).filter(Boolean).join("\n")
    tail = events || "(empty)"
  } catch {}
  const prompt = `Investigate why a background implementation agent appears stuck (no activity).

Implementer prompt: ${(p.implPrompt ?? p.statement).slice(0, 500)}

Recent events from its log (last 25):
\`\`\`
${tail.slice(0, 3000)}
\`\`\`

Its session file lives at ${implDir}/session/ but DO NOT read it in full — reason from the prompt + events above.

Write ${rcaPath} containing exactly:
# RCA
## Root cause
<one clear paragraph>
## Evidence
- concrete events/commands showing the loop
## Proposed fix
<exact steer message for the implementer, one line starting with "STEER:" — the pipeline forwards it verbatim>

Keep it short (under 250 words) and concrete. Do not use other tools beyond the write needed to produce ${rcaPath}.`
  const { id } = await spawnBgAgent({ prompt, model: p.model, cwd: implDir, label: "rca", jjIsolation: false })
  p.rcaId = id
  p.phase = "stuck"
  log(p, `RCA agent spawned (${id})`)
}

async function handleRcaDone(p) {
  const rcaPath = path.join(WORKFLOW_DIR, "pipelines", p.id, "rca.md")
  let steerMsg = ""
  try {
    const content = readFileSync(rcaPath, "utf8")
    const m = content.match(/STEER:\s*(.+)/)
    if (m?.[1]) steerMsg = m[1].trim()
  } catch {}
  const implAlive = p.implId
    ? runCmd("tmux", ["has-session", "-t", `pi-bg-${p.implId}`]).ok
    : false
  if (implAlive && steerMsg && p.implId) {
    runCmd("tmux", ["send-keys", "-t", `pi-bg-${p.implId}`, "-l", JSON.stringify({ type: "steer", message: steerMsg })])
    runCmd("tmux", ["send-keys", "-t", `pi-bg-${p.implId}`, "Enter"])
    log(p, "RCA done; steered implementer")
    p.phase = "implementing"
  } else if (implAlive) {
    log(p, "RCA done; no steer line; continuing to watch")
    p.phase = "implementing"
  } else {
    p.phase = "failed"
    log(p, "RCA done but implementer process died — pipeline failed")
  }
}

async function tick() {
  const pipes = readJson(PIPELINES, {})
  let changed = false
  for (const p of Object.values(pipes)) {
    const before = p.phase
    try {
      switch (p.phase) {
        case "planning": {
          if (!p.implId && Date.now() - new Date(p.createdAt ?? 0).getTime() > 90_000) {
            const implPrompt = p.implPrompt ?? buildImplPrompt(p)
            const { id: implId, cwd: implCwd } = await spawnBgAgent({
              prompt: implPrompt, model: p.model, cwd: p.cwd ?? HOME, label: "impl", jjIsolation: true,
            })
            p.implId = implId
            p.implWorkDir = implCwd
            p.implPrompt = implPrompt
            p.phase = "implementing"
            log(p, `planning-heal: implementer spawned (${implId}) at ${implCwd}`)
          }
          break
        }
        case "implementing": {
          if (!p.implId) break
          const implDir = path.join(HOME, ".pi", "agent", "bg", p.implId)
          const implAlive = runCmd("tmux", ["has-session", "-t", `pi-bg-${p.implId}`]).ok
          if (!implAlive && Date.now() - agentLastActivity(implDir) > 120_000) {
            p.phase = "failed"
            log(p, `implementer session gone (${p.implId}); marking failed`)
          } else if (agentSettled(implDir)) {
            p.phase = "reviewing"
            p.reviewRound = 0
            log(p, "implementer settled; starting review")
            await startReview(p)
          } else if (
            (!p.lastRcaAt || Date.now() - p.lastRcaAt > (p.stuckMs ?? 120_000) * 2) &&
            Date.now() - agentLastActivity(implDir) > (p.stuckMs ?? 120_000)
          ) {
            p.lastRcaAt = Date.now()
            log(p, "watchdog: implementer stuck (no activity); spawning RCA")
            await startRca(p)
          }
          break
        }
        case "stuck": {
          if (p.rcaId) {
            const rcaDir = path.join(HOME, ".pi", "agent", "bg", p.rcaId)
            if (agentSettled(rcaDir)) await handleRcaDone(p)
          }
          break
        }
        case "reviewing": {
          let allDone = true
          for (const rId of p.reviewers) {
            const rDir = path.join(HOME, ".pi", "agent", "bg", rId)
            if (!agentSettled(rDir)) allDone = false
          }
          if (allDone) {
            const { allPass } = await readReviewVerdicts(p)
            if (allPass) {
              await finishClean(p)
            } else if (p.reviewRound >= (p.maxReviewRounds ?? 3)) {
              p.phase = "failed"
              log(p, `review FAIL persists after ${p.reviewRound} rounds`)
            } else {
              p.reviewRound += 1
              await startFix(p)
            }
          }
          break
        }
        case "fixing": {
          if (p.fixerId) {
            const fDir = path.join(HOME, ".pi", "agent", "bg", p.fixerId)
            if (agentSettled(fDir)) {
              log(p, `fix round ${p.reviewRound} done; re-reviewing`)
              await startReview(p)
            }
          }
          break
        }
      }
      if (p.phase !== before) changed = true
    } catch (e) {
      log(p, `monitor error: ${e instanceof Error ? e.message : String(e)}`)
      changed = true
    }
  }
  if (changed) writeJson(PIPELINES, pipes)
}

async function main() {
  console.log(`[pipeline-monitor] start (tick ${MONITOR_MS}ms)`)
  let fail = 0
  for (;;) {
    await sleep(MONITOR_MS)
    try {
      mkdirSync(LOCK_DIR)
    } catch {
      continue
    }
    try {
      await tick()
      fail = 0
    } catch (e) {
      fail += 1
      console.error(`[pipeline-monitor] tick error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      try { rmSync(LOCK_DIR, { recursive: true, force: true }) } catch {}
    }
    if (fail > 20) { console.error("pipeline-monitor: too many errors; exiting (harness will restart me)"); return }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
