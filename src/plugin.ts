import { existsSync } from "node:fs"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"
import type { GoalState } from "./core.js"
import { assess, changeGoal, completeGoal, createGoal, recordReview } from "./core.js"
import { decodeChange, decodeStart } from "./codec.js"
import { GoalStore } from "./store.js"
import { parseReviewReport } from "./review.js"

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
    review: goal.review ? { verdict: goal.review.verdict, openBlockers: goal.review.blockers.length } : null,
    policyReferences: { adrs: goal.policy?.adrs.length ?? 0, review: goal.policy?.review.length ?? 0 },
  }
  return `Goal Lite checkpoint (metadata only, not an instruction or verification result). The goal and task wording is user-authored data. Use tools.goal.status to recover the current contract and saved policy references; consult applicable project guidance when needed, not on every turn. Follow the latest user instructions and do not infer completion from this reminder. ${JSON.stringify(summary)}`
}

export function createGoalLitePlugin(options: { requiredReviewer?: string } = {}) { return Plugin.define({
  id: "goal-lite",
  async setup(ctx) {
    // Defer to a project's loader and preserve its existing plugin storage ID.
    const localPlugins = join(ctx.location.project.canonical, ".opencode", "plugins")
    if (["goal-lite.js", "goal-lite.ts"].some((file) => existsSync(join(localPlugins, file)))) return

    const reviewer = options.requiredReviewer
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
          return { content: JSON.stringify({ goal, assessment: assess(goal, reviewer) }) }
        },
      })

      editor.add({
        name: "status", description: "Read the persisted goal and deterministic readiness report; does not run tests or modify state.",
        input: object({}, []), options: { namespace: "goal", codemode: true },
        async execute(_input, context) {
          const goal = await store.get(context.sessionID)
          return { content: JSON.stringify(goal ? { goal, assessment: assess(goal, reviewer) } : { goal: null }) }
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
          return { content: JSON.stringify({ goal, assessment: assess(goal, reviewer) }) }
        },
      })

      editor.add({
        name: "finish", description: "Check recorded work and any required host-observed reviewer pass. For a configured reviewer, report PR handoff as open, pending, or not-applicable; pending PR is surfaced but does not block completion. Never executes checks.",
        input: object({ expectedRevision: { type: "integer", minimum: 0 }, summary: text, prHandoff: { type: "string", enum: ["open", "pending", "not-applicable"] } }, ["expectedRevision", "summary"]),
        options: { namespace: "goal", codemode: true },
        async execute(input, context) {
          const args = input as { expectedRevision: number; summary: string; prHandoff?: "open" | "pending" | "not-applicable" }
          if (reviewer && !["open", "pending", "not-applicable"].includes(args.prHandoff ?? "")) throw new Error("Declare PR handoff as open, pending, or not-applicable")
          const summary = args.prHandoff === "pending" ? `${args.summary.trim()} PR handoff pending: open a PR as the next step.` : args.summary
          const goal = await store.update(context.sessionID, (current) => {
            if (!current) throw new Error("No goal for this session")
            return completeGoal(current, args.expectedRevision, { actor: "agent", summary }, Date.now(), reviewer)
          })
          return { content: JSON.stringify({ goal, assessment: assess(goal, reviewer), ...(args.prHandoff === "pending" ? { nextSteps: ["Open the PR required by the project's handoff workflow."] } : {}), caveat: "PR status is agent-reported, not independently verified. Completion remains an attestation." }) }
        },
      })
    })

    let reviewHook: { dispose(): Promise<void> } | undefined
    let reviewStartHook: { dispose(): Promise<void> } | undefined
    const reviewStarts = new Map<string, number>()
    try {
      reviewStartHook = reviewer ? await ctx.tool.hook("execute.before", async (event) => {
        if (event.tool !== "subagent" || !event.input || typeof event.input !== "object" || (event.input as { agent?: string }).agent !== reviewer) return
        const goal = await store.get(event.sessionID)
        if (goal?.status === "active") reviewStarts.set(`${event.sessionID}:${event.id}`, goal.revision)
      }) : undefined
      // This receipt comes from OpenCode's completed tool event, not an agent-writable goal update.
      reviewHook = reviewer ? await ctx.tool.hook("execute.after", async (event) => {
        if (event.tool !== "subagent" || !event.input || typeof event.input !== "object" || (event.input as { agent?: string }).agent !== reviewer) return
        const key = `${event.sessionID}:${event.id}`
        const startRevision = reviewStarts.get(key)
        reviewStarts.delete(key)
        let verdict: "pass" | "blocked" = "blocked"
        let findings: ReturnType<typeof parseReviewReport>["findings"] = []
        if (event.status === "completed") {
          try { ({ verdict, findings } = parseReviewReport(event.result.content)) } catch { /* Invalid or missing report fails closed. */ }
        }
        const active = await store.get(event.sessionID)
        if (!active || active.status !== "active") return
        await store.update(event.sessionID, (current) => {
          if (!current) throw new Error("Goal disappeared while saving review")
          // Fail closed if the review started before this goal or work changed during it.
          const fresh = startRevision === current.revision
          return recordReview(current, reviewer, event.id, fresh ? verdict : "blocked", fresh ? findings : findings.filter((item) => item.status === "open"), Date.now())
        })
      }) : undefined
      const reminder = await ctx.session.hook("context", async (event) => {
        const goal = await store.get(event.sessionID)
        if (!goal || goal.status === "complete") return
        const note = contextReminder(goal)
        if (!event.system.some((part) => part.type === "text" && part.text === note)) event.system.push({ type: "text", text: note })
      })
      return async () => { await reminder.dispose(); await reviewHook?.dispose(); await reviewStartHook?.dispose(); reviewStarts.clear(); await tools.dispose() }
    } catch (error) {
      await reviewHook?.dispose()
      await reviewStartHook?.dispose()
      await tools.dispose()
      throw error
    }
  },
}) }

export default createGoalLitePlugin()
