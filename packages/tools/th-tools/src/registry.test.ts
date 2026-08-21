/**
 * Tests for ToolRegistry — manages tool registration, lookup, and 3-stage execution.
 */
import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "./registry.js";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import { z } from "zod";

function makeTool(overrides?: Partial<Tool>): Tool {
  return {
    id: "test-tool",
    name: "Test Tool",
    description: "A test tool",
    category: "utility",
    inputSchema: z.object({
      message: z.string(),
    }),
    outputSchema: z.object({
      result: z.string(),
    }),
    execute: async (input: unknown) => ({
      success: true,
      data: { result: `processed: ${(input as { message: string }).message}` },
      duration: 10,
    }),
    ...overrides,
  };
}

function makeContext(): ToolContext {
  return {
    scanId: "scan-1",
    abortSignal: new AbortController().signal,
  };
}

describe("ToolRegistry", () => {
  // ── register and get ──

  it("register and get tool", () => {
    const registry = new ToolRegistry();
    const tool = makeTool();
    registry.register(tool);

    expect(registry.get("test-tool")).toBe(tool);
    expect(registry.has("test-tool")).toBe(true);
    expect(registry.size).toBe(1);
  });

  // ── register duplicate throws ──

  it("register duplicate throws error", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool());

    expect(() => registry.register(makeTool())).toThrow(
      'Tool "test-tool" already registered'
    );
  });

  // ── getSchemas ──

  it("getSchemas returns correct format", () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        id: "greet",
        name: "Greet",
        description: "Says hello",
        inputSchema: z.object({ name: z.string() }),
      })
    );

    const schemas = registry.getSchemas();
    expect(schemas).toHaveLength(1);
    expect(schemas[0]!.name).toBe("greet");
    expect(schemas[0]!.description).toBe("Says hello");
    expect(schemas[0]!.inputSchema).toBeDefined();
    expect(schemas[0]!.inputSchema.type).toBe("object");
  });

  // ── isConcurrencySafe ──

  it("isConcurrencySafe returns tool's declaration", () => {
    const registry = new ToolRegistry();

    const safeTool = makeTool({
      id: "safe",
      isConcurrencySafe: () => true,
    });
    registry.register(safeTool);

    const unsafeTool = makeTool({
      id: "unsafe",
      isConcurrencySafe: () => false,
    });
    registry.register(unsafeTool);

    const noDeclTool = makeTool({ id: "nodecl" });
    registry.register(noDeclTool);

    expect(registry.isConcurrencySafe("safe", {})).toBe(true);
    expect(registry.isConcurrencySafe("unsafe", {})).toBe(false);
    expect(registry.isConcurrencySafe("nodecl", {})).toBe(false);
    expect(registry.isConcurrencySafe("unknown", {})).toBe(false);
  });

  // ── prepare ──

  it("prepare validates input successfully", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool());
    const ctx = makeContext();

    const result = registry.prepare("test-tool", { message: "hello" }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prepared.tool.id).toBe("test-tool");
      expect(result.prepared.validatedInput).toEqual({ message: "hello" });
      expect(result.prepared.context).toBe(ctx);
      expect(result.prepared.timeoutMs).toBe(30000); // default
    }
  });

  it("prepare returns error for invalid input", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool());
    const ctx = makeContext();

    const result = registry.prepare("test-tool", { wrong: 123 }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.success).toBe(false);
      expect(result.result.error).toContain("Invalid input");
    }
  });

  it("prepare returns error for unknown tool", () => {
    const registry = new ToolRegistry();
    const ctx = makeContext();

    const result = registry.prepare("nonexistent", {}, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.error).toContain("Unknown tool");
      expect(result.result.error).toContain("nonexistent");
    }
  });

  // ── dispatch ──

  it("dispatch executes tool with timeout", async () => {
    const registry = new ToolRegistry();
    const executeFn = vi.fn().mockResolvedValue({
      success: true,
      data: { value: 42 },
      duration: 5,
    });
    registry.register(
      makeTool({ id: "async-tool", execute: executeFn })
    );
    const ctx = makeContext();

    const prepResult = registry.prepare("async-tool", { message: "test" }, ctx);
    expect(prepResult.ok).toBe(true);
    if (!prepResult.ok) throw new Error("unreachable");

    const result = await registry.dispatch(prepResult.prepared);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ value: 42 });
    expect(typeof result.duration).toBe("number");
    expect(executeFn).toHaveBeenCalledOnce();
  });

  it("dispatch catches tool errors", async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        id: "error-tool",
        execute: async () => {
          throw new Error("Tool crashed!");
        },
      })
    );
    const ctx = makeContext();

    const prepResult = registry.prepare("error-tool", { message: "test" }, ctx);
    if (!prepResult.ok) throw new Error("unreachable");

    const result = await registry.dispatch(prepResult.prepared);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Tool crashed!");
    expect(typeof result.duration).toBe("number");
  });

  // ── finalize ──

  it("finalize passes through normal-sized data", () => {
    const registry = new ToolRegistry();
    const result: ToolResult = {
      success: true,
      data: { small: "value" },
      duration: 10,
    };

    const finalized = registry.finalize(result);
    expect(finalized).toEqual(result);
  });

  it("finalize truncates large data", () => {
    const registry = new ToolRegistry();
    // Create data that's > 50,000 chars when serialized
    const bigData = { text: "x".repeat(60_000) };
    const result: ToolResult = {
      success: true,
      data: bigData,
      duration: 10,
    };

    const finalized = registry.finalize(result);
    expect(finalized.success).toBe(true);
    expect((finalized.data as Record<string, unknown>)._truncated).toBe(true);
    expect((finalized.data as Record<string, unknown>).originalSize).toBeGreaterThan(50_000);
    expect(typeof (finalized.data as Record<string, unknown>).preview).toBe("string");
  });

  it("finalize handles undefined data", () => {
    const registry = new ToolRegistry();
    const result: ToolResult = {
      success: false,
      error: "no data",
      duration: 5,
    };

    const finalized = registry.finalize(result);
    expect(finalized).toEqual(result);
  });
});
