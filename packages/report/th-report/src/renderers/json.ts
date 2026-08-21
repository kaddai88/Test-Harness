/**
 * JSON renderer — serializes scan data to a structured JSON string.
 */
import type { DetectionResult } from "@test-harness/th-protocol";
import { summarize, groupByCategory, groupBySeverity } from "../aggregator.js";

export interface JsonRenderInput {
  scanId: string;
  targetUrl: string;
  results: DetectionResult[];
  startedAt: Date;
  completedAt: Date;
}

export interface JsonReportPayload {
  scanId: string;
  targetUrl: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  summary: ReturnType<typeof summarize>;
  byCategory: ReturnType<typeof groupByCategory>;
  bySeverity: ReturnType<typeof groupBySeverity>;
  results: DetectionResult[];
}

export function renderJson(input: JsonRenderInput): string {
  const payload: JsonReportPayload = {
    scanId: input.scanId,
    targetUrl: input.targetUrl,
    startedAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    durationMs:
      input.completedAt.getTime() - input.startedAt.getTime(),
    summary: summarize(input.results),
    byCategory: groupByCategory(input.results),
    bySeverity: groupBySeverity(input.results),
    results: input.results,
  };
  return JSON.stringify(payload, null, 2);
}
