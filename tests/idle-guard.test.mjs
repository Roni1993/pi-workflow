import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs/promises"
import {
  createIdleGuard,
  clearMarker,
  MARKER,
} from "../extensions/idle-guard.ts"

function makeHarness(opts) {
  const handlers = new Map()
  const pi = {
    on: (name, handler) => {
      handlers.set(name, handler)
    },
  }
  createIdleGuard(pi, opts)
  const emit = async (name, mode, isIdle = false) => {
    const h = handlers.get(name)
    if (!h) throw new Error(`no handler for ${name}`)
    await h({}, { mode, isIdle: () => isIdle })
  }
  return { emit }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function markerMtime() {
  try {
    const st = await fs.stat(MARKER)
    return st.mtimeMs
  } catch {
    return null
  }
}

before(async () => {
  await clearMarker()
})
after(async () => {
  await clearMarker()
})

test("TUI: agent_start writes the shared marker", async () => {
  const { emit } = makeHarness()
  await emit("session_start", "tui")
  assert.equal(await markerMtime(), null, "marker absent before activity")
  await emit("agent_start", "tui")
  assert.ok((await markerMtime()) !== null, "marker written on agent_start")
})

test("TUI: heartbeat keeps marker fresh while working (no tool call)", async () => {
  const { emit } = makeHarness({ heartbeatMs: 40 })
  await emit("session_start", "tui")
  await emit("agent_start", "tui")
  const t0 = (await markerMtime())
  await sleep(110)
  const t1 = (await markerMtime())
  assert.ok(t1 > t0, `marker refreshed by heartbeat (t0=${t0}, t1=${t1})`)
  await emit("session_shutdown", "tui")
})

test("TUI: agent_settled + isIdle clears the marker", async () => {
  const { emit } = makeHarness()
  await emit("session_start", "tui")
  await emit("agent_start", "tui")
  assert.ok((await markerMtime()) !== null)
  await emit("agent_settled", "tui", true)
  assert.equal(await markerMtime(), null, "marker cleared when settled+idle")
})

test("TUI: tool_call during streaming keeps it active", async () => {
  const { emit } = makeHarness({ heartbeatMs: 40 })
  await emit("session_start", "tui")
  await emit("message_update", "tui")
  assert.ok((await markerMtime()) !== null, "message_update marks active")
  await emit("tool_call", "tui")
  assert.ok((await markerMtime()) !== null)
  await emit("session_shutdown", "tui")
})

test("INTERACTIVE-ONLY: rpc/json/print mode never writes the marker", async () => {
  const { emit } = makeHarness()
  for (const mode of ["rpc", "json", "print"]) {
    await emit("session_start", mode)
    await emit("agent_start", mode)
    await emit("tool_call", mode)
    await emit("message_update", mode)
    await emit("agent_settled", mode, true)
    assert.equal(
      await markerMtime(),
      null,
      `marker must not exist in ${mode} mode`,
    )
  }
})

test("session_shutdown clears the marker", async () => {
  const { emit } = makeHarness()
  await emit("session_start", "tui")
  await emit("agent_start", "tui")
  assert.ok((await markerMtime()) !== null)
  await emit("session_shutdown", "tui")
  assert.equal(await markerMtime(), null)
})
