import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import plugin from "../dist/plugin.js"
import { GoalStore } from "../dist/store.js"
import { decodeChange, decodeState } from "../dist/codec.js"

test("the reusable V2 plugin has a project-neutral identity", () => {
  assert.equal(plugin.id, "goal-lite")
})

function host(saved = new Map()) {
  const tools = new Map()
  const hooks = new Map()
  const counters = { reads: 0, writes: 0, calls: 0 }
  const ctx = {
    location: { project: { canonical: "/no-local-goal-lite-in-this-fixture" } },
    storage: {
      get: async (key) => { counters.reads++; return saved.get(key) },
      set: async (key, value) => { counters.writes++; saved.set(key, structuredClone(value)) },
    },
    tool: {
      transform: async (register) => {
        register({ namespace: () => {}, add: (info) => tools.set(info.name, info) })
        return { dispose: async () => tools.clear() }
      },
    },
    session: {
      hook: async (name, callback) => {
        hooks.set(name, callback)
        return { dispose: async () => hooks.delete(name) }
      },
    },
  }
  return {
    saved, counters, tools, hooks,
    async start() { return plugin.setup(ctx) },
    async call(name, input, sessionID = "ses-v2") {
      counters.calls++
      return JSON.parse((await tools.get(name).execute(input, { sessionID })).content)
    },
    async context(sessionID = "ses-v2", system = []) {
      await hooks.get("context")({ sessionID, system })
      return system
    },
  }
}

test("V2 adapter persists, serializes concurrent writes, rehydrates after simulated compaction and host restart", async () => {
  const state = new Map()
  const first = host(state)
  const cleanup = await first.start()
  assert.deepEqual([...first.tools.keys()], ["start", "status", "update", "finish"])
  const created = await first.call("start", {
    objective: "Ship a well-tested tiny goal plugin", criteria: [{ id: "works", text: "The saved goal survives compaction" }],
    constraints: [{ id: "no-rerun", text: "Never automatically rerun tests" }],
    tasks: [{ id: "storage", text: "Persist the state", required: true }],
  })
  assert.equal(created.goal.revision, 1)
  assert.deepEqual(created.assessment.openRequiredTasks, ["storage"])
  assert.equal(state.size, 1)
  assert.equal(first.counters.writes, 1)
  const edit = (revision, change) => first.call("update", { expectedRevision: revision, change })
  const [changed, stale] = await Promise.allSettled([
    edit(1, { type: "task.status", id: "storage", status: "done" }),
    edit(1, { type: "task.add", id: "extra", text: "Should not be committed" }),
  ])
  assert.equal(changed.status, "fulfilled")
  assert.equal(stale.status, "rejected")
  assert.match(stale.reason.message, /Goal changed/)
  assert.equal(first.counters.writes, 2)
  await cleanup()
  assert.equal(first.tools.size, 0)
  assert.equal(first.hooks.size, 0)

  const second = host(state)
  const dispose = await second.start()
  // Automatic or manual compaction discards the transcript, not plugin storage.
  const afterCompaction = await second.context()
  assert.equal(afterCompaction.length, 1)
  assert.match(afterCompaction[0].text, /tools.goal.status/)
  assert.match(afterCompaction[0].text, /storage/)
  assert.doesNotMatch(afterCompaction[0].text, /Ship a well-tested/)
  await second.context("ses-v2", afterCompaction)
  assert.equal(afterCompaction.length, 1)
  const restored = await second.call("status", {})
  assert.equal(restored.goal.revision, 2)
  assert.equal(restored.goal.tasks[0].status, "done")
  assert.equal((await second.call("status", {}, "other-session")).goal, null)
  assert.deepEqual(restored.assessment.missingCriteria, ["works"])
  assert.deepEqual(restored.assessment.unreviewedConstraints, ["no-rerun"])
  assert.equal(second.counters.writes, 0)
  assert.equal(second.counters.calls, 2) // no hidden verifier calls
  await assert.rejects(second.call("finish", { expectedRevision: 2, summary: "Not yet" }), /not ready/)
  const recorded = await second.call("update", { expectedRevision: 2, change: { type: "criterion.record", id: "works", evidence: { kind: "review", reference: "host test", summary: "state restored" } } })
  assert.equal(recorded.goal.criteria[0].evidence.recordedAt > 0, true)
  assert.equal(recorded.assessment.readyForCompletion, false)
  const reviewed = await second.call("update", { expectedRevision: 3, change: { type: "constraint.review", id: "no-rerun", note: "Only explicit test invocation observed" } })
  assert.equal(reviewed.assessment.readyForCompletion, true)
  const result = await second.call("finish", { expectedRevision: 4, summary: "Tests passed; evidence is an agent report, not an independent proof." })
  assert.equal(result.goal.status, "complete")
  assert.equal(result.goal.completion.actor, "agent")
  assert.deepEqual(await second.context(), [])
  await dispose()
})

test("large plans keep the per-turn reminder bounded", async () => {
  const runtime = host()
  await runtime.start()
  const tasks = Array.from({ length: 100 }, (_, i) => ({ id: `step-${i}`, text: `Deliver ${i}` }))
  await runtime.call("start", { objective: "Big but bounded plan", criteria: [{ id: "ok", text: "Complete" }], constraints: [], tasks })
  const [note] = await runtime.context()
  assert.ok(note.text.length < 1800)
  assert.match(note.text, /"count":100/)
  assert.doesNotMatch(note.text, /step-99/)
})

test("stored state rejects corruption and cannot silently overwrite a session goal", async () => {
  const memory = new Map()
  const runtime = host(memory)
  await runtime.start()
  const payload = { objective: "A", criteria: [{ id: "c", text: "Checked" }], constraints: [], tasks: [] }
  await runtime.call("start", payload)
  await assert.rejects(runtime.call("start", payload), /already has a goal/)
  const key = [...memory.keys()][0]
  const wrongSession = structuredClone(memory.get(key))
  wrongSession.sessionID = "other"
  assert.throws(() => decodeState(wrongSession, "ses-v2"), /mismatched/)
  memory.set(key, { ...memory.get(key), schemaVersion: 22 })
  await assert.rejects(runtime.call("status", {}), /Incompatible/)
  await assert.rejects(runtime.context(), /Incompatible/)
  assert.equal(memory.get(key).schemaVersion, 22)
})

test("codec limits input, rejects unknown operations and assigns its own evidence time", () => {
  assert.throws(() => decodeChange({ type: "shell.run", command: "rm -rf" }, 1), /Unsupported/)
  assert.throws(() => decodeChange({ type: "task.status", id: "a", status: "blessed" }, 1), /Invalid task status/)
  assert.throws(() => decodeChange({ type: "task.add", id: "bad\n", text: "do" }, 1), /ID/)
  assert.equal(decodeChange({ type: "criterion.record", id: "c", evidence: { kind: "command", reference: "unit test", summary: "passed", recordedAt: 0 } }, 99).evidence.recordedAt, 99)
  assert.throws(() => decodeChange({ type: "policy.set", adrs: ["../other/secret"], review: [] }, 99), /relative project paths/)
  assert.throws(() => decodeChange({ type: "policy.set", adrs: ["docs/one.md", "docs/one.md"], review: [] }, 99), /unique/)
  assert.throws(() => decodeChange({ type: "policy.set", adrs: ["C:/other/secret"], review: [] }, 99), /relative project paths/)
  assert.throws(() => decodeChange({ type: "policy.set", adrs: [], review: Array(11).fill("guide.md") }, 99), /at most 10/)
})

test("contrasting project references survive compaction and restart without embedding rules in the reminder", async () => {
  const state = new Map()
  const first = host(state)
  await first.start()
  const input = { objective: "Make the outcome work", criteria: [{ id: "outcome", text: "Observable outcome" }], constraints: [], tasks: [] }
  const projects = [
    { session: "orbit", adrs: ["docs/decisions/index.md"], review: ["CONTRIBUTING.md"] },
    { session: "harbor", adrs: ["architecture/records.md"], review: ["process/pull-requests.md", "process/review-checklist.md"] },
  ]
  for (const project of projects) {
    // These fixtures disagree on both location and review policy. Discovery belongs to the agent,
    // while the plugin stores opaque, project-scoped pointers and never interprets either rule.
    for (const path of [...project.adrs, ...project.review]) {
      const source = await readFile(new URL(`./fixtures/${project.session}/${path}`, import.meta.url), "utf8")
      assert.ok(source.length > 0)
    }
    const started = await first.call("start", input, project.session)
    const updated = await first.call("update", { expectedRevision: started.goal.revision, change: { type: "policy.set", adrs: project.adrs, review: project.review } }, project.session)
    assert.deepEqual(updated.goal.policy, { adrs: project.adrs, review: project.review })
  }
  const writes = first.counters.writes
  const second = host(state)
  await second.start()
  for (const project of projects) {
    const reminder = await second.context(project.session)
    assert.equal(reminder.length, 1)
    assert.match(reminder[0].text, /saved policy references/)
    assert.doesNotMatch(reminder[0].text, /CONTRIBUTING|pull-requests|decisions/)
    const restored = await second.call("status", {}, project.session)
    assert.deepEqual(restored.goal.policy, { adrs: project.adrs, review: project.review })
    assert.doesNotMatch(JSON.stringify(restored.goal), /Require a human approval|single reviewer/)
  }
  assert.equal(first.counters.writes, writes)
  assert.equal(second.counters.writes, 0)
  const key = [...state.keys()].find((value) => value.includes("orbit"))
  const damaged = structuredClone(state.get(key))
  damaged.policy.adrs = ["../outside.md"]
  state.set(key, damaged)
  await assert.rejects(second.call("status", {}, "orbit"), /relative project paths/)
})

test("store never writes a failed transition and serializes after a rejected one", async () => {
  const memory = new Map()
  const store = new GoalStore({ get: async (key) => memory.get(key), set: async (key, value) => memory.set(key, value) })
  await assert.rejects(store.update("s", () => { throw new Error("invalid") }), /invalid/)
  assert.equal(await store.get("s"), undefined)
  await assert.rejects(store.update("s", () => ({ sessionID: "other" })), /Cannot move/)
  assert.equal(memory.size, 0)
})
