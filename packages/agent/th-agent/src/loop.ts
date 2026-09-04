/**
 * Agent Loop — the core driver that orchestrates the session.
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
 * - The LLM returns no tool calls (session complete)
 * - Max turns reached
 * - Abort signal triggered
 * - Error occurs
 */
import type {
  LLMProvider,
  Message,
  SessionConfig,
  SessionTarget,
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
import { SYSTEM_PROMPT, buildSessionPlanningPrompt, type SiteHints } from "./prompts/system.js";
import { SessionLog } from "./session.js";
import { StreamAssembler } from "./assembler.js";
import {
  WorkflowState,
  WORKFLOW_TRANSITIONS,
  getAllowedTools,
  getStatePrompt,
  updateWorkflowContext,
  tryTransition,
  createInitialContext,
  type WorkflowContext,
} from "./workflow.js";
import { verifyAction, getRecoveryGuidance } from "./verify.js";
import { CognitiveEngine } from "@test-harness/th-cognition";
import * as path from "path";

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
  sessionId: string;
  target: SessionTarget;
  config: SessionConfig;
  llm: LLMProvider;
  toolRegistry: ToolRegistry;
  eventBus: EventBusImpl;
  container: import("@test-harness/th-core").THContainer;
  logger?: AgentLogger;
  signal?: AbortSignal;
  /** Phase 2: Site-specific hints from SiteProfile for generalized testing */
  siteHints?: SiteHints;
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

    const context: AgentContext & { workflow: WorkflowContext; workflowState: WorkflowState } = {
      sessionId: options.sessionId,
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
      maxTurns: options.config.maxTurns ?? 99,
      maxRetriesPerAction: options.config.maxRetriesPerAction ?? 3,
      toolFailureCounts: new Map(),
      abortSignal: abortController.signal,
      workflow: createInitialContext(options.config.maxTurns ?? 99),
      workflowState: WorkflowState.INIT,
      cognition: new CognitiveEngine({ storagePath: path.resolve(process.cwd(), '.cognition') }),
    };

    logger.info(`Starting session for ${options.target.url}`);

    // ── Cognitive Engine: Session start — retrieve relevant experiences ──
    if (context.cognition) {
      const sessionStart = context.cognition.onSessionStart(options.target.url, options.config.strategy);
      if (sessionStart.prompt) {
        sessionLog.append("system/note", {
          note: `[Cognition] 历史经验:\n${sessionStart.prompt}`,
        });
        logger.info(`[Cognition] Retrieved experiences for ${options.target.url}`);
      }
    }

    // Log the initial user message (session task)
    const availableTools = options.toolRegistry
      .getAll()
      .map((t) => t.id);

    sessionLog.append("user/message", {
      turn: 0,
      content: buildSessionPlanningPrompt(
        options.target.url,
        availableTools,
        options.config.instructions as string | undefined,
        options.siteHints
      ),
    });

    // Log a system note about session configuration
    sessionLog.append("system/note", {
      note: `Session config: strategy=${options.config.strategy}, maxTurns=${context.maxTurns}, tools=[${availableTools.join(", ")}]`,
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
        sessionId: options.sessionId,
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

          logger.info("Session complete.");
          
          // ── Cognitive Engine: Session end — save memories ──
          await this.finalizeSession(context, "completed", result.response.content, logger);
          
          return {
            sessionId: options.sessionId,
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
        
        // ── Cognitive Engine: Session end — save memories ──
        await this.finalizeSession(context, "failed", error.message, logger);
        
        return {
          sessionId: options.sessionId,
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
      // ── Cognitive Engine: Session end — save memories ──
      await this.finalizeSession(context, "cancelled", "User cancelled", logger);
        
      return {
        sessionId: options.sessionId,
        status: "cancelled",
        turns: context.turnCount,
      };
    }
      
    // ── Cognitive Engine: Session end — save memories ──
    await this.finalizeSession(context, "timeout", "Maximum turns reached", logger);
      
    return {
      sessionId: options.sessionId,
      status: "timeout",
      turns: context.turnCount,
      summary: "Maximum turns reached",
    };
  }
  
  /**
   * Finalize session: save memories and learn from outcomes.
   */
  private async finalizeSession(
    context: AgentContext & { workflow: WorkflowContext; workflowState: WorkflowState },
    status: 'completed' | 'failed' | 'cancelled' | 'timeout',
    summary: string | undefined,
    logger: AgentLogger
  ): Promise<void> {
    if (!context.cognition) return;
      
    try {
      // Determine outcome
      const outcome = status === 'completed' ? 'success' : 'failure';
        
      // Collect actions from session log
      const actions: Array<{ tool: string; input: Record<string, unknown>; success: boolean }> = [];
      const logEntries = context.sessionLog.getEvents();
      for (const entry of logEntries) {
        if (entry.type === 'tool/result') {
          const data = entry.data as unknown as Record<string, unknown>;
          actions.push({
            tool: data.name as string,
            input: {},
            success: data.success as boolean,
          });
        }
      }
        
      // Collect findings (detected errors)
      const findings = context.workflow.detectedErrors.map(e => ({
        severity: 'medium',
        title: `操作失败: ${e.tool}`,
        description: e.error,
      }));
        
      // Save to cognitive engine
      context.cognition.onSessionEnd(
        context.target.url,
        outcome,
        findings,
        actions
      );
        
      // Log stats
      const stats = context.cognition.getStats();
      logger.info(`[Cognition] Session saved. Memory: ${stats.episodes} episodes, ${stats.knowledge} knowledge, ${stats.procedures} procedures`);
    } catch (err) {
      logger.warn(`[Cognition] Failed to save session: ${err}`);
    }
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
    context: AgentContext & { workflow: WorkflowContext; workflowState: WorkflowState },
    logger: AgentLogger
  ): Promise<TurnResult> {
    const { sessionLog, eventBus } = context;

    context.stepCount++;
    const step = context.stepCount;

    // ── Workflow: Add state-specific prompt ──
    const statePrompt = getStatePrompt(context.workflowState);
    const enhancedSystemPrompt = SYSTEM_PROMPT + '\n\n' + statePrompt;

    // ── Step 1: Pre-step waterfall ──
    // Derive messages from session log
    const messages = sessionLog.deriveMessages(enhancedSystemPrompt);

    // Fire pre-step waterfall — plugins can modify or reject
    const preStepResult = await eventBus.waterfall(AgentPreStepEvent, {
      sessionId: context.sessionId,
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
    let toolSchemas: ToolSchema[] = context.toolRegistry.getSchemas();

    // ── Workflow: Filter tools based on current state ──
    const allowedTools = getAllowedTools(context.workflowState);
    if (allowedTools !== null) {
      toolSchemas = toolSchemas.filter(ts => allowedTools.includes(ts.name));
      logger.info(`[Workflow] State=${context.workflowState}, allowed tools: ${allowedTools.join(', ')}`);
    }

    // Request waterfall — plugins can modify model config
    const requestConfig = await eventBus.waterfall(AgentRequestEvent, {
      sessionId: context.sessionId,
      turnNumber: context.turnCount,
      stepNumber: step,
      model: context.config.llm.model || process.env.QWEN_MODEL || "qwen3.7-plus",
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
            sessionId: context.sessionId,
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
        sessionId: context.sessionId,
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

      // ── LOGIN GUARD: Track login success and block re-login ──
      // Login is confirmed when agent navigates to a NON-login page.
      // Once logged in, block any browser_navigate to login page URLs.
      const toolArgs = toolCall.arguments as Record<string, unknown>;

      // Detect login success: navigating to a non-login URL means login worked
      if (toolCall.name === "browser_navigate" || toolCall.name === "navigate_to") {
        const navUrl = String(toolArgs.url ?? "");
        const loginConfirmed = context.state.get("loginConfirmed") as boolean ?? false;

        if (!loginConfirmed && !navUrl.toLowerCase().includes("login")) {
          // Agent navigated to a non-login page — login was successful
          context.state.set("loginConfirmed", true);
          // Block the original target URL if it's a login page
          const targetUrl = context.target.url;
          if (targetUrl.toLowerCase().includes("login")) {
            const blocked = (context.state.get("blockedUrls") as string[]) ?? [];
            if (!blocked.includes(targetUrl)) blocked.push(targetUrl);
            context.state.set("blockedUrls", blocked);
          }
          logger.info(`[LoginGuard] Login confirmed. Blocking: ${targetUrl}`);
        }

        // Block re-login navigation
        if (loginConfirmed && navUrl.toLowerCase().includes("login")) {
          logger.warn(`[LoginGuard] BLOCKED ${toolCall.name}: ${navUrl}`);
          const errorMsg = `BLOCKED: You are already logged in. Do NOT navigate to login pages. Navigate to the target module instead. URL: "${navUrl}"`;
          sessionLog.append("tool/result", {
            turn: context.turnCount, step, callId: toolCall.id,
            name: toolCall.name, success: false, error: errorMsg, data: null, duration: 0,
          });
          toolResults.push({ toolCallId: toolCall.id, name: toolCall.name, success: false, error: errorMsg, data: null });
          await eventBus.emit(AgentToolCallEvent, {
            sessionId: context.sessionId, turnNumber: context.turnCount, toolName: toolCall.name, input: toolCall.arguments });
          await eventBus.emit(AgentToolResultEvent, {
            sessionId: context.sessionId, turnNumber: context.turnCount, toolName: toolCall.name, success: false, duration: 0 });
          continue;
        }
      }

      // Emit tool call event
      await eventBus.emit(AgentToolCallEvent, {
        sessionId: context.sessionId,
        turnNumber: context.turnCount,
        toolName: toolCall.name,
        input: toolCall.arguments,
      });

      // Pre-execute waterfall — plugins can deny or modify
      const preExecute = await eventBus.waterfall(ToolsPreExecuteEvent, {
        sessionId: context.sessionId,
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
            sessionId: context.sessionId,
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
          sessionId: context.sessionId,
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
          sessionId: context.sessionId,
          turnNumber: context.turnCount,
          toolName: toolCall.name,
          success: result.success,
          duration,
          data: result.data,
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

      // Track consecutive failures per tool
      // Reset counter when switching to a different tool
      const currentTool = toolCall.name;
      const lastTool = context.state.get("lastTool") as string | undefined;

      if (lastTool && lastTool !== currentTool) {
        // Tool changed — reset all failure counters
        context.toolFailureCounts.clear();
      }
      context.state.set("lastTool", currentTool);

      if (result.success) {
        context.toolFailureCounts.set(currentTool, 0);
      } else {
        const count = (context.toolFailureCounts.get(currentTool) ?? 0) + 1;
        context.toolFailureCounts.set(currentTool, count);

        // If tool hit max retries, inject system message to force strategy change
        if (count >= context.maxRetriesPerAction) {
          sessionLog.append("system/note", {
            note: `⚠️ Tool "${currentTool}" has failed ${count} consecutive times. You MUST try a different approach — use a different tool, different selector, or different strategy. Do NOT repeat the same failing action.`,
          });
          logger.warn(`${currentTool} failed ${count}x — forcing strategy change`);
        }
      }

      toolResults.push({
        toolCallId: toolCall.id,
        name: toolCall.name,
        success: result.success,
        data: result.data,
        error: result.error,
      });

      // ── Workflow: Update context based on tool execution ──
      context.workflow = updateWorkflowContext(
        context.workflow,
        toolCall.name,
        toolCall.arguments as Record<string, unknown>,
        result.success,
        result.data as Record<string, unknown> | undefined,
        context.workflowState
      );

      // ── Action Verification: Validate action had intended effect ──
      const actionTools = ['browser_click', 'browser_type', 'browser_fill_form',
        'browser_navigate', 'browser_select_option', 'browser_check',
        'browser_uncheck', 'browser_press_key'];
      if (actionTools.includes(toolCall.name) && result.success) {
        const beforeSnapshot = context.workflow.lastSnapshot;
        const afterSnapshot = context.workflow.lastPageContent;
        const currentUrl = context.workflow.currentPageUrl;

        if (beforeSnapshot && afterSnapshot) {
          const verification = verifyAction(
            toolCall.name,
            toolCall.arguments as Record<string, unknown>,
            beforeSnapshot,
            afterSnapshot,
            currentUrl
          );

          // Track verification outcome
          if (verification.outcome !== 'success') {
            context.workflow.verificationFailures++;
            context.workflow.lastVerificationOutcome = verification.outcome;

            // Record detected errors for reporting
            if (verification.outcome === 'error_appeared') {
              context.workflow.detectedErrors.push({
                tool: toolCall.name,
                error: verification.details,
                turn: context.turnCount,
              });
            }

            // Inject recovery guidance
            const guidance = getRecoveryGuidance(verification, context.workflow.verificationFailures);
            if (guidance) {
              sessionLog.append("system/note", { note: guidance });
              logger.warn(`[Verify] ${verification.outcome}: ${verification.details}`);
            }
          } else {
            // Reset failure counter on success
            context.workflow.verificationFailures = 0;
            context.workflow.lastVerificationOutcome = 'success';
          }
        }
      }

      // ── Cognitive Engine: Learn from action outcome ──
      if (context.cognition) {
        context.cognition.onBeforeAction(toolCall.name, toolCall.arguments as Record<string, unknown>);
        const cogResult = context.cognition.onAfterAction(
          toolCall.name,
          toolCall.arguments as Record<string, unknown>,
          result.success,
          result.data,
          result.error
        );

        // Inject recovery suggestions if available
        if (cogResult.recoverySuggestions && cogResult.recoverySuggestions.length > 0) {
          sessionLog.append("system/note", {
            note: `[Cognition] 恢复建议: ${cogResult.recoverySuggestions.join('; ')}`,
          });
        }

        // Inject strategy adjustment if available
        if (cogResult.strategyAdjustment) {
          sessionLog.append("system/note", {
            note: `[Cognition] 策略调整: ${cogResult.strategyAdjustment.adjustment}`,
          });
        }
      }
    }

    // ── Workflow: Check state transitions ──
    const previousState = context.workflowState;
    const transitionResult = tryTransition(context.workflow, context.workflowState);

    if (transitionResult.fired) {
      // Find the matching transition to get the target state
      for (const t of WORKFLOW_TRANSITIONS) {
        if (t.from === previousState && t.key === transitionResult.transitionKey) {
          context.workflowState = t.to;
          break;
        }
      }
      // Record coverage
      if (transitionResult.transitionKey && !context.workflow.traversedTransitions.includes(transitionResult.transitionKey)) {
        context.workflow.traversedTransitions.push(transitionResult.transitionKey);
      }
      // Log invariant violations
      if (!transitionResult.invariantOk && transitionResult.invariantViolation) {
        context.workflow.invariantViolations.push(
          `${previousState}→${context.workflowState}: ${transitionResult.invariantViolation}`
        );
        logger.warn(`[Workflow] Invariant violation: ${transitionResult.invariantViolation}`);
      }
      logger.info(`[Workflow] ${transitionResult.message} (${previousState} → ${context.workflowState})`);
      logger.info(`[Workflow] Coverage: [${context.workflow.traversedTransitions.join(', ')}]`);
      sessionLog.append("system/note", {
        note: `[Workflow] ${previousState} → ${context.workflowState} | coverage: [${context.workflow.traversedTransitions.join(', ')}]`,
      });

      await eventBus.emit("agent:workflow_state" as any, {
        sessionId: context.sessionId,
        previousState,
        newState: context.workflowState,
        message: transitionResult.message,
      });

      // ── Auto-generate test plan when entering TEST state ──
      if (context.workflowState === WorkflowState.TEST && context.workflow.testPlan.length === 0) {
        logger.info('[Workflow] Entering TEST state — analyzing page via snapshot...');
        try {
          // Use MCP browser_snapshot to analyze page complexity
          const snapshotTool = context.toolRegistry.get('browser_snapshot');
          let snapshotText = '';
          if (snapshotTool) {
            const snapResult = await snapshotTool.execute({}, {
              sessionId: context.sessionId,
              abortSignal: context.abortSignal,
            });
            if (snapResult.success && snapResult.data) {
              snapshotText = String((snapResult.data as any).text ?? '');
            }
          }

          // Estimate complexity from snapshot text length
          // Aria snapshot: ~50 chars per interactive element roughly
          const estimatedElements = snapshotText ? Math.max(5, Math.floor(snapshotText.length / 50)) : 20;
          const hasForms = snapshotText.toLowerCase().includes('textbox') || snapshotText.toLowerCase().includes('combobox');
          const hasTables = snapshotText.toLowerCase().includes('table') || snapshotText.toLowerCase().includes('grid');

          let targetTestCount: number;
          if (estimatedElements < 10) {
            targetTestCount = 10;
          } else if (estimatedElements < 30) {
            targetTestCount = 15 + Math.floor((estimatedElements - 10) / 2);
          } else if (estimatedElements < 60) {
            targetTestCount = 25 + Math.floor((estimatedElements - 30) / 3);
          } else {
            targetTestCount = 35 + Math.floor((estimatedElements - 60) / 5);
          }
          targetTestCount = Math.min(targetTestCount, 50);

          logger.info(`[Workflow] Page: ~${estimatedElements} elements, forms=${hasForms}, tables=${hasTables}, targeting ${targetTestCount} tests`);

          const planPrompt = `You are testing a module at: ${context.target.url}

Page analysis from accessibility snapshot:
- ~${estimatedElements} interactive elements found
- ${hasForms ? 'Contains forms (textbox/combobox elements detected)' : 'No forms detected'}
- ${hasTables ? 'Contains data tables/grids' : 'No data tables detected'}
- Snapshot length: ${snapshotText.length} chars

Generate a comprehensive test plan with ${targetTestCount} specific test actions. Cover:
- All major UI components and their interactions
- Form validation (if forms exist)
- Data display and navigation (if tables exist)
- Error handling and edge cases
- Business logic workflows

Each test should be:
- A concrete, executable operation using browser_click/browser_fill_form/browser_type with refs
- Clearly describe what to do and what to verify
- Ordered logically (setup → execute → verify → cleanup)

Output ONLY a JSON array:
[{"description": "Verify page loads with correct title and layout", "completed": false}, ...]

Test plan:`;

          const planStream = context.llm.stream({
            model: requestConfig.model,
            messages: [{ role: 'user', content: planPrompt }],
            temperature: 0.3,
            signal: context.abortSignal,
          });

          const planAssembler = new StreamAssembler();
          for await (const chunk of planStream) {
            planAssembler.push(chunk);
          }
          const planText = planAssembler.partialContent;

          const jsonMatch = planText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const plan = JSON.parse(jsonMatch[0]);
            if (Array.isArray(plan) && plan.length > 0) {
              context.workflow.testPlan = plan.map((item: any) => ({
                description: item.description || String(item),
                completed: false,
              }));
              logger.info(`[Workflow] Test plan generated: ${context.workflow.testPlan.length} items`);
              sessionLog.append("system/note", {
                note: `[Test Plan] Generated ${context.workflow.testPlan.length} test items:\n${context.workflow.testPlan.map((t, i) => `${i + 1}. ${t.description}`).join('\n')}`,
              });
            }
          }
        } catch (err) {
          logger.warn(`[Workflow] Failed to generate test plan: ${err instanceof Error ? err.message : String(err)}`);
          context.workflow.testPlan = [
            { description: 'Take browser_snapshot and document page structure', completed: false },
            { description: 'Verify all navigation links work', completed: false },
            { description: 'Test all buttons and their actions', completed: false },
            { description: 'Validate form inputs if present', completed: false },
            { description: 'Check data display and formatting', completed: false },
            { description: 'Test search/filter functionality if available', completed: false },
            { description: 'Verify error handling and validation messages', completed: false },
            { description: 'Test pagination if data tables exist', completed: false },
            { description: 'Check responsive layout and UI consistency', completed: false },
            { description: 'Verify business logic workflows', completed: false },
          ];
        }
      }
    }

    // ─ Stagnation Detection: Check for modal dialogs when stuck ──
    if (context.workflow.stagnantTurns >= 2 && context.workflowState === WorkflowState.TEST) {
      const lastTool = context.state.get("lastTool") as string | undefined;
      // If agent is stuck and last action was a click, likely a modal appeared
      if (lastTool === 'browser_click' || lastTool === 'click_element') {
        sessionLog.append("system/note", {
          note: `⚠️ STUCK DETECTION: You've been stuck for ${context.workflow.stagnantTurns} turns after clicking. A modal dialog or confirmation popup may have appeared. Use browser_snapshot to check for dialogs and browser_handle_dialog or browser_click "确认"/"确定"/"OK" button if found.`,
        });
        logger.warn(`[Stagnation] ${context.workflow.stagnantTurns} turns stuck after click — checking for modal dialogs`);
      }
    }

    // ─ Verification Failure Escalation ──
    // If multiple consecutive verification failures, force strategy change
    if (context.workflow.verificationFailures >= 3) {
      const lastOutcome = context.workflow.lastVerificationOutcome;
      let escalationNote: string;

      if (lastOutcome === 'error_appeared') {
        escalationNote = `⚠️ VERIFICATION ESCALATION: ${context.workflow.verificationFailures} consecutive actions resulted in errors. ` +
          `This may indicate a bug OR a fundamental misunderstanding of the page. ` +
          `ACTION REQUIRED: Use report_finding to document the errors, then try a completely different approach.`;
      } else if (lastOutcome === 'no_change') {
        escalationNote = `⚠️ VERIFICATION ESCALATION: ${context.workflow.verificationFailures} consecutive actions had no effect on the page. ` +
          `The element you're trying to interact with may be: disabled, covered by an overlay, in an iframe, or not actually clickable. ` +
          `ACTION REQUIRED: Take a fresh browser_snapshot and find a DIFFERENT element to interact with.`;
      } else if (lastOutcome === 'dialog_blocked') {
        escalationNote = `⚠️ VERIFICATION ESCALATION: Dialog is blocking your actions. ` +
          `You MUST handle the dialog first using browser_handle_dialog or by clicking the dialog button.`;
      } else {
        escalationNote = `⚠️ VERIFICATION ESCALATION: ${context.workflow.verificationFailures} consecutive action failures. ` +
          `STOP and reassess. Take browser_snapshot to understand the current state.`;
      }

      sessionLog.append("system/note", { note: escalationNote });
      logger.warn(`[Verify] Escalation: ${context.workflow.verificationFailures} failures, outcome=${lastOutcome}`);

      // Reset to prevent repeated escalation messages
      context.workflow.verificationFailures = 0;
    }

    // Check if workflow is done
    if (context.workflowState === WorkflowState.DONE) {
      return {
        complete: true,
        response: { content: response.content },
        toolResults,
      };
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
