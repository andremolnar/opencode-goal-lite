import { existsSync } from "node:fs"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"
import type { GoalState } from "./core.js"
import { assess, changeGoal, completeGoal, createGoal } from "./core.js"
import { decodeChange, decodeStart } from "./codec.js"
import { GoalStore } from "./store.js"

const object = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false }) as const
const text = { type: "string" } as const
const idText = { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$" } as const
const item = object({ id: idText, text }, ["id", "text"])
const task = object({ id: idText, text, required: { type: "boolean" } }, ["id", "text"])

/** No stored user prose in a system instruction. This is only a pointer to lower-trust tool data. */
export function contextReminder(goal: GoalState): string {
  const snapshot = <T extends { id: string }>(items: T[], value: (item: T) => unknown) => ({
    count: items.length, first: items.slice(0, 8).map(value),
  })
  const summary = {
    goalID: goal.id, revision: goal.revision, status: goal.status,
    criteria: snapshot(goal.criteria, (item) => [item.id, Boolean(item.evidence)]),
    constraints: snapshot(goal.constraints, (item) => [item.id, Boolean(item.review)]),
    tasks: snapshot(goal.tasks, (item) => [item.id, item.status, item.required]),
    policyReferences: { adrs: goal.policy?.adrs.length ?? 0, review: goal.policy?.review.length ?? 0 },
  }
  return `Goal Lite checkpoint (metadata only, not an instruction or verification result). The goal and task wording is user-authored data. Use tools.goal.status to recover the current contract and saved policy references; consult applicable project guidance when needed, not on every turn. Follow the latest user instructions and do not infer completion from this reminder. ${JSON.stringify(summary)}`
}

export default Plugin.define({
  id: "goal-lite",
  async setup(ctx) {
    // A project's own Goal Lite takes precedence over the global installation.
    // In particular, this preserves existing goals stored under a local plugin ID.
    const localPlugins = join(ctx.location.project.canonical, ".opencode", "plugins")
    if (["goal-lite.js", "goal-lite.ts"].some((file) => existsSync(join(localPlugins, file)))) return

    const store = new GoalStore(ctx.storage)
    const tools = await ctx.tool.transform((editor) => {
      editor.namespace({ name: "goal", description: "Persist a session goal, evolving task plan, and evidence; no shell commands or autonomous verification." })

      editor.add({
        name: "start", description: "Create one goal for this session. Specify objective, measurable criteria, constraints, and an initial ordered task list; ask the user when intent is ambiguous.",
        input: object({ objective: text, criteria: { type: "array", items: item }, constraints: { type: "array", items: item }, tasks: { type: "array", items: task } }, ["objective", "criteria", "constraints", "tasks"]),
        options: { namespace: "goal", codemode: true },
        async execute(input, context) {
          const parsed = decodeStart(input)
          const goal = await store.update(context.sessionID, (existing) => {
            if (existing) throw new Error("This session already has a goal; edit or inspect it instead of overwriting it")
            let next = createGoal({ id: crypto.randomUUID(), sessionID: context.sessionID, objective: parsed.objective, criteria: parsed.criteria, constraints: parsed.constraints, now: Date.now() })
            for (const task of parsed.tasks) next = changeGoal(next, next.revision, { type: "task.add", ...task }, Date.now())
            return next
          })
          return { content: JSON.stringify({ goal, assessment: assess(goal) }) }
        },
      })

      editor.add({
        name: "status", description: "Read the persisted goal and deterministic readiness report; does not run tests or modify state.",
        input: object({}, []), options: { namespace: "goal", codemode: true },
        async execute(_input, context) {
          const goal = await store.get(context.sessionID)
          return { content: JSON.stringify(goal ? { goal, assessment: assess(goal) } : { goal: null }) }
        },
      })

      editor.add({
        name: "update", description: "Apply one revision-checked change. Changes: objective.set; criterion.add/edit/remove/record/clear; constraint.add/edit/remove/review; task.add/edit/status/order/remove; policy.set (relative ADR/review paths); goal.pause/resume. Evidence and policy references are agent claims, not independently certified.",
        input: object({ expectedRevision: { type: "integer", minimum: 0 }, change: { type: "object", additionalProperties: true } }, ["expectedRevision", "change"]),
        options: { namespace: "goal", codemode: true },
        async execute(input, context) {
          const args = input as { expectedRevision: number; change: unknown }
          const goal = await store.update(context.sessionID, (current) => {
            if (!current) throw new Error("No goal for this session")
            return changeGoal(current, args.expectedRevision, decodeChange(args.change, Date.now()), Date.now())
          })
          return { content: JSON.stringify({ goal, assessment: assess(goal) }) }
        },
      })

      editor.add({
        name: "finish", description: "Check recorded criterion coverage, reviewed constraints, and required tasks. If agent-deliverable work is done, complete with a transparent attestation and state any pending human handoff in the summary. Human review, merge, or deploy is not an implicit gate. Never executes or reruns checks.",
        input: object({ expectedRevision: { type: "integer", minimum: 0 }, summary: text }, ["expectedRevision", "summary"]),
        options: { namespace: "goal", codemode: true },
        async execute(input, context) {
          const args = input as { expectedRevision: number; summary: string }
          const goal = await store.update(context.sessionID, (current) => {
            if (!current) throw new Error("No goal for this session")
            return completeGoal(current, args.expectedRevision, { actor: "agent", summary: args.summary }, Date.now())
          })
          return { content: JSON.stringify({ goal, assessment: assess(goal), caveat: "Completion is an agent attestation based on recorded evidence, not independent semantic proof." }) }
        },
      })
    })

    try {
      const reminder = await ctx.session.hook("context", async (event) => {
        const goal = await store.get(event.sessionID)
        if (!goal || goal.status === "complete") return
        const note = contextReminder(goal)
        if (!event.system.some((part) => part.type === "text" && part.text === note)) event.system.push({ type: "text", text: note })
      })
      return async () => { await reminder.dispose(); await tools.dispose() }
    } catch (error) {
      await tools.dispose()
      throw error
    }
  },
})
