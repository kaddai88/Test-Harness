/**
 * @test-harness/th-protocol
 *
 * AI-driven test session types — inspired by DSH architecture.
 *
 * Core concept: User describes what to test → AI agent plans →
 * executes browser actions → streams results in real-time.
 */

// ── Test Session ──

export type SessionStatus =
  | "idle"
  | "planning"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

export type TargetScope = "page" | "site" | "domain";

export interface TargetConfig {
  scope: TargetScope;
  auth?: {
    type: "cookie" | "header" | "basic";
    credentials: Record<string, string>;
  };
  headers?: Record<string, string>;
  userAgent?: string;
}

export interface TestSession {
  id: string;
  targetUrl: string;
  targetConfig: TargetConfig;
  instructions: string;        // User's natural language test requirements
  status: SessionStatus;
  plan?: TestPlan;             // AI-generated test plan
  steps: TestStep[];           // Executed steps
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  metadata: Record<string, unknown>;
}

export interface CreateSessionInput {
  targetUrl: string;
  targetConfig?: Partial<TargetConfig>;
  instructions: string;
}

// ── Legacy compat (gradual migration) ──

export interface DOMExtract {
  url: string;
  title: string;
  headings: Array<{ level: number; text: string }>;
  links: Array<{ href: string; text: string; rel: string }>;
  forms: Array<{ action: string; method: string; fields: FormField[] }>;
  images: Array<{ src: string; alt: string }>;
  scripts: Array<{ src?: string; inline: boolean }>;
  meta: Record<string, string>;
}

export interface FormField {
  name: string;
  type: string;
  id?: string;
  required?: boolean;
}

export interface TestPlan {
  summary: string;             // AI's understanding of the task
  steps: PlannedStep[];        // Planned test steps
  createdAt: Date;
}

export interface PlannedStep {
  id: string;
  description: string;         // What this step will do
  action: BrowserAction;       // The browser action to execute
  expected?: string;           // What we expect to see
  priority: number;            // Execution order
}

// ── Test Step (executed) ──

export type StepStatus =
  | "pending"
  | "executing"
  | "completed"
  | "failed"
  | "skipped";

export interface TestStep {
  id: string;
  planStepId?: string;         // Link to planned step
  action: BrowserAction;       // What was executed
  status: StepStatus;
  startedAt?: Date;
  completedAt?: Date;
  result?: ActionResult;       // What happened
  observation?: string;        // AI's observation after action
  decision?: string;           // AI's next decision
  error?: string;
}

// ── Browser Actions ─

export type BrowserAction =
  | { type: "navigate"; url: string }
  | { type: "click"; selector: string }
  | { type: "fill"; selector: string; value: string }
  | { type: "submit"; selector?: string }
  | { type: "assert_visible"; selector: string }
  | { type: "assert_text"; selector: string; text: string }
  | { type: "screenshot"; fullPage?: boolean }
  | { type: "observe"; description?: string }
  | { type: "execute_js"; script: string }
  | { type: "wait"; ms?: number; selector?: string }
  | { type: "go_back" }
  | { type: "go_forward" }
  | { type: "reload" };

// ── Action Results ──

export interface ActionResult {
  success: boolean;
  data?: Record<string, unknown>;
  screenshot?: string;         // base64 image
  url?: string;                // Current URL after action
  title?: string;              // Page title after action
}

// ─ AI Decision Events (for real-time streaming) ──

export type AgentEventType =
  | "plan_created"
  | "step_started"
  | "action_executed"
  | "observation"
  | "decision"
  | "step_completed"
  | "step_failed"
  | "session_completed";

export interface AgentEvent {
  type: AgentEventType;
  sessionId: string;
  stepId?: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

// ── Findings (discovered issues) ──

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface Finding {
  id: string;
  sessionId: string;
  stepId?: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  evidence?: {
    selector?: string;
    screenshot?: string;
    url?: string;
    html?: string;
  };
  recommendation?: string;
  createdAt: Date;
}

// ── Scan Config / Target (used by Agent Loop) ──

export interface LLMConfig {
  provider: string;
  model: string;
  temperature?: number;
}

export interface ScanTarget {
  url: string;
  scope?: TargetScope;
  auth?: TargetConfig["auth"];
  headers?: Record<string, string>;
}

export interface ScanConfig {
  strategy: "sequential" | "parallel" | "adaptive" | string;
  maxTurns?: number;
  timeout?: number;
  instructions?: string;
  llm: LLMConfig;
  detections?: string[];
  crawl?: {
    maxDepth: number;
    maxPages: number;
    respectRobots: boolean;
    rateLimit: number;
  };
}

// ── Legacy compat (gradual migration) ──

export interface Scan {
  id: string;
  targetUrl: string;
  targetConfig: TargetConfig;
  scanConfig: ScanConfig;
  status: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  createdBy?: string;
  metadata: Record<string, unknown>;
}

export interface CreateScanInput {
  targetUrl: string;
  targetConfig?: Partial<TargetConfig>;
  scanConfig?: Record<string, unknown>;
  createdBy?: string;
}
