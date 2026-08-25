# π-bench — pi-workflow benchmark

A resumable harness to answer one question per cycle: **does a change to the workflow
(pipeline code, prompts, model assignments, knobs) actually improve results?**

Every run = one real `/pipeline` execution on a scenario repo, scored on four axes:
**code quality, cost, speed, ease-of-use (human attention)**.

Current design decisions (grilled, 2026-08-25) and scenario suite in `scenarios/`.

## What a run scores

| Axe | Measured by |
|---|---|
| Code quality | hidden acceptance tests (injected at scoring time, **never visible to the agent**) + a fixed LLM judge (default `opencode-go/deepseek-v4-flash`) scoring the final tree 0–2 per criterion vs the standards doc rubric (best practices / library use / architectural soundness / HARD YANGI simplicity / code reuse) |
| Cost | real usage + `$` from the agent session JSONLs (`~/.pi/agent/bg/<id>/session/*.jsonl`), summed **per role** (impl / reviewN / fixer / rca / driver). NOTE: the RPC event stream zeroes usage — sessions are the source of truth. |
| Speed | wall time to terminal phase, plus the phase log (UTC timestamps from the pipeline record) |
| Ease-of-use | watchdog fires, RCA spawns, steers, deadline cancels, and (later, grill-ON runs) human prompt count |

## Arms

- **Arm A** — implementer only: `/pipeline --no-grill --reviewers 0` (plan.md + notes.txt +
  watchdog still active, zero reviewer loop).
- **Arm B** — full pipeline: `/pipeline --no-grill` (implementer + 2 reviewers + fix loop).

The A/B contrast answers "does the pipeline (review loop) improve results?" — the same
candidate models run in both arms, so a pipeline effect is visible as *quality(arm B) −
quality(arm A)* at fixed cost/speed delta.

## Phase 0 (current plan)

- 7 free models + 1 cheap anchor:
  `opencode-go/ox-alpha-free, opencode/hy3-free, opencode/mimo-v2.5-free,
  opencode/muse-spark-1.2-contributor-free, opencode/nemotron-3.5-lightning-free,
  opencode/nemotron-3-ultra-free, opencode/x-preview-f-free`,
  anchor `opencode-go/deepseek-v4-flash` (paid, cheap) as an anchor so free-tier
  results stay comparable with the real stack.
- 2 scenarios (`kalah-poc`, `expr-eval`) × 2 arms × N=10 = 320 runs.
- Judge = `opencode-go/deepseek-v4-flash` (cheap, fixed — never change mid-cycle).
- **Judge calibration**: before trusting the numbers, you eyeball ~6 artifacts (2 per
  scenario/arm) and compare your scores vs the judge's; disagreement > ~20% → tune the
  rubric prompt before continuing.

## Improvement rule

"Improved" = quality up (hidden tests AND judge ≥ 10% relative up on ≥ 2 of the
scenarios) **and** cost not up > 3x. Report medians/IQR per (model, arm, scenario) —
never declare a win inside IQR overlap. The full rows live in `results.jsonl`.

## Usage

```sh
# probe all models + preflight (no runs):
node bench/run-bench.mjs --probe-only

# 1 real run (smoke):
node bench/run-bench.mjs --scenario expr-eval --models opencode-go/ox-alpha-free --arms A --n 1 --max-runs 1

# the big one (resumable):
bench/run-inhibited.sh --cap 4          # blocks suspend for the whole run
```

- Concurrency: cap 4 default (probe first for 429s; rate-limited models are reported;
  raise to 8 only if probes are clean — provider free-tier limits are the wall).
- Resume: any interrupted run re-reads `state.json` and skips finished `runId`s.
- Hard caps per run: arm A 60 min, arm B 90 min → `/pipeline cancel` + kill-session
  fallback, recorded as a `cancelled` phase.
- API key: benchmark spends should run on the **dedicated benchmark key** in
  `bench/.key` (gitignored — never the shared/auth.json key). Lookup order:
  `OPENCODE_API_KEY` env → `bench/.key` → `~/.local/share/opencode/auth.json` as
  fallback. The `.key` file is created once:
  `printf '<your-opencode-go-key>\n' > bench/.key`.

## Results schema

`results.jsonl`, one record per run (`bench/results/` is gitignored):

```
runId, scenario, model, arm, n, startedAt, endedAt, phase,
pipeline { id, model, reviewRound, reviewers, implWorkDir, doPr },
agents { <role>: { id, usage {input,output,cacheRead,reason,cost}, activity {turns,toolcalls,thinking} } },
costsByRole, costTotal, hiddenTests {exitCode,tests,pass,fail}, judge {score, data},
files {planExpanded, planBytes, notesWritten, srcFiles, testFiles},
watchdogFires, rcaSpawned, steer, phaseLog,
snapshot { extCommit, piVersion, judgeModel, statementHash, repoHead }, log
```

`state.json` = { done: {runId}, queue: [...] } for resume. `probe.json` = per-model
latency/availability.

## Calibration & known caveats

- LLM nondeterminism → never single-run conclusions; N≥2 per config, medians.
- Hidden tests depend on the statement's API contract; a run that "passes its own tests
  but breaks the contract" is a 0/10 hidden — that's the point (the smoke run already
  caught `-2+3` → −5 via hidden tests while judge independently agreed).
- Free models may stall; the pipeline watchdog + RCA covers it (arm A/B vs watchdog
  interplay itself is a benchmarkable metric).
- Run-to-run environment: `snapshot` records the extension commit it was launched with —
  always re-`pi install` before a cycle and let the snapshot prove which commit ran.
