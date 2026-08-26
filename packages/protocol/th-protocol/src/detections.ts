/**
 * Detection system types — simplified for AI-driven testing.
 *
 * In DSH-style architecture, detection is not a fixed plugin system.
 * Instead, the AI agent dynamically decides what to test based on
 * user instructions and observations.
 *
 * This file provides minimal types for backward compatibility.
 */

/** Finding severity level */
export type Severity = "critical" | "high" | "medium" | "low" | "info";

/** Confidence level for a finding */
export type Confidence = "certain" | "firm" | "tentative";

/** Evidence supporting a finding */
export interface Evidence {
  type: "http_response" | "dom_element" | "header" | "screenshot" | "certificate";
  data: string;
  context?: string;
}

// Legacy compat types (will be removed after migration)
export type DetectionCategory = "security" | "performance" | "functionality" | "seo" | "accessibility";

export interface DetectionTarget {
  url: string;
  scope: "page" | "site" | "domain";
  pageData?: any;
  domExtract?: any;
}

export interface DetectionContext {
  readonly scanId: string;
  readonly config: Record<string, unknown>;
  readonly abortSignal: AbortSignal;
}

export interface DetectionResult {
  detectionId: string;
  category: DetectionCategory;
  status: "completed" | "failed" | "skipped";
  findings: any[];
  score: number;
  metadata: Record<string, unknown>;
  startedAt: Date;
  completedAt: Date;
  error?: string;
}

export interface DetectionPlugin {
  readonly id: string;
  readonly name: string;
  readonly category: DetectionCategory;
  readonly description: string;
  readonly version: string;
  execute(target: DetectionTarget, context: DetectionContext): Promise<DetectionResult>;
  canExecute(target: DetectionTarget, context: DetectionContext): Promise<boolean>;
}
