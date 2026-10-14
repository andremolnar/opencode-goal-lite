# Goal Lite for OpenCode V2

Goal Lite is an **OpenCode V2 plugin** that helps an agent work toward one goal per session. Use `/goal` to start a goal or continue the goal already active in that session. The plugin stores the goal and tracks recorded progress. The agent does the work with its normal tools.

## Install (from source)

You need OpenCode V2, Node.js 24, npm, and Git. Install Goal Lite from a checkout, **not from npm**. Clone the repository, build the plugin, and link these files into your global OpenCode directory:

```sh
git clone https://github.com/andremolnar/opencode-goal-lite.git
cd opencode-goal-lite
npm ci --ignore-scripts
npm run build
mkdir -p "$HOME/.config/opencode/plugins" "$HOME/.config/opencode/skills" "$HOME/.config/opencode/commands"
(
for target in "$HOME/.config/opencode/plugins/goal-lite.js" "$HOME/.config/opencode/skills/goal-crafting" "$HOME/.config/opencode/commands/goal.md"; do
  if [ -e "$target" ] || [ -L "$target" ]; then
    printf 'Already exists: %s\n' "$target" >&2
    exit 1
  fi
done
ln -s "$PWD/dist/plugin.js" "$HOME/.config/opencode/plugins/goal-lite.js"
ln -s "$PWD/.opencode/skills/goal-crafting" "$HOME/.config/opencode/skills/goal-crafting"
ln -s "$PWD/.opencode/commands/goal.md" "$HOME/.config/opencode/commands/goal.md"
)
```

The link step stops if any destination already exists. Check an existing installation before you change it; do not overwrite it. Keep this checkout because the links point to files inside it. Rebuild the plugin in this checkout after you update it. The plugin is not installed or built at startup.

If OpenCode does not find the new files, restart OpenCode. Run `opencode plugin list` to check that `goal-lite` loaded. Then start a new session in a project and try `/goal <desired outcome>`. You need the skill and command links to use `/goal`; the plugin link alone does not add the command.

To uninstall, first verify that the three links point to this checkout. Then remove only those links. OpenCode V2 plugin storage manages goal state; removing the links does not erase it. Do not delete this checkout or its build output while the links are in use.

## What it does

- **Start a goal:** `/goal <desired outcome>` helps the agent record an objective, observable success criteria, constraints, and tasks. The agent begins the first actionable task in the same turn.
- **Continue a goal:** `/goal` continues the active goal in the current session. The agent can change the task list and record evidence as work progresses.
- **Correct a completed goal:** If you identify missing work on that same goal, `/goal <missing work>` can reopen it. Start a different goal in a new session.
- **Keep context:** The plugin stores goal state for the session. After compaction, a short reminder directs the agent to the full state. A readiness report checks the recorded state but does not run tests or verify the evidence.

For example, in an OpenCode session in your own project:

```text
/goal Add input validation to the signup form and tests for invalid submissions
```

## Use

In the session where you want to work, run `/goal <desired outcome>`. The agent checks `tools.goal.status` first. It shows a short goal contract, records the goal, and starts its first actionable task in the same turn.

If the session has an active goal, `/goal` continues its next task instead of creating another goal. You can also ask the agent to check `tools.goal.status` and continue. If the agent only drafts a goal when you wanted it to start, ask it to check `tools.goal.status`, save the goal if none exists, and start the first task. A request for a draft only does not start or execute a goal.

If a completed goal has a gap, describe the missing work in `/goal <the missing work>`. This explicitly reopens **that same goal**. An empty `/goal` does not reopen it. A different goal needs a new session.

Goal tools use session-scoped state. `tools.goal.start`, `tools.goal.status`, `tools.goal.update`, `tools.goal.reopen`, and `tools.goal.finish` use revision-checked updates where they change state. The `policy.set` change can save up to 10 relative ADR paths and 10 relative review-policy paths. These paths are pointers, not copies of the policies or proof of compliance.

To reopen a goal directly, first read `tools.goal.status` in the same session. Then call `tools.goal.reopen({ expectedRevision: <current revision>, reason: "What the user found missing" })`. Reopening keeps the plan and completed tasks. It also keeps the previous completion and reviewer receipt in a bounded history of up to 50 reopenings. It clears recorded criterion evidence and constraint reviews, so the agent must check them again. It retains outstanding findings, and a configured reviewer must give a new pass. Reopening cannot overwrite the goal or use a stale revision. `goal.resume` applies only to paused goals.

The readiness report checks recorded criterion coverage, constraint review notes, and required task status. It does not run tests, commands, models, or reviewers. It does not schedule background work or verify the agent's evidence. Completion is the agent's attestation of work within the agreed scope; human approval, merge, and deployment are separate. Use "ready for human review" only when a PR is open and no **known** P0/P1 (or equivalent blocking) findings remain after applicable checks and review. If PR creation is not authorized, report that the handoff is pending.

The context hook adds only bounded metadata to ordinary agent-loop requests. After compaction, use `tools.goal.status` to recover the full contract and saved policy paths. Read the applicable project guidance again when the scope or guidance changes, not on every turn. Completed goals do not add reminders. Do not store secrets in goals or evidence.

## Optional reviewer gate

By default, the global plugin has **no universal reviewer requirement**. A project-local loader can require one with `createGoalLitePlugin({ requiredReviewer: "reviewer-agent-id" })`. Before `finish`, the agent must complete an OpenCode `subagent` call to that reviewer. The host observes the completed call; an agent-written review note is not a substitute.

The reviewer must end with one line: `GOAL_LITE_REVIEW_JSON: {"verdict":"pass","findings":[]}`. Each finding has a stable `id`, a `summary`, a severity (`P0`, `P1`, `high`, `medium`, or `low`), and a status (`open` or `resolved`). Open high/P0/P1 findings remain across goal edits until the reviewer explicitly reports those IDs as resolved in a later review. Work updates invalidate a passing receipt. A goal change during a review prevents that review from passing. Missing, failed, or malformed reviews block completion.

When a reviewer is configured, `finish` also requires `prHandoff: "open" | "pending" | "not-applicable"`. The `pending` value records PR creation in the completion summary and next steps without blocking completion. The reviewer's findings remain its judgment; the plugin does not verify later code changes or whether a PR exists. Check the final diff, and report an unopened PR as a handoff step when the project requires one.

## Project precedence

OpenCode loads the linked JavaScript file as a global plugin. It also discovers the linked global skill and command. If a project has `.opencode/plugins/goal-lite.js` or `.ts`, the global plugin does not register tools or a context hook there. A project skill or command with the same ID also takes precedence over its global counterpart. Do not remove a project's local loader to activate the global plugin; existing goals may use a different storage ID.

## Develop and limits

Contributors can run the same checks used by CI. The repository also runs staged formatting, type checking, and tests before a commit.

```sh
npm run format:check
npm run check
npm run build
npm test
```

Tests cover transitions, stale revisions, explicit reopening, repeated completion, and concurrent updates within one process. They also cover corruption, simulated compaction and restart, reviewer freshness, and contrasting project policy fixtures. A disposable V2 host smoke test exercised pre-review rejection, foreground subagent receipt capture, and completion with a pending PR handoff. An earlier test exercised manual compaction and restart. Reopening has not been tested on a disposable live V2 host; automatic overflow compaction has not been tested.

OpenCode V2 plugin storage has no documented cross-process compare-and-swap. Concurrent writes to the same session from two server processes are unsupported. A session has one goal; completion can be explicitly reopened, but it cannot be replaced with a different goal in that session.

This is not a fork or restoration of the removed Goal package. It has no V1 entrypoint, autonomous verifier, shell executor, push, merge, or deployment authority.
