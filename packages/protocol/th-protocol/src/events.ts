/**
 * Event definitions — typed event channels for the system.
 *
 * Events are either durable (persisted to DB) or live (transient, e.g. WebSocket only).
 */

/** Base event definition */
export interface EventDefinition<T> {
  readonly id: symbol;
  readonly name: string;
  readonly durable: boolean;
}

/** Create a typed event definition */
export function defineEvent<T>(
  name: string,
  options?: { durable?: boolean }
): EventDefinition<T> {
  return {
    id: Symbol(name),
    name,
    durable: options?.durable ?? false,
  };
}

// ── Durable Events (persisted to session log) ──

export interface ScanCreatedEventData {
  scanId: string;
  targetUrl: string;
  config: Record<string, unknown>;
}

export const ScanCreatedEvent = defineEvent<ScanCreatedEventData>(
  "scan:created",
  { durable: true }
);

export interface ScanStatusChangedEventData {
  scanId: string;
  previousStatus: string;
  newStatus: string;
  reason?: string;
}

export const ScanStatusChangedEvent =
  defineEvent<ScanStatusChangedEventData>("scan:status_changed", {
    durable: true,
  });

export interface DetectionStartedEventData {
  scanId: string;
  detectionId: string;
}

export const DetectionStartedEvent =
  defineEvent<DetectionStartedEventData>("detection:started", {
    durable: true,
  });

export interface DetectionCompletedEventData {
  scanId: string;
  detectionId: string;
  result: {
    status: string;
    findingCount: number;
    score: number;
  };
}

export const DetectionCompletedEvent =
  defineEvent<DetectionCompletedEventData>("detection:completed", {
    durable: true,
  });

export interface ScanCompletedEventData {
  scanId: string;
  overallScore: number;
  findingSummary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
}

export const ScanCompletedEvent = defineEvent<ScanCompletedEventData>(
  "scan:completed",
  { durable: true }
);

// ── Live Events (WebSocket / in-memory only) ──

export interface AgentTurnStartedEventData {
  scanId: string;
  turnNumber: number;
}

export const AgentTurnStartedEvent =
  defineEvent<AgentTurnStartedEventData>("agent:turn_started", {
    durable: false,
  });

export interface AgentToolCallEventData {
  scanId: string;
  turnNumber: number;
  toolName: string;
  input: unknown;
}

export const AgentToolCallEvent = defineEvent<AgentToolCallEventData>(
  "agent:tool_call",
  { durable: false }
);

export interface AgentToolResultEventData {
  scanId: string;
  turnNumber: number;
  toolName: string;
  success: boolean;
  duration: number;
}

export const AgentToolResultEvent =
  defineEvent<AgentToolResultEventData>("agent:tool_result", {
    durable: false,
  });

export interface ScanProgressEventData {
  scanId: string;
  phase: string;
  progress: number; // 0–100
  currentStep: string;
}

export const ScanProgressEvent = defineEvent<ScanProgressEventData>(
  "scan:progress",
  { durable: false }
);

// ── Waterfall Events (around-middleware, used by Agent Loop) ──
// These events allow plugins to intercept and modify behavior
// at key points in the agent loop pipeline.

/**
 * agent:pre_step — Fired before each step in the agent loop.
 * Waterfall listeners can modify or reject the messages before
 * they are sent to the LLM.
 *
 * Return { kind: 'reject' } to skip the step entirely.
 * Return { kind: 'enter', messages } to proceed (possibly modified).
 */
export interface AgentPreStepEventData {
  scanId: string;
  turnNumber: number;
  stepNumber: number;
  messages: Array<{ role: string; content: string }>;
  /** Set to 'reject' to skip this step */
  decision: "enter" | "reject";
}

export const AgentPreStepEvent = defineEvent<AgentPreStepEventData>(
  "agent:pre_step",
  { durable: false }
);

/**
 * agent:request — Fired before each LLM request.
 * Waterfall listeners can modify the request configuration
 * (model, temperature, maxTokens, etc.).
 */
export interface AgentRequestEventData {
  scanId: string;
  turnNumber: number;
  stepNumber: number;
  model: string;
  temperature: number;
  maxTokens?: number;
}

export const AgentRequestEvent = defineEvent<AgentRequestEventData>(
  "agent:request",
  { durable: false }
);

/**
 * tools:pre_execute — Fired before each tool execution.
 * Waterfall listeners can modify tool input, deny execution,
 * or request user approval.
 */
export interface ToolsPreExecuteEventData {
  scanId: string;
  toolName: string;
  input: unknown;
  /** Set to 'deny' to block execution, 'approve' to proceed */
  decision: "approve" | "deny" | "ask";
  denyReason?: string;
}

export const ToolsPreExecuteEvent = defineEvent<ToolsPreExecuteEventData>(
  "tools:pre_execute",
  { durable: false }
);

/**
 * tools:post_execute — Fired after each tool execution.
 * Waterfall listeners can modify the result, enrich it,
 * or replace it entirely.
 */
export interface ToolsPostExecuteEventData {
  scanId: string;
  toolName: string;
  success: boolean;
  data?: unknown;
  error?: string;
  duration: number;
  /** Set to true to replace the result */
  replaced: boolean;
}

export const ToolsPostExecuteEvent = defineEvent<ToolsPostExecuteEventData>(
  "tools:post_execute",
  { durable: false }
);

/**
 * agent:turn_stopping — Fired when the agent loop is about to end a turn.
 * Serial listeners can inject additional messages or work to continue the turn.
 */
export interface AgentTurnStoppingEventData {
  scanId: string;
  turnNumber: number;
  /** Set to true to continue the turn instead of ending */
  shouldContinue: boolean;
  reason?: string;
}

export const AgentTurnStoppingEvent = defineEvent<AgentTurnStoppingEventData>(
  "agent:turn_stopping",
  { durable: false }
);

/**
 * agent:stream_chunk — Live streaming chunk from the LLM.
 * Emitted during streaming for real-time terminal display.
 */
export interface AgentStreamChunkEventData {
  scanId: string;
  turnNumber: number;
  /** Partial text content accumulated so far */
  partialContent: string;
  /** Number of tool calls detected so far */
  toolCallCount: number;
  /** Whether the stream is complete */
  done: boolean;
}

export const AgentStreamChunkEvent = defineEvent<AgentStreamChunkEventData>(
  "agent:stream_chunk",
  { durable: false }
);

// ── AI Agent Session Events (real-time streaming) ──

/** Session plan created by AI */
export interface SessionPlanCreatedEventData {
  sessionId: string;
  plan: {
    summary: string;
    steps: Array<{
      id: string;
      description: string;
      action: Record<string, unknown>;
      priority: number;
    }>;
  };
}

export const SessionPlanCreatedEvent = defineEvent<SessionPlanCreatedEventData>(
  "session:plan_created",
  { durable: false }
);

/** Test step started */
export interface TestStepStartedEventData {
  sessionId: string;
  stepId: string;
  action: Record<string, unknown>;
  description: string;
}

export const TestStepStartedEvent = defineEvent<TestStepStartedEventData>(
  "session:step_started",
  { durable: false }
);

/** Browser action executed */
export interface ActionExecutedEventData {
  sessionId: string;
  stepId: string;
  action: Record<string, unknown>;
  result: {
    success: boolean;
    url?: string;
    title?: string;
    screenshot?: string;
  };
}

export const ActionExecutedEvent = defineEvent<ActionExecutedEventData>(
  "session:action_executed",
  { durable: false }
);

/** AI observation after action */
export interface ObservationEventData {
  sessionId: string;
  stepId: string;
  observation: string;
}

export const ObservationEvent = defineEvent<ObservationEventData>(
  "session:observation",
  { durable: false }
);

/** AI decision for next step */
export interface DecisionEventData {
  sessionId: string;
  stepId: string;
  decision: string;
  nextAction?: Record<string, unknown>;
}

export const DecisionEvent = defineEvent<DecisionEventData>(
  "session:decision",
  { durable: false }
);

/** Test step completed */
export interface TestStepCompletedEventData {
  sessionId: string;
  stepId: string;
  status: "completed" | "failed" | "skipped";
  finding?: {
    severity: string;
    title: string;
    description: string;
  };
}

export const TestStepCompletedEvent = defineEvent<TestStepCompletedEventData>(
  "session:step_completed",
  { durable: false }
);

/** Session completed */
export interface SessionCompletedEventData {
  sessionId: string;
  status: "completed" | "failed" | "cancelled";
  summary: string;
  findingCount: number;
  stepCount: number;
}

export const SessionCompletedEvent = defineEvent<SessionCompletedEventData>(
  "session:completed",
  { durable: false }
);
