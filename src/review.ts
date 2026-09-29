/** A deliberately narrow contract for the *reviewer's* completed tool output. */
export interface ReviewReport {
  verdict: "pass" | "blocked"
  findings: Array<{ id: string; summary: string; severity: string; status: "open" | "resolved" }>
}

export function parseReviewReport(content: unknown): ReviewReport {
  const text = typeof content === "string" ? content : Array.isArray(content)
    ? content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n") : ""
  const matches = [...text.matchAll(/^GOAL_LITE_REVIEW_JSON: (\{[^\n]+\})$/gm)]
  if (matches.length !== 1) throw new Error("Reviewer must provide exactly one GOAL_LITE_REVIEW_JSON line")
  let value: unknown
  try { value = JSON.parse(matches[0]?.[1] ?? "") } catch { throw new Error("Reviewer report is not valid JSON") }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid reviewer report")
  const report = value as Record<string, unknown>
  if (!(["pass", "blocked"].includes(report.verdict as string)) || !Array.isArray(report.findings) || report.findings.length > 100) throw new Error("Invalid reviewer verdict or findings")
  const findings = report.findings.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid reviewer finding")
    const item = entry as Record<string, unknown>
    if (typeof item.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$/.test(item.id)
      || typeof item.summary !== "string" || !item.summary.trim() || item.summary.length > 500
      || !["P0", "P1", "high", "medium", "low"].includes(item.severity as string)
      || !["open", "resolved"].includes(item.status as string)) throw new Error("Invalid reviewer finding")
    return { id: item.id, summary: item.summary, severity: item.severity, status: item.status } as ReviewReport["findings"][number]
  })
  if (new Set(findings.map((item) => item.id)).size !== findings.length) throw new Error("Duplicate reviewer finding")
  return { verdict: report.verdict as ReviewReport["verdict"], findings }
}
