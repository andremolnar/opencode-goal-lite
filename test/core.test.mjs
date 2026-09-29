import test from "node:test"
import assert from "node:assert/strict"
import { assess, changeGoal, completeGoal, createGoal } from "../src/core.ts"

function fresh() {
  return createGoal({
    id: "goal-1", sessionID: "ses-1", objective: "Deliver a small plugin", now: 100,
    criteria: [{ id: "c1", text: "Persists across compaction" }, { id: "c2", text: "Reports incomplete work" }],
    constraints: [{ id: "guard", text: "Never rerun checks automatically" }],
  })
}

const evidence = (summary) => ({ kind: "file", reference: "test/core.test.mjs", summary, recordedAt: 200 })
const change = (state, action) => changeGoal(state, state.revision, action, state.updatedAt + 1)

test("records criteria and constraints without treating an agent's evidence as certified truth", () => {
  const start = fresh()
  assert.deepEqual(assess(start), {
    readyForCompletion: false, missingCriteria: ["c1", "c2"], openRequiredTasks: [], unreviewedConstraints: ["guard"],
  })
  const first = change(start, { type: "criterion.record", id: "c1", evidence: evidence("Observed after compaction") })
  const ready = change(first, { type: "criterion.record", id: "c2", evidence: evidence("Missing items are listed") })
  assert.equal(assess(ready).readyForCompletion, false)
  assert.deepEqual(assess(ready).unreviewedConstraints, ["guard"])
  const reviewed = change(ready, { type: "constraint.review", id: "guard", note: "Checked no automatic reruns occurred" })
  assert.equal(assess(reviewed).readyForCompletion, true)
  assert.equal(start.criteria[0].evidence, undefined)
  assert.throws(() => completeGoal(ready, ready.revision, { actor: "agent", summary: "premature" }, 300), /not ready/)
  assert.throws(() => completeGoal(reviewed, reviewed.revision, { actor: "agent", summary: "" }, 300), /completion summary/)
  const done = completeGoal(reviewed, reviewed.revision, { actor: "agent", summary: "I reviewed the constraint and recorded evidence" }, 300)
  assert.equal(done.status, "complete")
  assert.equal(done.completion.actor, "agent")
  assert.throws(() => change(done, { type: "task.add", id: "late", text: "unexpected" }), /cannot be changed/)
})

test("tasks grow, reorder, block, reopen, shrink, and cannot hide an unfinished required task", () => {
  let state = fresh()
  state = change(state, { type: "task.add", id: "a", text: "Model state" })
  state = change(state, { type: "task.add", id: "b", text: "Add adapter" })
  state = change(state, { type: "task.add", id: "optional", text: "Polish", required: false })
  assert.deepEqual(assess(state).openRequiredTasks, ["a", "b"])
  state = change(state, { type: "task.order", ids: ["b", "a", "optional"] })
  assert.deepEqual(state.tasks.map((item) => item.id), ["b", "a", "optional"])
  assert.throws(() => change(state, { type: "task.status", id: "b", status: "blocked" }), /reason/)
  state = change(state, { type: "task.status", id: "b", status: "blocked", reason: "Need host API" })
  assert.deepEqual(assess(state).openRequiredTasks, ["b", "a"])
  state = change(state, { type: "task.status", id: "b", status: "todo" })
  assert.equal(state.tasks[0].reason, undefined)
  state = change(state, { type: "task.status", id: "a", status: "done" })
  state = change(state, { type: "task.edit", id: "a", text: "Updated task meaning" })
  assert.deepEqual(assess(state).openRequiredTasks, ["b", "a"])
  state = change(state, { type: "task.status", id: "a", status: "done" })
  state = change(state, { type: "task.status", id: "b", status: "cancelled", reason: "No longer in scope" })
  assert.deepEqual(assess(state).openRequiredTasks, ["b"])
  state = change(state, { type: "task.remove", id: "b", reason: "Replaced by native continuation" })
  assert.deepEqual(assess(state).openRequiredTasks, [])
  assert.deepEqual(state.removedTasks.map((item) => item.id), ["b"])
  assert.throws(() => change(state, { type: "task.add", id: "b", text: "Reuse ID" }), /already used/)
  state = change(state, { type: "task.status", id: "a", status: "doing" })
  assert.deepEqual(assess(state).openRequiredTasks, ["a"])
})

test("edits invalidate matching evidence and stale revisions fail without changing the original", () => {
  const start = fresh()
  const recorded = change(start, { type: "criterion.record", id: "c1", evidence: evidence("Initial result") })
  assert.throws(() => changeGoal(recorded, 0, { type: "criterion.clear", id: "c1" }, 201), /Goal changed/)
  const edited = change(recorded, { type: "criterion.edit", id: "c1", text: "New meaning" })
  assert.equal(edited.criteria[0].evidence, undefined)
  assert.ok(recorded.criteria[0].evidence)
  const objective = change(recorded, { type: "objective.set", text: "Different goal" })
  assert.equal(objective.criteria[0].evidence, undefined)
  const taskDone = change(change(start, { type: "task.add", id: "t", text: "First task" }), { type: "task.status", id: "t", status: "done" })
  assert.deepEqual(assess(change(taskDone, { type: "objective.set", text: "A different objective" })).openRequiredTasks, ["t"])
  assert.equal(change(change(start, { type: "constraint.review", id: "guard", note: "checked" }), { type: "constraint.edit", id: "guard", text: "changed" }).constraints[0].review, undefined)
  const oneLeft = change(start, { type: "criterion.remove", id: "c2" })
  assert.throws(() => change(oneLeft, { type: "criterion.remove", id: "c1" }), /At least one/)
})

test("paused work is not ready and requires explicit resume", () => {
  const paused = change(fresh(), { type: "goal.pause" })
  assert.equal(assess(paused).readyForCompletion, false)
  assert.throws(() => change(paused, { type: "task.add", id: "a", text: "work" }), /Resume/)
  const active = change(paused, { type: "goal.resume" })
  assert.equal(active.status, "active")
  assert.throws(() => change(active, { type: "goal.resume" }), /not paused/)
})

test("invalid contracts and task order are rejected", () => {
  assert.throws(() => createGoal({ id: "x", sessionID: "s", objective: "x", criteria: [], now: 1 }), /At least one/)
  assert.throws(() => createGoal({ id: "x", sessionID: "s", objective: "x", criteria: [{ id: "same", text: "yes" }], constraints: [{ id: "same", text: "no" }], now: 1 }), /unique/)
  const state = change(fresh(), { type: "task.add", id: "task", text: "one" })
  assert.throws(() => change(state, { type: "task.order", ids: [] }), /every current task/)
  assert.throws(() => change(state, { type: "task.remove", id: "task", reason: "" }), /removal reason/)
})
