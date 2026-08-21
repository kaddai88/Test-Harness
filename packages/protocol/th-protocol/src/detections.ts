/**
 * Detection system types — the capability seam for detection plugins.
 */
import type { DOMExtract, PageData } from "./models.js";

/** Detection category */
export type DetectionCategory =
  | "security"
  | "performance"
  | "functionality"
  | "seo"
  | "accessibility";

/** Finding severity level */
export type Severity = "critical" | "high" | "medium" | "low" | "info";

/** Confidence level for a finding */
export type Confidence = "certain" | "firm" | "tentative";

/** Evidence supporting a finding */
export interface Evidence {
  type:
    | "http_response"
    | "dom_element"
    | "header"
    | "script"
    | "network"
    | "screenshot"
    | "certificate";
  data: string;
  context?: string;
}

/** A single finding from a detection */
export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  description: string;
  evidence: Evidence;
  recommendation?: string;
  references?: string[];
  url?: string;
  element?: string;
}

/** Target for a detection run */
export interface DetectionTarget {
  url: string;
  scope: "page" | "site" | "domain";
  pageData?: PageData;
  domExtract?: DOMExtract;
}

/** Context passed to a detection plugin during execution */
export interface DetectionContext {
  readonly scanId: string;
  readonly config: Record<string, unknown>;
  readonly abortSignal: AbortSignal;
}

/** Result from a single detection execution */
export interface DetectionResult {
  detectionId: string;
  category: DetectionCategory;
  status: "completed" | "failed" | "skipped";
  findings: Finding[];
  score: number; // 0–100
  metadata: Record<string, unknown>;
  startedAt: Date;
  completedAt: Date;
  error?: string;
}

/**
 * The DetectionPlugin interface — every detection module implements this.
 * This is the Service Definition side of the detection capability seam.
 */
export interface DetectionPlugin {
  readonly id: string;
  readonly name: string;
  readonly category: DetectionCategory;
  readonly description: string;
  readonly version: string;

  /** Execute the detection against a target */
  execute(
    target: DetectionTarget,
    context: DetectionContext
  ): Promise<DetectionResult>;

  /** Check whether this detection can run against the given target */
  canExecute(
    target: DetectionTarget,
    context: DetectionContext
  ): Promise<boolean>;
}
