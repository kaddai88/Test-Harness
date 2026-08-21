/**
 * Tool system types — the capability seam for agent tools.
 *
 * Tools are the actions the agent loop can invoke via LLM tool calls.
 * The execution pipeline has three stages:
 *   prepare → dispatch → finalize
 *
 * Each stage is interceptable via waterfall events (ToolsPreExecuteEvent,
 * ToolsPostExecuteEvent) allowing plugins to modify input/output.
 */
import type { z } from "zod";

/** Tool category */
export type ToolCategory = "crawl" | "detection" | "analysis" | "utility";

/** Context passed to a tool during execution */
export interface ToolContext {
  readonly scanId: string;
  readonly abortSignal: AbortSignal;
}

/** Result from tool execution */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  duration: number;
}

/**
 * Tool — the service definition for agent tools.
 *
 * Tools declare:
 * - inputSchema / outputSchema for validation
 * - timeoutMs for execution time limit
 * - isConcurrencySafe() to opt into parallel execution
 *
 * The Agent Loop uses these declarations for scheduling:
 * - Concurrency-safe tools run in parallel (bounded pool)
 * - Exclusive tools form barriers (sequential)
 */
export interface Tool {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ToolCategory;
  readonly inputSchema: z.ZodType;
  readonly outputSchema: z.ZodType;

  /** Execution timeout in milliseconds (default: 30000) */
  readonly timeoutMs?: number;

  /**
   * Whether this tool is safe to run concurrently with other tools.
   * Defaults to false (exclusive/barrier execution).
   *
   * Examples of concurrency-safe tools:
   * - http_request (read-only HTTP calls)
   * - extract_dom (read-only DOM extraction)
   *
   * Examples of exclusive tools:
   * - run_detection (may modify shared state)
   * - crawl_page (rate-limited, shares browser pool)
   */
  isConcurrencySafe?(args: unknown): boolean;

  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}
