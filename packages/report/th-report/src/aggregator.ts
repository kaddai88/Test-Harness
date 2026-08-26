/**
 * Aggregator — score aggregation, finding grouping, summary stats.
 */
import type {
  Finding,
  FindingSeverity,
} from "@test-harness/th-protocol";

/** Summary statistics for a scan */
export interface SessionSummary {
  totalFindings: number;
  bySeverity: Record<FindingSeverity, number>;
  overallScore: number;
  completedSteps: number;
  failedSteps: number;
}

/** Grouped findings bucket */
export interface FindingsGroup {
  key: string;
  findings: Finding[];
  count: number;
}

/**
 * Build a full summary from findings.
 */
export function summarize(findings: Finding[]): SessionSummary {
  const bySeverity: Record<FindingSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of findings) {
    bySeverity[f.severity]++;
  }

  return {
    totalFindings: findings.length,
    bySeverity,
    overallScore: calculateScore(findings),
    completedSteps: 0,
    failedSteps: 0,
  };
}

/**
 * Calculate overall score from findings.
 * Lower severity findings = higher score.
 */
export function calculateScore(findings: Finding[]): number {
  let penalty = 0;
  for (const f of findings) {
    switch (f.severity) {
      case "critical": penalty += 25; break;
      case "high": penalty += 15; break;
      case "medium": penalty += 8; break;
      case "low": penalty += 3; break;
      case "info": penalty += 0; break;
    }
  }
  return Math.max(0, 100 - penalty);
}

/**
 * Group findings by severity.
 */
export function groupBySeverity(findings: Finding[]): FindingsGroup[] {
  const groups: Record<string, Finding[]> = {};
  for (const f of findings) {
    if (!groups[f.severity]) groups[f.severity] = [];
    groups[f.severity]!.push(f);
  }
  return Object.entries(groups).map(([key, findings]) => ({
    key,
    findings: findings!,
    count: findings!.length,
  }));
}
