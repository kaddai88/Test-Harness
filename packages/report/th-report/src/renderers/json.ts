/**
 * JSON renderer — serializes test session data to a structured JSON string.
 */
import type { Finding } from "@test-harness/th-protocol";
import { summarize, groupBySeverity } from "../aggregator.js";
import type { ReportInput } from "../generator.js";

export interface JsonReportPayload {
  sessionId: string;
  targetUrl: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  summary: ReturnType<typeof summarize>;
  bySeverity: ReturnType<typeof groupBySeverity>;
  findings: Finding[];
  aiSummary?: string;
}

export function renderJson(input: ReportInput): string {
  const payload: JsonReportPayload = {
    sessionId: input.sessionId,
    targetUrl: input.targetUrl,
    startedAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    durationMs: input.completedAt.getTime() - input.startedAt.getTime(),
    summary: summarize(input.findings),
    bySeverity: groupBySeverity(input.findings),
    findings: input.findings,
    aiSummary: input.summary,
  };
  return JSON.stringify(payload, null, 2);
}
