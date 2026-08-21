/**
 * Aggregator — score aggregation, finding grouping, summary stats.
 */
import type {
  DetectionResult,
  Finding,
  Severity,
  DetectionCategory,
} from "@test-harness/th-protocol";

/** Summary statistics for a scan */
export interface ScanSummary {
  totalFindings: number;
  bySeverity: Record<Severity, number>;
  byCategory: Record<string, number>;
  overallScore: number;
  completedDetections: number;
  failedDetections: number;
  skippedDetections: number;
}

/** Grouped findings bucket */
export interface FindingsGroup {
  category: DetectionCategory | string;
  findings: Finding[];
  score: number;
}

/**
 * Build a full summary from detection results.
 */
export function summarize(results: DetectionResult[]): ScanSummary {
  const allFindings = results.flatMap((r) => r.findings);
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of allFindings) {
    bySeverity[f.severity]++;
  }

  const byCategory: Record<string, number> = {};
  for (const r of results) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + r.findings.length;
  }

  const completed = results.filter((r) => r.status === "completed");
  const failed = results.filter((r) => r.status === "failed");
  const skipped = results.filter((r) => r.status === "skipped");

  const overallScore =
    completed.length > 0
      ? Math.round(completed.reduce((s, r) => s + r.score, 0) / completed.length)
      : 0;

  return {
    totalFindings: allFindings.length,
    bySeverity,
    byCategory,
    overallScore,
    completedDetections: completed.length,
    failedDetections: failed.length,
    skippedDetections: skipped.length,
  };
}

/**
 * Group findings by category.
 */
export function groupByCategory(results: DetectionResult[]): FindingsGroup[] {
  const map = new Map<string, Finding[]>();
  for (const r of results) {
    const bucket = map.get(r.category) ?? [];
    bucket.push(...r.findings);
    map.set(r.category, bucket);
  }
  const groups: FindingsGroup[] = [];
  for (const [category, findings] of map.entries()) {
    const score = computeGroupScore(findings);
    groups.push({ category, findings, score });
  }
  return groups;
}

/**
 * Group findings by severity.
 */
export function groupBySeverity(results: DetectionResult[]): FindingsGroup[] {
  const map = new Map<string, Finding[]>();
  for (const r of results) {
    for (const f of r.findings) {
      const bucket = map.get(f.severity) ?? [];
      bucket.push(f);
      map.set(f.severity, bucket);
    }
  }
  const severityOrder: Severity[] = [
    "critical",
    "high",
    "medium",
    "low",
    "info",
  ];
  return severityOrder
    .filter((s) => map.has(s))
    .map((s) => ({
      category: s as string,
      findings: map.get(s) ?? [],
      score: 0,
    }));
}

/**
 * Compute a 0–100 score for a set of findings using severity weights.
 */
function computeGroupScore(findings: Finding[]): number {
  const weights: Record<Severity, number> = {
    critical: 25,
    high: 15,
    medium: 8,
    low: 3,
    info: 0,
  };
  const penalty = findings.reduce(
    (sum, f) => sum + (weights[f.severity] ?? 0),
    0
  );
  return Math.max(0, 100 - penalty);
}
