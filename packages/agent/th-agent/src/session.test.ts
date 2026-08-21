/**
 * Tests for SessionLog — append-only event log for the agent loop.
 */
import { describe, it, expect } from "vitest";
import { SessionLog } from "./session.js";
import type {
  UserMessageEvent,
  AssistantMessageEvent,
  ToolResultEvent,
  TurnStartEvent,
  StepStartEvent,
  ToolCallEvent,
} from "./session.js";

describe("SessionLog", () => {
  // ── append ──

  it("append creates events with incrementing seq numbers", () => {
    const log = new SessionLog();

    const e1 = log.append("turn/start", { turn: 1 } as TurnStartEvent);
    const e2 = log.append("step/start", { turn: 1, step: 1 } as StepStartEvent);
    const e3 = log.append("turn/start", { turn: 2 } as TurnStartEvent);

    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e3.seq).toBe(3);
    expect(log.length).toBe(3);
  });

  it("append events have timestamps", () => {
    const log = new SessionLog();
    const e = log.append("turn/start", { turn: 1 } as TurnStartEvent);
    expect(typeof e.timestamp).toBe("number");
    expect(e.timestamp).toBeGreaterThan(0);
  });

  // ── deriveMessages ──

  it("deriveMessages produces correct message history", () => {
    const log = new SessionLog();

    log.append("user/message", { turn: 1, content: "Hello" } as UserMessageEvent);
    log.append("assistant/message", {
      turn: 1,
      step: 1,
      content: "Hi there!",
    } as AssistantMessageEvent);
    log.append("user/message", { turn: 2, content: "How are you?" } as UserMessageEvent);

    const messages = log.deriveMessages();

    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: "user", content: "Hello" });
    expect(messages[1]).toEqual({ role: "assistant", content: "Hi there!" });
    expect(messages[2]).toEqual({ role: "user", content: "How are you?" });
  });

  it("deriveMessages includes system prompt when provided", () => {
    const log = new SessionLog();
    log.append("user/message", { turn: 1, content: "Hi" } as UserMessageEvent);

    const messages = log.deriveMessages("You are a helpful assistant.");

    expect(messages[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant.",
    });
    expect(messages[1]).toEqual({ role: "user", content: "Hi" });
    expect(messages).toHaveLength(2);
  });

  it("deriveMessages includes tool results", () => {
    const log = new SessionLog();
    log.append("tool/result", {
      turn: 1,
      step: 1,
      callId: "call_1",
      name: "get_page",
      success: true,
      data: { url: "https://example.com" },
      duration: 150,
    } as ToolResultEvent);

    const messages = log.deriveMessages();

    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("tool");
    expect(messages[0]!.toolCallId).toBe("call_1");
    expect(messages[0]!.name).toBe("get_page");
    expect(JSON.parse(messages[0]!.content)).toEqual({ url: "https://example.com" });
  });

  it("deriveMessages handles failed tool results", () => {
    const log = new SessionLog();
    log.append("tool/result", {
      turn: 1,
      step: 1,
      callId: "call_2",
      name: "get_page",
      success: false,
      error: "Network error",
      duration: 5000,
    } as ToolResultEvent);

    const messages = log.deriveMessages();
    expect(messages[0]!.content).toBe("Error: Network error");
  });

  // ── getEventsByType ──

  it("getEventsByType filters correctly", () => {
    const log = new SessionLog();
    log.append("turn/start", { turn: 1 } as TurnStartEvent);
    log.append("user/message", { turn: 1, content: "Hello" } as UserMessageEvent);
    log.append("turn/start", { turn: 2 } as TurnStartEvent);
    log.append("user/message", { turn: 2, content: "World" } as UserMessageEvent);
    log.append("step/start", { turn: 1, step: 1 } as StepStartEvent);

    const turns = log.getEventsByType("turn/start");
    expect(turns).toHaveLength(2);

    const users = log.getEventsByType("user/message");
    expect(users).toHaveLength(2);

    const steps = log.getEventsByType("step/start");
    expect(steps).toHaveLength(1);

    const tools = log.getEventsByType("tool/call");
    expect(tools).toHaveLength(0);
  });

  // ── getLastEvent ──

  it("getLastEvent returns most recent matching event", () => {
    const log = new SessionLog();
    log.append("turn/start", { turn: 1 } as TurnStartEvent);
    log.append("turn/start", { turn: 2 } as TurnStartEvent);
    log.append("turn/start", { turn: 3 } as TurnStartEvent);

    const last = log.getLastEvent("turn/start");
    expect(last).toBeDefined();
    expect((last!.data as TurnStartEvent).turn).toBe(3);
  });

  it("getLastEvent returns undefined when no matching events", () => {
    const log = new SessionLog();
    log.append("user/message", { turn: 1, content: "Hi" } as UserMessageEvent);

    const last = log.getLastEvent("turn/start");
    expect(last).toBeUndefined();
  });

  // ── getSummary ──

  it("getSummary returns correct counts", () => {
    const log = new SessionLog();
    log.append("turn/start", { turn: 1 } as TurnStartEvent);
    log.append("step/start", { turn: 1, step: 1 } as StepStartEvent);
    log.append("tool/call", {
      turn: 1, step: 1, callId: "c1", name: "get", arguments: {}
    } as ToolCallEvent);
    log.append("tool/call", {
      turn: 1, step: 1, callId: "c2", name: "post", arguments: {}
    } as ToolCallEvent);
    log.append("turn/start", { turn: 2 } as TurnStartEvent);

    const summary = log.getSummary();
    expect(summary.totalEvents).toBe(5);
    expect(summary.turns).toBe(2);
    expect(summary.steps).toBe(1);
    expect(summary.toolCalls).toBe(2);
    expect(summary.duration).toBeGreaterThanOrEqual(0);
  });

  // ── toJSON ──

  it("toJSON returns copy of events", () => {
    const log = new SessionLog();
    log.append("turn/start", { turn: 1 } as TurnStartEvent);
    log.append("turn/start", { turn: 2 } as TurnStartEvent);

    const json = log.toJSON();
    expect(json).toHaveLength(2);

    // Verify it's a copy, not a reference
    json.push({} as any);
    expect(log.length).toBe(2);
  });

  // ── clear ──

  it("clear resets the log", () => {
    const log = new SessionLog();
    log.append("turn/start", { turn: 1 } as TurnStartEvent);
    log.append("user/message", { turn: 1, content: "Hi" } as UserMessageEvent);
    expect(log.length).toBe(2);

    log.clear();
    expect(log.length).toBe(0);
    expect(log.getEvents()).toHaveLength(0);

    // Seq numbers reset
    const e = log.append("turn/start", { turn: 1 } as TurnStartEvent);
    expect(e.seq).toBe(1);
  });
});
