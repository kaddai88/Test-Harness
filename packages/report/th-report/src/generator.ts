/**
 * ReportGenerator — orchestrates rendering of a scan report.
 */
import type { DetectionResult } from "@test-harness/th-protocol";
import { renderMarkdown } from "./renderers/markdown.js";
import { renderJson } from "./renderers/json.js";
import { renderHtml } from "./renderers/html.js";

export interface ReportInput {
  scanId: string;
  targetUrl: string;
  results: DetectionResult[];
  startedAt: Date;
  completedAt: Date;
}

export interface ReportOutput {
  format: string;
  content: string;
  data: Record<string, unknown>;
}

export class ReportGenerator {
  async generate(
    input: ReportInput,
    format: "json" | "markdown" | "html"
  ): Promise<ReportOutput> {
    switch (format) {
      case "json": {
        const content = renderJson(input);
        return {
          format: "json",
          content,
          data: {
            scanId: input.scanId,
            targetUrl: input.targetUrl,
            totalFindings: input.results.reduce(
              (s, r) => s + r.findings.length,
              0
            ),
          },
        };
      }
      case "markdown": {
        const content = renderMarkdown(input);
        return {
          format: "markdown",
          content,
          data: {
            scanId: input.scanId,
            targetUrl: input.targetUrl,
            totalFindings: input.results.reduce(
              (s, r) => s + r.findings.length,
              0
            ),
          },
        };
      }
      case "html": {
        const content = renderHtml(input);
        return {
          format: "html",
          content,
          data: {
            scanId: input.scanId,
            targetUrl: input.targetUrl,
            totalFindings: input.results.reduce(
              (s, r) => s + r.findings.length,
              0
            ),
          },
        };
      }
      default: {
        const _exhaustive: never = format;
        throw new Error(`Unsupported format: ${String(_exhaustive)}`);
      }
    }
  }
}
