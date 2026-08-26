/**
 * Built-in tool: report_finding — report a discovered issue during testing.
 *
 * The AI agent calls this when it observes a real problem (bug, usability
 * issue, security weakness, broken flow). Findings are collected into the
 * provided collector array and later persisted to the test session.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { Finding } from "@test-harness/th-protocol";

const inputSchema = z.object({
  severity: z
    .enum(["critical", "high", "medium", "low", "info"])
    .describe("Severity of the issue"),
  title: z.string().describe("Short, descriptive title of the finding"),
  description: z
    .string()
    .describe("Detailed description of the issue and what you observed"),
  recommendation: z
    .string()
    .optional()
    .describe("Suggested fix or mitigation (optional)"),
  evidenceUrl: z.string().optional().describe("URL where the issue was found"),
  evidenceSelector: z.string().optional().describe("CSS selector of the evidence element"),
});

export function createReportFindingTool(
  collector: Finding[],
  sessionId: string
): Tool {
  return {
    id: "report_finding",
    name: "Report Finding",
    description:
      "Report a discovered issue during testing. Use this to record bugs, usability problems, security weaknesses, or broken flows with a severity, title, and description.",
    category: "utility",
    inputSchema,
    outputSchema: z.object({
      recorded: z.boolean(),
      findingId: z.string(),
    }),
    timeoutMs: 5_000,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { severity, title, description, recommendation, evidenceUrl, evidenceSelector } =
        inputSchema.parse(input);

      const finding: Finding = {
        id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        severity,
        title,
        description,
        recommendation,
        evidence: {
          url: evidenceUrl,
          selector: evidenceSelector,
        },
        createdAt: new Date(),
      };

      collector.push(finding);

      return {
        success: true,
        data: { recorded: true, findingId: finding.id },
        duration: 0,
      };
    },
  };
}
