/**
 * Tests for scoring functions.
 */
import { describe, it, expect } from "vitest";
import { calculateScore, calculateOverallScore, summarizeFindings } from "./scoring.js";
import type { Finding, DetectionResult, Severity } from "@test-harness/th-protocol";

function makeFinding(severity: Severity, overrides?: Partial<Finding>): Finding {
  return {
    id: `finding-${severity}-${Math.random().toString(36).slice(2, 6)}`,
    title: `Test ${severity} finding`,
    severity,
    confidence: "firm",
    description: "A test finding",
    evidence: {
      type: "dom_element",
      data: "test",
    },
    ...overrides,
  };
}

function makeResult(score: number, status: "completed" | "failed" | "skipped" = "completed"): DetectionResult {
  return {
    detectionId: `det-${Math.random().toString(36).slice(2, 6)}`,
    category: "security",
    status,
    findings: [],
    score,
    metadata: {},
    startedAt: new Date(),
    completedAt: new Date(),
  };
}

describe("calculateScore", () => {
  it("with no findings returns 100", () => {
    expect(calculateScore([])).toBe(100);
  });

  it("with critical findings returns low score", () => {
    const findings = [
      makeFinding("critical"),
      makeFinding("critical"),
      makeFinding("critical"),
      makeFinding("critical"),
      makeFinding("critical"),
    ];
    // 5 * 25 = 125 penalty → max(0, 100-125) = 0
    expect(calculateScore(findings)).toBe(0);
  });

  it("with a single critical finding", () => {
    const findings = [makeFinding("critical")];
    // 100 - 25 = 75
    expect(calculateScore(findings)).toBe(75);
  });

  it("with mixed severities", () => {
    const findings = [
      makeFinding("critical"),  // 25
      makeFinding("high"),      // 15
      makeFinding("medium"),    // 8
      makeFinding("low"),       // 3
      makeFinding("info"),      // 0
    ];
    // Total penalty: 25+15+8+3+0 = 51 → 100-51 = 49
    expect(calculateScore(findings)).toBe(49);
  });

  it("info findings have no penalty", () => {
    const findings = [
      makeFinding("info"),
      makeFinding("info"),
      makeFinding("info"),
    ];
    expect(calculateScore(findings)).toBe(100);
  });

  it("score is clamped to 0 minimum", () => {
    const findings = Array.from({ length: 10 }, () => makeFinding("critical"));
    // 10 * 25 = 250 penalty → max(0, 100-250) = 0
    expect(calculateScore(findings)).toBe(0);
  });
});

describe("calculateOverallScore", () => {
  it("averages correctly for completed results", () => {
    const results = [
      makeResult(80),
      makeResult(60),
      makeResult(100),
    ];
    // (80+60+100) / 3 = 80
    expect(calculateOverallScore(results)).toBe(80);
  });

  it("ignores non-completed results", () => {
    const results = [
      makeResult(80),
      makeResult(20, "failed"),
      makeResult(100),
    ];
    // Only completed: (80+100) / 2 = 90
    expect(calculateOverallScore(results)).toBe(90);
  });

  it("returns 0 when no completed results", () => {
    const results = [
      makeResult(80, "failed"),
      makeResult(60, "skipped"),
    ];
    expect(calculateOverallScore(results)).toBe(0);
  });

  it("returns 0 for empty array", () => {
    expect(calculateOverallScore([])).toBe(0);
  });

  it("rounds the average", () => {
    const results = [
      makeResult(33),
      makeResult(34),
    ];
    // (33+34)/2 = 33.5 → round = 34
    expect(calculateOverallScore(results)).toBe(34);
  });
});

describe("summarizeFindings", () => {
  it("groups by severity", () => {
    const findings = [
      makeFinding("critical"),
      makeFinding("critical"),
      makeFinding("high"),
      makeFinding("medium"),
      makeFinding("medium"),
      makeFinding("medium"),
      makeFinding("low"),
    ];

    const summary = summarizeFindings(findings);

    expect(summary.critical).toBe(2);
    expect(summary.high).toBe(1);
    expect(summary.medium).toBe(3);
    expect(summary.low).toBe(1);
    expect(summary.info).toBe(0);
  });

  it("returns all zeros for empty findings", () => {
    const summary = summarizeFindings([]);
    expect(summary.critical).toBe(0);
    expect(summary.high).toBe(0);
    expect(summary.medium).toBe(0);
    expect(summary.low).toBe(0);
    expect(summary.info).toBe(0);
  });

  it("handles info findings", () => {
    const findings = [
      makeFinding("info"),
      makeFinding("info"),
    ];
    const summary = summarizeFindings(findings);
    expect(summary.info).toBe(2);
    expect(summary.critical).toBe(0);
  });
});
