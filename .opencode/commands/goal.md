---
description: Start or continue a Goal Lite goal and work on it in this session
subagent: false
---

Start or continue work on this goal in the current session (not just a draft):

$ARGUMENTS

Load and follow the `goal-crafting` skill. Call `tools.goal.status` first. If an active goal already exists and this request is to continue it, work on its next actionable task; do not craft or start a second goal. If it is a different goal, explain that a new session is needed. If no goal exists and an outcome was provided, discover applicable project guidance, show a concise contract, call `tools.goal.start`, save relative policy references with `policy.set`, and **in this same turn begin the first actionable task using ordinary agent tools**. Continue the work and update goal state as progress is observed; do not stop after presenting the contract or recording the goal. If explicitly asked for a draft only, do not start or execute it. Ask one focused question only if ambiguity materially changes scope or safety, and report a real blocker rather than inventing authorization or evidence. If there is no goal and no outcome, ask for the desired outcome. Goal Lite does not run an autonomous background agent or verify its own evidence.
