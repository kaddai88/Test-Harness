/**
 * Session Log — append-only event log for the agent loop.
 *
 * Inspired by DSH's session log architecture:
 * - The log is the single source of truth for all model-visible content
 * - Message history is DERIVED from the log via `deriveMessages()`
 * - Every event gets a monotonically increasing sequence number
 * - The log supports filtering, iteration, and replay
 *
 * Key invariant: "Model-visible ⟺ logged"
 * Anything that reaches a model request must be reconstructable from the log.
 */
import type { Message, ToolCall } from "@test-harness/th-protocol";

// ── Session Event Types ──

export type SessionEventType =
  // Turn lifecycle
  | "turn/start"
  | "turn/end"
  // Step lifecycle
  | "step/start"
  | "step/end"
  // Messages (model-visible)
  | "user/message"
  | "assistant/message"
  | "tool/result"
  // Tool calls (model-visible)
  | "tool/call"
  // Request configuration
  | "request/config"
  // System
  | "system/note"
  // Detection results
  | "detection/start"
  | "detection/result"
  // Custom events
  | "custom";

// ── Event Data Interfaces ──

export interface TurnStartEvent {
  turn: number;
}

export type TurnEndReason =
  | { kind: "completed" }
  | { kind: "aborted"; reason?: string }
  | { kind: "error"; error: string }
  | { kind: "max-tokens" }
  | { kind: "timeout" }
  | { kind: "blocked" };

export interface TurnEndEvent {
  turn: number;
  reason: TurnEndReason;
}

export interface StepStartEvent {
  turn: number;
  step: number;
}

export interface StepEndEvent {
  turn: number;
  step: number;
}

export interface UserMessageEvent {
  turn: number;
  content: string;
}

export interface AssistantMessageEvent {
  turn: number;
  step: number;
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ToolCallEvent {
  turn: number;
  step: number;
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultEvent {
  turn: number;
  step: number;
  callId: string;
  name: string;
  success: boolean;
  data?: unknown;
  error?: string;
  duration: number;
}

export interface RequestConfigEvent {
  turn: number;
  step: number;
  model: string;
  provider: string;
  temperature: number;
  maxTokens?: number;
  toolCount: number;
}

export interface DetectionStartEvent {
  scanId: string;
  detectionId: string;
  turn: number;
}

export interface DetectionResultEvent {
  scanId: string;
  detectionId: string;
  status: string;
  findingCount: number;
  score: number;
  duration: number;
}

export interface SystemNoteEvent {
  note: string;
}

export interface CustomEventData {
  type: string;
  data: unknown;
}

// ── Union of all event data types ──

export type SessionEventData =
  | TurnStartEvent
  | TurnEndEvent
  | StepStartEvent
  | StepEndEvent
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | RequestConfigEvent
  | DetectionStartEvent
  | DetectionResultEvent
  | SystemNoteEvent
  | CustomEventData;

// ── Session Event ──

/** A single event in the session log */
export interface SessionEvent {
  /** Monotonically increasing sequence number */
  readonly seq: number;
  /** Event type discriminator */
  readonly type: SessionEventType;
  /** Event payload (varies by type) */
  readonly data: SessionEventData;
  /** Unix timestamp in milliseconds */
  readonly timestamp: number;
}

// ── Session Log ──

/**
 * Append-only session event log.
 *
 * The log is the authoritative record of everything that happened during
 * a scan session. Model-visible content (messages, tool calls, results)
 * is always derived from the log, never stored separately.
 */
export class SessionLog {
  private events: SessionEvent[] = [];
  private nextSeq = 1;

  /** Append an event to the log and return it */
  append<T extends SessionEventType>(
    type: T,
    data: SessionEventData
  ): SessionEvent {
    const event: SessionEvent = {
      seq: this.nextSeq++,
      type,
      data,
      timestamp: Date.now(),
    };
    this.events.push(event);
    return event;
  }

  /** Get all events */
  getEvents(): ReadonlyArray<SessionEvent> {
    return this.events;
  }

  /** Get events of a specific type */
  getEventsByType(type: SessionEventType): SessionEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /** Get the latest event of a specific type */
  getLastEvent(type: SessionEventType): SessionEvent | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i]!;
      if (event.type === type) return event;
    }
    return undefined;
  }

  /** Get total event count */
  get length(): number {
    return this.events.length;
  }

  /**
   * Derive the model message history from the session log.
   *
   * This is the key function — it reconstructs the conversation
   * history that should be sent to the LLM by replaying the log.
   * Only model-visible events are included.
   */
  deriveMessages(systemPrompt?: string): Message[] {
    const messages: Message[] = [];

    // Add system prompt if provided
    if (systemPrompt) {
      messages.push({
        role: "system",
        content: systemPrompt,
      });
    }

    for (const event of this.events) {
      switch (event.type) {
        case "user/message": {
          const data = event.data as UserMessageEvent;
          messages.push({
            role: "user",
            content: data.content,
          });
          break;
        }

        case "assistant/message": {
          const data = event.data as AssistantMessageEvent;
          messages.push({
            role: "assistant",
            content: data.content,
            toolCalls: data.toolCalls?.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            })),
          });
          break;
        }

        case "tool/result": {
          const data = event.data as ToolResultEvent;
          messages.push({
            role: "tool",
            content: data.success
              ? JSON.stringify(data.data, null, 2)
              : `Error: ${data.error}`,
            toolCallId: data.callId,
            name: data.name,
          });
          break;
        }
      }
    }

    return messages;
  }

  /**
   * Get a summary of the session for diagnostics.
   */
  getSummary(): {
    totalEvents: number;
    turns: number;
    steps: number;
    toolCalls: number;
    duration: number;
  } {
    const turns = this.getEventsByType("turn/start").length;
    const steps = this.getEventsByType("step/start").length;
    const toolCalls = this.getEventsByType("tool/call").length;
    const firstEvent = this.events[0];
    const lastEvent = this.events[this.events.length - 1];
    const duration =
      firstEvent && lastEvent
        ? lastEvent.timestamp - firstEvent.timestamp
        : 0;

    return { totalEvents: this.events.length, turns, steps, toolCalls, duration };
  }

  /**
   * Export the log as a JSON-serializable array.
   */
  toJSON(): SessionEvent[] {
    return [...this.events];
  }

  /**
   * Clear the log (for testing only).
   */
  clear(): void {
    this.events = [];
    this.nextSeq = 1;
  }
}
