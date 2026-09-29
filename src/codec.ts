import type { Change, GoalState, TaskStatus } from "./core.js"

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/
const textLimit = 2000
const evidenceLimit = 1000
const statuses = ["todo", "doing", "blocked", "done", "cancelled"]
const kinds = ["command", "file", "review", "manual"]

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function string(value: unknown, label: string, limit = textLimit): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`${label} must be nonempty and at most ${limit} characters`)
  return value.trim()
}

function id(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) throw new Error("ID must be 1–64 alphanumeric, dot, underscore, or hyphen characters")
  return value
}

function time(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("Invalid timestamp")
  return value as number
}

function items(value: unknown, label: string, limit: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`${label} must be an array with at most ${limit} entries`)
  return value.map((entry) => object(entry, label))
}

function references(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 10) throw new Error(`${label} must have at most 10 paths`)
  const result = value.map((entry) => {
    const path = string(entry, label, 240)
    if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || /[\\\u0000-\u001f\u007f]/.test(path) || path.split("/").some((part) => !part || part === ".." || part === ".")) {
      throw new Error(`${label} must contain relative project paths without traversal`)
    }
    return path
  })
  if (new Set(result).size !== result.length) throw new Error(`${label} paths must be unique`)
  return result
}

export function decodeStart(value: unknown): {
  objective: string
  criteria: Array<{ id: string; text: string }>
  constraints: Array<{ id: string; text: string }>
  tasks: Array<{ id: string; text: string; required: boolean }>
} {
  const input = object(value, "Goal")
  const criteria = items(input.criteria, "Criteria", 30).map((item) => ({ id: id(item.id), text: string(item.text, "Criterion") }))
  if (criteria.length === 0) throw new Error("At least one success criterion is required")
  const constraints = items(input.constraints ?? [], "Constraints", 30).map((item) => ({ id: id(item.id), text: string(item.text, "Constraint") }))
  const tasks = items(input.tasks ?? [], "Tasks", 100).map((item) => {
    if (item.required !== undefined && typeof item.required !== "boolean") throw new Error("Task required must be a boolean")
    return { id: id(item.id), text: string(item.text, "Task"), required: item.required !== false }
  })
  const ids = [...criteria, ...constraints, ...tasks].map((item) => item.id)
  if (new Set(ids).size !== ids.length) throw new Error("IDs must be unique")
  return { objective: string(input.objective, "Objective"), criteria, constraints, tasks }
}

export function decodeChange(value: unknown, now: number): Change {
  const input = object(value, "Change")
  const name = string(input.type, "Change type", 32)
  switch (name) {
    case "objective.set": return { type: name, text: string(input.text, "Objective") }
    case "criterion.add": case "criterion.edit":
    case "constraint.add": case "constraint.edit":
    case "task.add": case "task.edit":
      if (name === "task.add") {
        if (input.required !== undefined && typeof input.required !== "boolean") throw new Error("Task required must be a boolean")
        return { type: name, id: id(input.id), text: string(input.text, "Task"), required: input.required as boolean | undefined }
      }
      return { type: name, id: id(input.id), text: string(input.text, "Text") }
    case "criterion.remove": case "criterion.clear": case "constraint.remove":
      return { type: name, id: id(input.id) }
    case "criterion.record": {
      const evidence = object(input.evidence, "Evidence")
      if (!kinds.includes(evidence.kind as string)) throw new Error("Invalid evidence kind")
      return { type: name, id: id(input.id), evidence: {
        kind: evidence.kind as "command" | "file" | "review" | "manual",
        reference: string(evidence.reference, "Evidence reference", evidenceLimit),
        summary: string(evidence.summary, "Evidence summary", evidenceLimit), recordedAt: time(now),
      } }
    }
    case "constraint.review": return { type: name, id: id(input.id), note: string(input.note, "Review note", evidenceLimit) }
    case "task.status":
      if (!statuses.includes(input.status as string)) throw new Error("Invalid task status")
      return { type: name, id: id(input.id), status: input.status as TaskStatus, reason: input.reason === undefined ? undefined : string(input.reason, "Reason") }
    case "task.order":
      if (!Array.isArray(input.ids) || input.ids.length > 100) throw new Error("Task IDs must be an array")
      return { type: name, ids: input.ids.map(id) }
    case "task.remove": return { type: name, id: id(input.id), reason: string(input.reason, "Removal reason") }
    case "policy.set": return { type: name, adrs: references(input.adrs, "ADR references"), review: references(input.review, "Review references") }
    case "goal.pause": case "goal.resume": return { type: name }
    default: throw new Error(`Unsupported change type: ${name}`)
  }
}

/** Reject corrupt, future-version, or overlarge persisted data instead of silently resetting a goal. */
export function decodeState(value: unknown, sessionID: string): GoalState {
  const state = object(value, "Stored goal")
  if (state.schemaVersion !== 1 || state.sessionID !== sessionID) throw new Error("Incompatible or mismatched stored goal")
  const initial = decodeStart(state)
  const criteria = items(state.criteria, "Criteria", 30).map((item) => {
    const evidence = item.evidence === undefined ? undefined : object(item.evidence, "Evidence")
    if (evidence && !kinds.includes(evidence.kind as string)) throw new Error("Invalid stored evidence kind")
    return { id: id(item.id), text: string(item.text, "Criterion"), ...(evidence ? { evidence: {
      kind: evidence.kind as "command" | "file" | "review" | "manual", reference: string(evidence.reference, "Evidence reference", evidenceLimit),
      summary: string(evidence.summary, "Evidence summary", evidenceLimit), recordedAt: time(evidence.recordedAt),
    } } : {}) }
  })
  const constraints = items(state.constraints, "Constraints", 30).map((item) => {
    const review = item.review === undefined ? undefined : object(item.review, "Constraint review")
    return { id: id(item.id), text: string(item.text, "Constraint"), ...(review ? { review: { note: string(review.note, "Review note", evidenceLimit), at: time(review.at) } } : {}) }
  })
  const tasks = items(state.tasks, "Tasks", 100).map((item) => {
    if (!statuses.includes(item.status as string) || typeof item.required !== "boolean") throw new Error("Invalid stored task")
    return { id: id(item.id), text: string(item.text, "Task"), status: item.status as GoalState["tasks"][number]["status"], required: item.required,
      ...(item.reason !== undefined ? { reason: string(item.reason, "Reason") } : {}) }
  })
  const removedTasks = items(state.removedTasks, "Removed tasks", 1000).map((item) => ({ id: id(item.id), reason: string(item.reason, "Removal reason"), removedAt: time(item.removedAt) }))
  const policy = state.policy === undefined ? undefined : object(state.policy, "Policy references")
  const all = [...criteria, ...constraints, ...tasks, ...removedTasks].map((item) => item.id)
  if (new Set(all).size !== all.length) throw new Error("Duplicate stored ID")
  if (!["active", "paused", "complete"].includes(state.status as string)) throw new Error("Invalid goal status")
  const completion = state.completion === undefined ? undefined : object(state.completion, "Completion")
  if (completion && !["user", "agent"].includes(completion.actor as string)) throw new Error("Invalid completion actor")
  if ((state.status === "complete") !== Boolean(completion)) throw new Error("Completion/status mismatch")
  return {
    schemaVersion: 1, id: id(state.id), sessionID, objective: initial.objective,
    status: state.status as GoalState["status"], revision: time(state.revision), updatedAt: time(state.updatedAt),
    criteria, constraints, tasks, removedTasks,
    ...(policy ? { policy: { adrs: references(policy.adrs, "ADR references"), review: references(policy.review, "Review references") } } : {}),
    ...(completion ? { completion: { actor: completion.actor as "agent" | "user", summary: string(completion.summary, "Completion summary", evidenceLimit), at: time(completion.at) } } : {}),
  }
}
