/**
 * Scoring algorithm — calculates detection scores based on findings.
 */
import type { Finding, Severity, DetectionResult } from "@test-harness/th-protocol";

/** Severity weights for scoring */
const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 0,
};

/**
 * Calculate a score (0–100) from findings.
 * Starts at 100 and subtracts based on severity weights.
 */
export function calculateScore(findings: Finding[]): number {
  let penalty = 0;
  for (const finding of findings) {
    penalty += SEVERITY_WEIGHTS[finding.severity] ?? 0;
  }
  return Math.max(0, 100 - penalty);
}

/**
 * Calculate overall score from multiple detection results.
 * Uses weighted average by category importance.
 */
export function calculateOverallScore(
  results: DetectionResult[]
): number {
  const completed = results.filter((r) => r.status === "completed");
  if (completed.length === 0) return 0;

  const total = completed.reduce((sum, r) => sum + r.score, 0);
  return Math.round(total / completed.length);
}

/**
 * Summarize findings by severity.
 */
export function summarizeFindings(findings: Finding[]): Record<Severity, number> {
  const summary: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of findings) {
    summary[f.severity]++;
  }
  return summary;
}
