/** Pure, versioned state model. No OpenCode API, process, filesystem, or network access. */
export type TaskStatus = "todo" | "doing" | "blocked" | "done" | "cancelled"

export interface Evidence {
  kind: "command" | "file" | "review" | "manual"
  reference: string
  summary: string
  recordedAt: number
}

export interface Criterion {
  id: string
  text: string
  evidence?: Evidence
}

export interface Constraint {
  id: string
  text: string
  review?: { note: string; at: number }
}

export interface Task {
  id: string
  text: string
  status: TaskStatus
  required: boolean
  reason?: string
}

export interface GoalState {
  schemaVersion: 1
  id: string
  sessionID: string
  objective: string
  status: "active" | "paused" | "complete"
  revision: number
  updatedAt: number
  criteria: Criterion[]
  constraints: Constraint[]
  tasks: Task[]
  removedTasks: Array<{ id: string; reason: string; removedAt: number }>
  /** Pointers to the active project's guidance, not copied rules or validated policy. */
  policy?: { adrs: string[]; review: string[] }
  completion?: { actor: "agent" | "user"; summary: string; at: number }
}

export type Change =
  | { type: "objective.set"; text: string }
  | { type: "criterion.add"; id: string; text: string }
  | { type: "criterion.edit"; id: string; text: string }
  | { type: "criterion.remove"; id: string }
  | { type: "criterion.record"; id: string; evidence: Evidence }
  | { type: "criterion.clear"; id: string }
  | { type: "constraint.add"; id: string; text: string }
  | { type: "constraint.edit"; id: string; text: string }
  | { type: "constraint.review"; id: string; note: string }
  | { type: "constraint.remove"; id: string }
  | { type: "task.add"; id: string; text: string; required?: boolean }
  | { type: "task.edit"; id: string; text: string }
  | { type: "task.status"; id: string; status: TaskStatus; reason?: string }
  | { type: "task.order"; ids: string[] }
  | { type: "task.remove"; id: string; reason: string }
  | { type: "policy.set"; adrs: string[]; review: string[] }
  | { type: "goal.pause" }
  | { type: "goal.resume" }

function nonempty(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must not be empty`)
  return value.trim()
}

function unique(ids: string[]): void {
  if (new Set(ids).size !== ids.length) throw new Error("IDs must be unique")
}

function timestamp(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid timestamp")
  return now
}

function find<T extends { id: string }>(items: T[], id: string, label: string): T {
  const item = items.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`${label} not found: ${id}`)
  return item
}

export function createGoal(input: {
  id: string
  sessionID: string
  objective: string
  criteria: Array<{ id: string; text: string }>
  constraints?: Array<{ id: string; text: string }>
  now: number
}): GoalState {
  if (!input.criteria?.length) throw new Error("At least one success criterion is required")
  const criteria = input.criteria.map((item) => ({ id: nonempty(item.id, "criterion ID"), text: nonempty(item.text, "criterion") }))
  const constraints = (input.constraints ?? []).map((item) => ({ id: nonempty(item.id, "constraint ID"), text: nonempty(item.text, "constraint") }))
  unique([...criteria.map((item) => item.id), ...constraints.map((item) => item.id)])
  return {
    schemaVersion: 1,
    id: nonempty(input.id, "goal ID"),
    sessionID: nonempty(input.sessionID, "session ID"),
    objective: nonempty(input.objective, "objective"),
    status: "active",
    revision: 0,
    updatedAt: timestamp(input.now),
    criteria,
    constraints,
    tasks: [],
    removedTasks: [],
  }
}

/** Records coverage; never calls the recorded command or certifies the truth of a summary. */
export function assess(goal: GoalState): {
  readyForCompletion: boolean
  missingCriteria: string[]
  openRequiredTasks: string[]
  unreviewedConstraints: string[]
} {
  const missingCriteria = goal.criteria.filter((item) => !item.evidence).map((item) => item.id)
  const openRequiredTasks = goal.tasks.filter((item) => item.required && item.status !== "done").map((item) => item.id)
  const unreviewedConstraints = goal.constraints.filter((item) => !item.review).map((item) => item.id)
  return {
    readyForCompletion: goal.status === "active" && missingCriteria.length === 0 && openRequiredTasks.length === 0 && unreviewedConstraints.length === 0,
    missingCriteria,
    openRequiredTasks,
    unreviewedConstraints,
  }
}

/** A transparent attestation, not an independent semantic proof or approval request. */
export function completeGoal(goal: GoalState, expectedRevision: number, input: { actor: "agent" | "user"; summary: string }, now: number): GoalState {
  if (goal.revision !== expectedRevision) throw new Error("Goal changed; refresh before completing")
  if (!assess(goal).readyForCompletion) throw new Error("Goal is not ready for completion")
  if (input.actor !== "agent" && input.actor !== "user") throw new Error("Invalid completion actor")
  return {
    ...goal,
    status: "complete",
    revision: goal.revision + 1,
    updatedAt: timestamp(now),
    completion: { actor: input.actor, summary: nonempty(input.summary, "completion summary"), at: now },
  }
}

export function changeGoal(goal: GoalState, expectedRevision: number, change: Change, now: number): GoalState {
  if (goal.revision !== expectedRevision) throw new Error("Goal changed; refresh before editing")
  if (goal.status === "complete") throw new Error("Completed goals cannot be changed")
  if (goal.status === "paused" && change.type !== "goal.resume") throw new Error("Resume the goal before editing")
  const next: GoalState = {
    ...goal,
    criteria: goal.criteria.map((item) => ({ ...item, evidence: item.evidence && { ...item.evidence } })),
    constraints: goal.constraints.map((item) => ({ ...item, review: item.review && { ...item.review } })),
    tasks: goal.tasks.map((item) => ({ ...item })),
    removedTasks: goal.removedTasks.map((item) => ({ ...item })),
    policy: goal.policy && { adrs: [...goal.policy.adrs], review: [...goal.policy.review] },
    revision: goal.revision + 1,
    updatedAt: timestamp(now),
  }
  const idInUse = (id: string) => [...next.criteria, ...next.constraints, ...next.tasks, ...next.removedTasks].some((item) => item.id === id)
  switch (change.type) {
    case "objective.set":
      next.objective = nonempty(change.text, "objective")
      next.criteria = next.criteria.map(({ evidence: _evidence, ...item }) => item)
      next.constraints = next.constraints.map(({ review: _review, ...item }) => item)
      next.tasks = next.tasks.map((item) => ({ ...item, status: "todo", reason: undefined }))
      break
    case "criterion.add":
      if (idInUse(change.id)) throw new Error("ID already used")
      next.criteria.push({ id: nonempty(change.id, "criterion ID"), text: nonempty(change.text, "criterion") })
      break
    case "criterion.edit": {
      const item = find(next.criteria, change.id, "Criterion")
      item.text = nonempty(change.text, "criterion")
      delete item.evidence
      break
    }
    case "criterion.remove":
      find(next.criteria, change.id, "Criterion")
      if (next.criteria.length === 1) throw new Error("At least one success criterion is required")
      next.criteria = next.criteria.filter((item) => item.id !== change.id)
      break
    case "criterion.record": {
      const item = find(next.criteria, change.id, "Criterion")
      const evidence = change.evidence
      if (!["command", "file", "review", "manual"].includes(evidence?.kind)) throw new Error("Invalid evidence kind")
      item.evidence = {
        kind: evidence.kind,
        reference: nonempty(evidence.reference, "evidence reference"),
        summary: nonempty(evidence.summary, "evidence summary"),
        recordedAt: timestamp(evidence.recordedAt),
      }
      break
    }
    case "criterion.clear":
      delete find(next.criteria, change.id, "Criterion").evidence
      break
    case "constraint.add":
      if (idInUse(change.id)) throw new Error("ID already used")
      next.constraints.push({ id: nonempty(change.id, "constraint ID"), text: nonempty(change.text, "constraint") })
      break
    case "constraint.edit":
      find(next.constraints, change.id, "Constraint").text = nonempty(change.text, "constraint")
      delete find(next.constraints, change.id, "Constraint").review
      break
    case "constraint.review":
      find(next.constraints, change.id, "Constraint").review = { note: nonempty(change.note, "review note"), at: now }
      break
    case "constraint.remove":
      find(next.constraints, change.id, "Constraint")
      next.constraints = next.constraints.filter((item) => item.id !== change.id)
      break
    case "task.add":
      if (idInUse(change.id)) throw new Error("ID already used")
      next.tasks.push({ id: nonempty(change.id, "task ID"), text: nonempty(change.text, "task"), status: "todo", required: change.required !== false })
      break
    case "task.edit": {
      const task = find(next.tasks, change.id, "Task")
      const text = nonempty(change.text, "task")
      if (text !== task.text) {
        task.status = "todo"
        delete task.reason
      }
      task.text = text
      break
    }
    case "task.status": {
      const task = find(next.tasks, change.id, "Task")
      if (!["todo", "doing", "blocked", "done", "cancelled"].includes(change.status)) throw new Error("Invalid task status")
      if (change.status === "blocked" || change.status === "cancelled") task.reason = nonempty(change.reason ?? "", "status reason")
      else delete task.reason
      task.status = change.status
      break
    }
    case "task.order":
      unique(change.ids)
      if (change.ids.length !== next.tasks.length || change.ids.some((id) => !next.tasks.some((task) => task.id === id))) throw new Error("Task order must include every current task exactly once")
      next.tasks = change.ids.map((id) => find(next.tasks, id, "Task"))
      break
    case "task.remove":
      find(next.tasks, change.id, "Task")
      next.removedTasks.push({ id: change.id, reason: nonempty(change.reason, "removal reason"), removedAt: now })
      next.tasks = next.tasks.filter((item) => item.id !== change.id)
      break
    case "policy.set":
      next.policy = { adrs: [...change.adrs], review: [...change.review] }
      break
    case "goal.pause":
      next.status = "paused"
      break
    case "goal.resume":
      if (goal.status !== "paused") throw new Error("Goal is not paused")
      next.status = "active"
      break
  }
  return next
}
