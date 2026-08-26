/**
 * ReportGenerator — orchestrates rendering of a test session report.
 */
import type { Finding } from "@test-harness/th-protocol";
import { renderMarkdown } from "./renderers/markdown.js";
import { renderJson } from "./renderers/json.js";
import { renderHtml } from "./renderers/html.js";

export interface ReportInput {
  sessionId: string;
  targetUrl: string;
  findings: Finding[];
  summary?: string;
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
            sessionId: input.sessionId,
            targetUrl: input.targetUrl,
            totalFindings: input.findings.length,
          },
        };
      }
      case "markdown": {
        const content = renderMarkdown(input);
        return {
          format: "markdown",
          content,
          data: {
            sessionId: input.sessionId,
            targetUrl: input.targetUrl,
            totalFindings: input.findings.length,
          },
        };
      }
      case "html": {
        const content = renderHtml(input);
        return {
          format: "html",
          content,
          data: {
            sessionId: input.sessionId,
            targetUrl: input.targetUrl,
            totalFindings: input.findings.length,
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
