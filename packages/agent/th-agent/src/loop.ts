/**
 * Agent Loop — the core driver that orchestrates the scan.
 *
 * Implements the DSH-style Turn → Step → Model → Tool → Result pipeline.
 * Key improvements over the basic version:
 *
 * 1. Session Log: All model-visible content is stored in an append-only log.
 *    Message history is DERIVED from the log via `deriveMessages()`.
 *
 * 2. Waterfall Events: Key pipeline points use waterfall dispatch,
 *    allowing plugins to intercept and modify behavior.
 *
 * 3. Turn/Step Structure: Each turn contains one or more steps.
 *    A step is one model request + the tool calls it triggers.
 *
 * The loop runs until:
 * - The LLM returns no tool calls (scan complete)
 * - Max turns reached
 * - Abort signal triggered
 * - Error occurs
 */
import type {
  LLMProvider,
  Message,
  ScanConfig,
  ScanTarget,
  ToolSchema,
} from "@test-harness/th-protocol";
import {
  AgentTurnStartedEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentPreStepEvent,
  AgentRequestEvent,
  AgentTurnStoppingEvent,
  AgentStreamChunkEvent,
  ToolsPreExecuteEvent,
  ToolsPostExecuteEvent,
} from "@test-harness/th-protocol";
import type {
  AgentContext,
  AgentResult,
  TurnResult,
} from "./context.js";
import type { ToolRegistry } from "@test-harness/th-tools";
import type { EventBusImpl } from "@test-harness/th-core";
import { SYSTEM_PROMPT, buildScanPlanningPrompt } from "./prompts/system.js";
import { SessionLog } from "./session.js";
import { StreamAssembler } from "./assembler.js";

/** Logger interface for the agent loop */
export interface AgentLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  toolCall(name: string, input: unknown): void;
  toolResult(name: string, success: boolean, duration: number): void;
}

/** Default console logger */
const defaultLogger: AgentLogger = {
  info: (msg) => console.log(`  [Agent] ${msg}`),
  warn: (msg) => console.warn(`  [Agent] ⚠ ${msg}`),
  error: (msg) => console.error(`  [Agent] ✗ ${msg}`),
  toolCall: (name, input) =>
    console.log(
      `  [Agent] → Tool: ${name}(${JSON.stringify(input).slice(0, 100)})`
    ),
  toolResult: (name, success, duration) =>
    console.log(`  [Agent] ← ${name}: ${success ? "✓" : "✗"} (${duration}ms)`),
};

export interface AgentLoopOptions {
  scanId: string;
  target: ScanTarget;
  config: ScanConfig;
  llm: LLMProvider;
  toolRegistry: ToolRegistry;
  eventBus: EventBusImpl;
  container: import("@test-harness/th-core").THContainer;
  logger?: AgentLogger;
  signal?: AbortSignal;
}

export class AgentLoop {
  private logger: AgentLogger;

  constructor() {
    this.logger = defaultLogger;
  }

  /**
   * Run the agent loop for a scan.
   *
   * This is the main entry point — it creates the session log, context,
   * and drives the Turn → Step → Model → Tool → Result cycle.
   */
  async run(options: AgentLoopOptions): Promise<AgentResult> {
    const logger = options.logger ?? this.logger;
    const abortController = new AbortController();
    if (options.signal) {
      options.signal.addEventListener("abort", () =>
        abortController.abort()
      );
    }

    // Create the session log — the single source of truth
    const sessionLog = new SessionLog();

    const context: AgentContext = {
      scanId: options.scanId,
      target: options.target,
      config: options.config,
      llm: options.llm,
      toolRegistry: options.toolRegistry,
      eventBus: options.eventBus,
      container: options.container,
      sessionLog,
      state: new Map(),
      turnCount: 0,
      stepCount: 0,
      maxTurns: options.config.maxTurns ?? 20,
      abortSignal: abortController.signal,
    };

    logger.info(`Starting scan for ${options.target.url}`);

    // Log the initial user message (scan task)
    const availableDetections = options.toolRegistry
      .getAll()
      .filter((t) => t.category === "detection")
      .map((t) => t.id);

    sessionLog.append("user/message", {
      turn: 0,
      content: buildScanPlanningPrompt(
        options.target.url,
        availableDetections
      ),
    });

    // Log a system note about scan configuration
    sessionLog.append("system/note", {
      note: `Scan config: strategy=${options.config.strategy}, maxTurns=${context.maxTurns}, detections=[${availableDetections.join(", ")}]`,
    });

    // Main loop
    while (
      context.turnCount < context.maxTurns &&
      !abortController.signal.aborted
    ) {
      context.turnCount++;
      context.stepCount = 0;
      logger.info(`Turn ${context.turnCount}...`);

      // Log turn start
      sessionLog.append("turn/start", { turn: context.turnCount });

      // Emit turn started event
      await options.eventBus.emit(AgentTurnStartedEvent, {
        scanId: options.scanId,
        turnNumber: context.turnCount,
      });

      try {
        const result = await this.executeTurn(context, logger);

        if (result.complete) {
          // Log turn end with completed reason
          sessionLog.append("turn/end", {
            turn: context.turnCount,
            reason: { kind: "completed" },
          });

          logger.info("Scan complete.");
          return {
            scanId: options.scanId,
            status: "completed",
            turns: context.turnCount,
            summary: result.response.content,
          };
        }

        // Log turn end (continuing — tools need more work)
        sessionLog.append("turn/end", {
          turn: context.turnCount,
          reason: { kind: "completed" },
        });
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error(String(err));

        // Log turn end with error
        sessionLog.append("turn/end", {
          turn: context.turnCount,
          reason: { kind: "error", error: error.message },
        });

        logger.error(`Turn failed: ${error.message}`);
        return {
          scanId: options.scanId,
          status: "failed",
          turns: context.turnCount,
          error,
        };
      }
    }

    // Loop ended without completion
    sessionLog.append("turn/end", {
      turn: context.turnCount,
      reason: abortController.signal.aborted
        ? { kind: "aborted", reason: "User cancelled" }
        : { kind: "timeout" },
    });

    if (abortController.signal.aborted) {
      return {
        scanId: options.scanId,
        status: "cancelled",
        turns: context.turnCount,
      };
    }

    return {
      scanId: options.scanId,
      status: "timeout",
      turns: context.turnCount,
      summary: "Maximum turns reached",
    };
  }

  /**
   * Execute a single turn: build messages → call LLM → execute tools.
   *
   * A turn consists of one or more steps. Each step is:
   * 1. Pre-step waterfall (plugins can modify/reject)
   * 2. Model request (with waterfall for config modification)
   * 3. Tool call execution (with waterfall for pre/post processing)
   */
  private async executeTurn(
    context: AgentContext,
    logger: AgentLogger
  ): Promise<TurnResult> {
    const { sessionLog, eventBus } = context;

    context.stepCount++;
    const step = context.stepCount;

    // ── Step 1: Pre-step waterfall ──
    // Derive messages from session log
    const messages = sessionLog.deriveMessages(SYSTEM_PROMPT);

    // Fire pre-step waterfall — plugins can modify or reject
    const preStepResult = await eventBus.waterfall(AgentPreStepEvent, {
      scanId: context.scanId,
      turnNumber: context.turnCount,
      stepNumber: step,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      decision: "enter" as const,
    });

    if (preStepResult.decision === "reject") {
      return {
        complete: true,
        response: { content: "Step rejected by plugin" },
      };
    }

    // Log step start
    sessionLog.append("step/start", {
      turn: context.turnCount,
      step,
    });

    // ── Step 2: Build and fire request waterfall ──
    // Get the (possibly modified) messages
    const finalMessages: Message[] = preStepResult.messages.map(
      (m, i) => messages[i] ?? { role: m.role as Message["role"], content: m.content }
    );

    // Build tool schemas
    const toolSchemas: ToolSchema[] = context.toolRegistry.getSchemas();

    // Request waterfall — plugins can modify model config
    const requestConfig = await eventBus.waterfall(AgentRequestEvent, {
      scanId: context.scanId,
      turnNumber: context.turnCount,
      stepNumber: step,
      model: context.config.llm.model,
      temperature: context.config.llm.temperature ?? 0.1,
      maxTokens: undefined,
    });

    // Log request config
    sessionLog.append("request/config", {
      turn: context.turnCount,
      step,
      model: requestConfig.model,
      provider: context.config.llm.provider,
      temperature: requestConfig.temperature,
      maxTokens: requestConfig.maxTokens,
      toolCount: toolSchemas.length,
    });

    // ── Step 3: Call LLM (streaming) ──
    const assembler = new StreamAssembler();
    let lastStreamEmit = 0;

    try {
      const stream = context.llm.stream({
        model: requestConfig.model,
        messages: finalMessages,
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
        temperature: requestConfig.temperature,
        maxTokens: requestConfig.maxTokens,
        signal: context.abortSignal,
      });

      for await (const chunk of stream) {
        assembler.push(chunk);

        // Emit streaming progress every 200ms for terminal display
        const now = Date.now();
        if (now - lastStreamEmit > 200 || assembler.done) {
          lastStreamEmit = now;
          await eventBus.emit(AgentStreamChunkEvent, {
            scanId: context.scanId,
            turnNumber: context.turnCount,
            partialContent: assembler.partialContent,
            toolCallCount: assembler.toolCallCount,
            done: assembler.done,
          });
        }
      }
    } catch (err) {
      // If streaming fails, log and rethrow
      logger.error(`LLM streaming failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }

    // Assemble the complete response from streaming chunks
    const response = assembler.finish(requestConfig.model);

    // Log assistant message
    sessionLog.append("assistant/message", {
      turn: context.turnCount,
      step,
      content: response.content,
      toolCalls: response.toolCalls?.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      })),
      usage: response.usage,
    });

    // Log step end
    sessionLog.append("step/end", {
      turn: context.turnCount,
      step,
    });

    // If no tool calls, the agent is done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      // Fire turn-stopping event — plugins can request continuation
      await eventBus.serial(AgentTurnStoppingEvent, {
        scanId: context.scanId,
        turnNumber: context.turnCount,
        shouldContinue: false,
      });

      return {
        complete: true,
        response: { content: response.content },
      };
    }

    // ── Step 4: Execute tool calls ──
    const toolResults: TurnResult["toolResults"] = [];

    for (const toolCall of response.toolCalls) {
      // Log tool call
      sessionLog.append("tool/call", {
        turn: context.turnCount,
        step,
        callId: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      });

      logger.toolCall(toolCall.name, toolCall.arguments);

      // Emit tool call event
      await eventBus.emit(AgentToolCallEvent, {
        scanId: context.scanId,
        turnNumber: context.turnCount,
        toolName: toolCall.name,
        input: toolCall.arguments,
      });

      // Pre-execute waterfall — plugins can deny or modify
      const preExecute = await eventBus.waterfall(ToolsPreExecuteEvent, {
        scanId: context.scanId,
        toolName: toolCall.name,
        input: toolCall.arguments,
        decision: "approve" as const,
      });

      let result: { success: boolean; data?: unknown; error?: string };
      let duration = 0;

      if (preExecute.decision === "deny") {
        result = {
          success: false,
          error: preExecute.denyReason ?? "Tool execution denied by plugin",
        };
      } else {
        // 3-stage execution pipeline: prepare → dispatch → finalize
        const prepResult = context.toolRegistry.prepare(
          toolCall.name,
          preExecute.input,
          {
            scanId: context.scanId,
            abortSignal: context.abortSignal,
          }
        );

        if (!prepResult.ok) {
          result = {
            success: false,
            error: prepResult.result.error,
          };
        } else {
          // Dispatch with timeout control
          const dispatchResult = await context.toolRegistry.dispatch(
            prepResult.prepared
          );

          // Finalize — truncate large payloads
          const finalized = context.toolRegistry.finalize(dispatchResult);

          result = {
            success: finalized.success,
            data: finalized.data,
            error: finalized.error,
          };
          duration = finalized.duration;
          logger.toolResult(toolCall.name, finalized.success, duration);
        }

        // Post-execute waterfall — plugins can modify result
        const postExecute = await eventBus.waterfall(ToolsPostExecuteEvent, {
          scanId: context.scanId,
          toolName: toolCall.name,
          success: result.success,
          data: result.data,
          error: result.error,
          duration,
          replaced: false,
        });

        if (postExecute.replaced) {
          result = {
            success: postExecute.success,
            data: postExecute.data,
            error: postExecute.error,
          };
        }

        // Emit tool result event
        await eventBus.emit(AgentToolResultEvent, {
          scanId: context.scanId,
          turnNumber: context.turnCount,
          toolName: toolCall.name,
          success: result.success,
          duration,
        });
      }

      // Log tool result
      sessionLog.append("tool/result", {
        turn: context.turnCount,
        step,
        callId: toolCall.id,
        name: toolCall.name,
        success: result.success,
        data: result.data,
        error: result.error,
        duration: 0, // Duration tracked in post-execute
      });

      toolResults.push({
        toolCallId: toolCall.id,
        name: toolCall.name,
        success: result.success,
        data: result.data,
        error: result.error,
      });
    }

    return {
      complete: false,
      response: {
        content: response.content,
        toolCalls: response.toolCalls,
      },
      toolResults,
    };
  }
}
