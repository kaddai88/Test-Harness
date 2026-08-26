/**
 * Markdown renderer — generates a Markdown report.
 */
import type { Finding } from "@test-harness/th-protocol";
import { summarize, groupBySeverity } from "../aggregator.js";
import type { ReportInput } from "../generator.js";

export function renderMarkdown(input: ReportInput): string {
  const { sessionId, targetUrl, findings, summary, startedAt, completedAt } = input;
  const scanSummary = summarize(findings);

  const durationMs = completedAt.getTime() - startedAt.getTime();
  const durationSec = (durationMs / 1000).toFixed(1);

  const lines: string[] = [];

  // Header
  lines.push(`# Test Report`);
  lines.push("");
  lines.push(`- **Session ID:** ${sessionId}`);
  lines.push(`- **Target:** ${targetUrl}`);
  lines.push(`- **Started:** ${startedAt.toISOString()}`);
  lines.push(`- **Completed:** ${completedAt.toISOString()}`);
  lines.push(`- **Duration:** ${durationSec}s`);
  lines.push("");

  // AI Summary
  if (summary) {
    lines.push("## AI Summary");
    lines.push("");
    lines.push(summary);
    lines.push("");
  }

  // Executive Summary
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(
    `Tested \`${targetUrl}\` and found **${scanSummary.totalFindings} findings**.`
  );
  lines.push("");
  const critical = scanSummary.bySeverity.critical ?? 0;
  const high = scanSummary.bySeverity.high ?? 0;
  if (critical > 0 || high > 0) {
    lines.push(
      `⚠️ **${critical + high} critical or high severity issues** require immediate attention.`
    );
  } else if (scanSummary.totalFindings === 0) {
    lines.push("✅ No issues detected.");
  } else {
    lines.push("No critical or high severity issues were detected.");
  }
  lines.push("");

  // Score Overview
  lines.push("## Score Overview");
  lines.push("");
  lines.push(`**Overall Score: ${scanSummary.overallScore} / 100**`);
  lines.push("");
  lines.push("| Severity | Count |");
  lines.push("|----------|-------|");
  lines.push(`| Critical | ${scanSummary.bySeverity.critical} |`);
  lines.push(`| High     | ${scanSummary.bySeverity.high} |`);
  lines.push(`| Medium   | ${scanSummary.bySeverity.medium} |`);
  lines.push(`| Low      | ${scanSummary.bySeverity.low} |`);
  lines.push(`| Info     | ${scanSummary.bySeverity.info} |`);
  lines.push("");

  // Findings by Severity
  lines.push("## Findings by Severity");
  lines.push("");
  const groups = groupBySeverity(findings);
  if (groups.length === 0) {
    lines.push("No findings.");
    lines.push("");
  } else {
    for (const group of groups) {
      lines.push(`### ${capitalize(group.key)}`);
      lines.push("");
      for (const f of group.findings) {
        const sev = severityEmoji(f.severity);
        lines.push(`- ${sev} **${f.title}**`);
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
  const recommendations = findings
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
    case "critical": return "🔴";
    case "high": return "🟠";
    case "medium": return "🟡";
    case "low": return "🔵";
    default: return "ℹ️";
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
