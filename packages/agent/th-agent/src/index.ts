/**
 * @test-harness/th-agent
 *
 * Agent Loop — the AI-driven session orchestrator.
 */
export { AgentLoop } from "./loop.js";
export type { AgentLoopOptions, AgentLogger } from "./loop.js";
export type {
  AgentContext,
  AgentResult,
  TurnResult,
} from "./context.js";
export { SessionLog } from "./session.js";
export { StreamAssembler } from "./assembler.js";
export type {
  SessionEvent,
  SessionEventType,
  SessionEventData,
  TurnStartEvent,
  TurnEndEvent,
  TurnEndReason,
  StepStartEvent,
  StepEndEvent,
  UserMessageEvent,
  AssistantMessageEvent,
  ToolCallEvent,
  ToolResultEvent,
  RequestConfigEvent,
} from "./session.js";
export { SYSTEM_PROMPT, buildSessionPlanningPrompt } from "./prompts/system.js";
export type { SiteHints } from "./prompts/system.js";
