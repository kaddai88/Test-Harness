/**
 * Markdown renderer — generates a Markdown report.
 *
 * Sections:
 * - Executive Summary
 * - Score Overview
 * - Findings by Category
 * - Recommendations
 */
import type { DetectionResult } from "@test-harness/th-protocol";
import { summarize, groupByCategory } from "../aggregator.js";

export interface MarkdownRenderInput {
  scanId: string;
  targetUrl: string;
  results: DetectionResult[];
  startedAt: Date;
  completedAt: Date;
}

export function renderMarkdown(input: MarkdownRenderInput): string {
  const { scanId, targetUrl, results, startedAt, completedAt } = input;
  const summary = summarize(results);
  const groups = groupByCategory(results);

  const durationMs = completedAt.getTime() - startedAt.getTime();
  const durationSec = (durationMs / 1000).toFixed(1);

  const lines: string[] = [];

  // Header
  lines.push(`# Scan Report`);
  lines.push("");
  lines.push(`- **Scan ID:** ${scanId}`);
  lines.push(`- **Target:** ${targetUrl}`);
  lines.push(`- **Started:** ${startedAt.toISOString()}`);
  lines.push(`- **Completed:** ${completedAt.toISOString()}`);
  lines.push(`- **Duration:** ${durationSec}s`);
  lines.push("");

  // Executive Summary
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(
    `Scanned \`${targetUrl}\` and found **${summary.totalFindings} findings** across ${summary.completedDetections} detection modules.`
  );
  lines.push("");
  const critical = summary.bySeverity.critical ?? 0;
  const high = summary.bySeverity.high ?? 0;
  if (critical > 0 || high > 0) {
    lines.push(
      `⚠️ **${critical + high} critical or high severity issues** require immediate attention.`
    );
  } else if (summary.totalFindings === 0) {
    lines.push("✅ No issues detected.");
  } else {
    lines.push("No critical or high severity issues were detected.");
  }
  lines.push("");

  // Score Overview
  lines.push("## Score Overview");
  lines.push("");
  lines.push(`**Overall Score: ${summary.overallScore} / 100**`);
  lines.push("");
  lines.push("| Severity | Count |");
  lines.push("|----------|-------|");
  lines.push(`| Critical | ${summary.bySeverity.critical} |`);
  lines.push(`| High     | ${summary.bySeverity.high} |`);
  lines.push(`| Medium   | ${summary.bySeverity.medium} |`);
  lines.push(`| Low      | ${summary.bySeverity.low} |`);
  lines.push(`| Info     | ${summary.bySeverity.info} |`);
  lines.push("");

  // Findings by Category
  lines.push("## Findings by Category");
  lines.push("");
  if (groups.length === 0) {
    lines.push("No findings.");
    lines.push("");
  } else {
    for (const group of groups) {
      lines.push(`### ${capitalize(group.category)}`);
      lines.push("");
      lines.push(`Score: **${group.score} / 100** · ${group.findings.length} findings`);
      lines.push("");
      for (const f of group.findings) {
        const sev = severityEmoji(f.severity);
        lines.push(
          `- ${sev} **${f.title}** _[${f.severity}]_`
        );
        if (f.description) {
          lines.push(`  ${f.description}`);
          lines.push("");
        }
        if (f.recommendation) {
          lines.push(`  > **Recommendation:** ${f.recommendation}`);
          lines.push("");
        }
      }
    }
  }

  // Recommendations
  lines.push("## Recommendations");
  lines.push("");
  const allFindings = results.flatMap((r) => r.findings);
  const recommendations = allFindings
    .filter((f) => f.recommendation)
    .map((f) => f.recommendation);
  const uniqueRecs = [...new Set(recommendations)];

  if (uniqueRecs.length === 0) {
    lines.push("No specific recommendations — the target looks healthy.");
  } else {
    for (const [idx, rec] of uniqueRecs.entries()) {
      lines.push(`${idx + 1}. ${rec}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

function severityEmoji(sev: string): string {
  switch (sev) {
    case "critical":
      return "🔴";
    case "high":
      return "🟠";
    case "medium":
      return "🟡";
    case "low":
      return "🔵";
    default:
      return "ℹ️";
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
