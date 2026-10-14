---
name: asd-ste100
description: Write agent and user-facing prose with an ASD-STE100-inspired controlled-English profile. Use before producing or revising summaries, plans, instructions, handoffs, tool descriptions, status reports, prompts, or documentation where clarity and information fidelity matter.
license: MIT
compatibility: Tool-agnostic. The official ASD-STE100 dictionary is required for formal compliance checks.
metadata:
  standard: ASD-STE100 Issue 9 (2025-01-15)
  adapted_from: https://github.com/danyuchn/asd-ste100-skill
  adaptation: Coach agent communication and lossless handoffs
---

# ASD-STE100 for Coach Agent Communication

Use controlled English to reduce ambiguity. Do not use it to remove information.

This skill adapts the structure and intent of ASD-STE100 Simplified Technical
English for Coach. It applies an ASD-STE100-inspired writing profile. It does
not claim formal ASD-STE100 compliance. Formal compliance requires the official
dictionary and a qualified review.

## Scope

Apply this skill before writing new prose for:

- Andre-facing replies, plans, summaries, questions, and reports;
- agent handoffs, subagent results, tool descriptions, and status reports;
- repository prose, including documentation, changelog entries, ADRs, and
  commit messages.

Do not rewrite or normalize exact text that must remain exact. This includes:

- direct quotations and source excerpts;
- code, commands, identifiers, paths, tool names, schemas, and error strings;
- dates, times, numbers, units, record IDs, URLs, and formal wording;
- a user's stated wording when its wording is material to the task.

## Fidelity Rules

1. Read the source for meaning before drafting.
2. Preserve every fact, condition, exception, uncertainty, constraint, and
   source attribution.
3. Do not infer a missing fact to make a sentence shorter or smoother.
4. Do not replace a precise term with a simpler term when the replacement
   changes scope or technical meaning.
5. Keep the source text available when a downstream agent must verify the
   summary. Label a summary as a summary.
6. When compression would remove material information, use a list or a longer
   sentence. State the trade-off instead of silently deleting the information.
7. Separate observed facts, assumptions, recommendations, and open questions.

## Controlled-English Profile

1. Use a stable name for each important concept. Do not rotate synonyms.
2. Use active voice when the actor is known and material.
3. Use simple, complete sentences. Keep subjects, verbs, articles, and
   conditions explicit.
4. State the condition before the command or consequence.
5. Use one instruction or main claim per sentence.
6. Keep procedural sentences at 20 words or fewer when possible. Keep
   descriptive sentences at 25 words or fewer when possible.
7. Use a vertical list for three or more steps, conditions, facts, or options.
8. Avoid idiom, metaphor, vague intensifiers, filler, and unexplained jargon.
9. Use a technical term when it is necessary. Define it once if the reader can
   reasonably misunderstand it.
10. State uncertainty directly. Use calibrated wording such as `known`,
    `reported`, `likely`, or `unknown` only when it matches the evidence.

## Procedure

1. Identify the audience and whether the text is procedural, descriptive, or a
   handoff.
2. Extract the facts, conditions, decisions, and exact terms that must survive.
3. Draft with the controlled-English profile.
4. Compare the draft with the extracted content. Restore anything that is
   missing, weakened, or broadened.
5. Run a final check:
   - Does each sentence have a clear actor and action?
   - Does every condition remain present?
   - Does each important concept use one stable name?
   - Are facts, assumptions, and recommendations distinct?
   - Did exact strings remain unchanged?

## Output

Return only the requested result unless the user asks for a compliance review.
When a material ambiguity remains, state it plainly and ask one focused
question, or preserve the ambiguity with a clear label.

## Boundaries

- Do not describe output as formally ASD-STE100 compliant unless it was checked
  against the official dictionary and rules.
- Do not force sentence limits when doing so loses a material qualification.
- Do not use controlled English to expose private reasoning. Give a concise,
  verifiable rationale when a rationale is useful.

## References

- `references/sources.md` — source standard, adaptation source, and scope.
