/**
 * Tests for StreamAssembler — collects streaming LLM chunks.
 */
import { describe, it, expect } from "vitest";
import { StreamAssembler } from "./assembler.js";
import type { StreamChunk } from "@test-harness/th-protocol";

describe("StreamAssembler", () => {
  // ── content chunks ──

  it("push content chunks, finish produces correct content", () => {
    const asm = new StreamAssembler();

    asm.push({ type: "content", data: "Hello " } as StreamChunk);
    asm.push({ type: "content", data: "world" } as StreamChunk);
    asm.push({ type: "content", data: "!" } as StreamChunk);

    const result = asm.finish("test-model");
    expect(result.content).toBe("Hello world!");
    expect(result.model).toBe("test-model");
  });

  // ── tool_call chunks ──

  it("push tool_call chunks, finish parses arguments", () => {
    const asm = new StreamAssembler();

    asm.push({
      type: "tool_call",
      data: { index: 0, id: "call_1", name: "get_page" },
    } as StreamChunk);

    asm.push({
      type: "tool_call",
      data: { index: 0, arguments: '{"url":' },
    } as StreamChunk);

    asm.push({
      type: "tool_call",
      data: { index: 0, arguments: '"https://example.com"}' },
    } as StreamChunk);

    const result = asm.finish("test-model");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]).toEqual({
      id: "call_1",
      name: "get_page",
      arguments: { url: "https://example.com" },
    });
    expect(result.finishReason).toBe("tool_calls");
  });

  it("multiple tool calls are sorted by index", () => {
    const asm = new StreamAssembler();

    // Push out of order
    asm.push({
      type: "tool_call",
      data: { index: 1, id: "call_2", name: "extract_text", arguments: '{"selector":"h1"}' },
    } as StreamChunk);

    asm.push({
      type: "tool_call",
      data: { index: 0, id: "call_1", name: "get_page", arguments: '{"url":"https://a.com"}' },
    } as StreamChunk);

    const result = asm.finish();
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls![0]!.name).toBe("get_page");
    expect(result.toolCalls![1]!.name).toBe("extract_text");
  });

  // ── partialContent ──

  it("partialContent grows as chunks arrive", () => {
    const asm = new StreamAssembler();

    expect(asm.partialContent).toBe("");

    asm.push({ type: "content", data: "Hello" } as StreamChunk);
    expect(asm.partialContent).toBe("Hello");

    asm.push({ type: "content", data: " world" } as StreamChunk);
    expect(asm.partialContent).toBe("Hello world");
  });

  // ── done ──

  it("done becomes true after 'done' chunk", () => {
    const asm = new StreamAssembler();

    expect(asm.done).toBe(false);

    asm.push({ type: "content", data: "text" } as StreamChunk);
    expect(asm.done).toBe(false);

    asm.push({ type: "done" } as StreamChunk);
    expect(asm.done).toBe(true);
  });

  // ── toolCallCount ──

  it("toolCallCount tracks correctly", () => {
    const asm = new StreamAssembler();

    expect(asm.toolCallCount).toBe(0);

    asm.push({
      type: "tool_call",
      data: { index: 0, id: "c1", name: "a", arguments: "{}" },
    } as StreamChunk);
    expect(asm.toolCallCount).toBe(1);

    // Same index updates, not adds
    asm.push({
      type: "tool_call",
      data: { index: 0, arguments: " more" },
    } as StreamChunk);
    expect(asm.toolCallCount).toBe(1);

    asm.push({
      type: "tool_call",
      data: { index: 1, id: "c2", name: "b", arguments: "{}" },
    } as StreamChunk);
    expect(asm.toolCallCount).toBe(2);
  });

  // ── finish with no content ──

  it("finish with no content returns empty string", () => {
    const asm = new StreamAssembler();
    const result = asm.finish();

    expect(result.content).toBe("");
    expect(result.toolCalls).toBeUndefined();
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  // ── invalid JSON in tool arguments ──

  it("handles invalid JSON in tool arguments gracefully", () => {
    const asm = new StreamAssembler();

    asm.push({
      type: "tool_call",
      data: { index: 0, id: "call_bad", name: "broken", arguments: "{invalid json!!!" },
    } as StreamChunk);

    const result = asm.finish();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]!.id).toBe("call_bad");
    expect(result.toolCalls![0]!.name).toBe("broken");
    // Should wrap raw string in _raw
    expect(result.toolCalls![0]!.arguments).toEqual({
      _raw: "{invalid json!!!",
    });
  });

  // ── usage chunk ──

  it("captures usage data from stream", () => {
    const asm = new StreamAssembler();

    asm.push({ type: "content", data: "text" } as StreamChunk);
    asm.push({
      type: "usage",
      data: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    } as StreamChunk);

    const result = asm.finish();
    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
  });

  // ── tool call fallback id/name ──

  it("uses fallback id and name when not provided", () => {
    const asm = new StreamAssembler();

    asm.push({
      type: "tool_call",
      data: { index: 3, arguments: "{}" },
    } as StreamChunk);

    const result = asm.finish();
    expect(result.toolCalls![0]!.id).toBe("call_3");
    expect(result.toolCalls![0]!.name).toBe("unknown");
  });
});
