/**
 * HTML renderer — generates a self-contained HTML report with inline CSS.
 */
import type { DetectionResult, Severity } from "@test-harness/th-protocol";
import { summarize, groupByCategory } from "../aggregator.js";

export interface HtmlRenderInput {
  scanId: string;
  targetUrl: string;
  results: DetectionResult[];
  startedAt: Date;
  completedAt: Date;
}

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "#b91c1c",
  high: "#ea580c",
  medium: "#ca8a04",
  low: "#2563eb",
  info: "#6b7280",
};

export function renderHtml(input: HtmlRenderInput): string {
  const { scanId, targetUrl, results, startedAt, completedAt } = input;
  const summary = summarize(input.results);
  const groups = groupByCategory(results);
  const durationMs = completedAt.getTime() - startedAt.getTime();
  const durationSec = (durationMs / 1000).toFixed(1);

  const scoreColor =
    summary.overallScore >= 80
      ? "#16a34a"
      : summary.overallScore >= 50
        ? "#ca8a04"
        : "#b91c1c";

  const escape = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const severityRows = (["critical", "high", "medium", "low", "info"] as Severity[])
    .map(
      (sev) => `
      <tr>
        <td><span class="badge" style="background:${SEVERITY_COLORS[sev]}">${sev}</span></td>
        <td>${summary.bySeverity[sev]}</td>
      </tr>`
    )
    .join("\n");

  const groupsHtml =
    groups.length === 0
      ? "<p>No findings to report.</p>"
      : groups
          .map(
            (g) => `
        <section class="group">
          <h3>${escape(capitalize(g.category))} <span class="muted">· score ${g.score}/100 · ${g.findings.length} finding${g.findings.length === 1 ? "" : "s"}</span></h3>
          <ul>
            ${g.findings
              .map(
                (f) => `
              <li class="finding ${f.severity}">
                <strong>${escape(f.title)}</strong>
                <span class="badge" style="background:${SEVERITY_COLORS[f.severity]}">${f.severity}</span>
                <p>${escape(f.description)}</p>
                ${f.recommendation ? `<p class="rec"><strong>Recommendation:</strong> ${escape(f.recommendation)}</p>` : ""}
              </li>`
              )
              .join("")}
          </ul>
        </section>`
          )
          .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Scan Report — ${escape(scanId)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #111; line-height: 1.5; }
  h1 { border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
  h2 { margin-top: 2rem; color: #1f2937; }
  .meta { color: #6b7280; font-size: 0.95rem; }
  .meta span { margin-right: 1.5rem; }
  .score-box { display: inline-block; padding: 0.5rem 1rem; border-radius: 8px; color: white; font-size: 1.5rem; font-weight: bold; background: ${scoreColor}; }
  table { border-collapse: collapse; margin: 1rem 0; }
  th, td { border: 1px solid #e5e7eb; padding: 0.4rem 0.8rem; text-align: left; }
  th { background: #f9fafb; }
  .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 4px; color: white; font-size: 0.75rem; text-transform: uppercase; font-weight: 600; }
  .group { background: #f9fafb; border-left: 4px solid #3b82f6; padding: 1rem; margin: 1rem 0; border-radius: 4px; }
  .group h3 { margin-top: 0; }
  .muted { color: #6b7280; font-weight: normal; font-size: 0.9rem; }
  ul { padding-left: 1.5rem; }
  .finding { background: white; border-radius: 4px; padding: 0.75rem; margin: 0.5rem 0; border-left: 3px solid #d1d5db; }
  .finding.critical { border-left-color: ${SEVERITY_COLORS.critical}; }
  .finding.high { border-left-color: ${SEVERITY_COLORS.high}; }
  .finding.medium { border-left-color: ${SEVERITY_COLORS.medium}; }
  .finding.low { border-left-color: ${SEVERITY_COLORS.low}; }
  .finding p { margin: 0.25rem 0; }
  .rec { color: #1e40af; }
</style>
</head>
<body>
  <h1>Scan Report</h1>
  <div class="meta">
    <span><strong>Scan ID:</strong> ${escape(scanId)}</span><br>
    <span><strong>Target:</strong> ${escape(targetUrl)}</span><br>
    <span><strong>Started:</strong> ${startedAt.toISOString()}</span><br>
    <span><strong>Completed:</strong> ${completedAt.toISOString()}</span><br>
    <span><strong>Duration:</strong> ${durationSec}s</span>
  </div>

  <h2>Score Overview</h2>
  <div class="score-box">${summary.overallScore} / 100</div>
  <table>
    <thead><tr><th>Severity</th><th>Count</th></tr></thead>
    <tbody>${severityRows}</tbody>
  </table>

  <h2>Findings by Category</h2>
  ${groupsHtml}
</body>
</html>`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
