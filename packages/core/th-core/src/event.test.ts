/**
 * Tests for EventBusImpl — typed pub/sub with multiple dispatch modes.
 */
import { describe, it, expect, vi } from "vitest";
import { EventBusImpl } from "./event.js";
import type { EventDefinition } from "@test-harness/th-protocol";
import { defineEvent } from "@test-harness/th-protocol";

function makeEvent<T>(name: string): EventDefinition<T> {
  return defineEvent<T>(name);
}

describe("EventBusImpl", () => {
  // ── emit / on ──

  it("emit/on: basic pub-sub works", async () => {
    const bus = new EventBusImpl();
    const ev = makeEvent<string>("test:basic");
    const handler = vi.fn();

    bus.on(ev, handler);
    await bus.emit(ev, "hello");

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith("hello");
  });

  it("emit/on: multiple handlers all fire", async () => {
    const bus = new EventBusImpl();
    const ev = makeEvent<number>("test:multi");
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on(ev, h1);
    bus.on(ev, h2);
    await bus.emit(ev, 42);

    expect(h1).toHaveBeenCalledWith(42);
    expect(h2).toHaveBeenCalledWith(42);
  });

  it("emit: no handlers does not throw", async () => {
    const bus = new EventBusImpl();
    const ev = makeEvent<string>("test:none");
    await expect(bus.emit(ev, "data")).resolves.toBeUndefined();
  });

  // ── once ──

  it("once: fires only once then auto-removes", async () => {
    const bus = new EventBusImpl();
    const ev = makeEvent<string>("test:once");
    const handler = vi.fn();

    bus.once(ev, handler);

    await bus.emit(ev, "first");
    await bus.emit(ev, "second");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("first");
  });

  // ── waterfall ──

  it("waterfall: chain of handlers, each modifies data", async () => {
    const bus = new EventBusImpl();
    const ev = makeEvent<number>("test:waterfall");

    // Waterfall chain runs in reverse registration order:
    // last registered (subs[1]) runs first, first registered (subs[0]) runs last.
    bus.onWaterfall(ev, async (data, next) => {
      // subs[0] — runs SECOND: adds 10 to result from inner chain
      const result = await next(data);
      return result + 10;
    });

    bus.onWaterfall(ev, async (data, next) => {
      // subs[1] — runs FIRST: increments data, delegates, doubles result
      const result = await next(data + 1);
      return result * 2;
    });

    // dispatch(5):
    //   subs[1](5): next(5+1=6) → subs[0](6): next(6) → returns 6; 6+10=16
    //   subs[1]: 16*2 = 32
    const result = await bus.waterfall(ev, 5);
    expect(result).toBe(32);
  });

  it("waterfall: handler can short-circuit by not calling next", async () => {
    const bus = new EventBusImpl();
    const ev = makeEvent<string>("test:shortcircuit");
    const firstHandler = vi.fn();

    // Waterfall chain runs in reverse registration order:
    // last registered handler runs first, first registered runs last.
    // So to test short-circuit, the LAST registered handler must skip next().
    bus.onWaterfall(ev, async (data, next) => {
      // This runs SECOND (index 0) — should not execute if short-circuited
      firstHandler();
      return (await next(data)) + "!";
    });

    bus.onWaterfall(ev, async (_data, _next) => {
      // This runs FIRST (index 1, last registered) — short-circuits
      return "short-circuited";
    });

    const result = await bus.waterfall(ev, "original");
    expect(result).toBe("short-circuited");
    expect(firstHandler).not.toHaveBeenCalled();
  });

  it("waterfall: returns initial value when no handlers", async () => {
    const bus = new EventBusImpl();
    const ev = makeEvent<number>("test:waterfall-empty");
    const result = await bus.waterfall(ev, 99);
    expect(result).toBe(99);
  });

  // ── serial ──

  it("serial: handlers run in order, results collected", async () => {
    const bus = new EventBusImpl();
    const ev = makeEvent<string>("test:serial");
    const order: number[] = [];

    bus.onSerial(ev, async (data) => {
      order.push(1);
      return `first:${data}`;
    });

    bus.onSerial(ev, async (data) => {
      order.push(2);
      return `second:${data}`;
    });

    bus.onSerial(ev, (data) => {
      order.push(3);
      return `third:${data}`;
    });

    const results = await bus.serial<string, string>(ev, "input");

    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual([
      "first:input",
      "second:input",
      "third:input",
    ]);
  });

  // ── parallel ──

  it("parallel: all handlers fire concurrently", async () => {
    const bus = new EventBusImpl();
    const ev = makeEvent<number>("test:parallel");
    const results: number[] = [];

    bus.on(ev, async (data) => {
      await new Promise((r) => setTimeout(r, 20));
      results.push(1);
    });

    bus.on(ev, async (data) => {
      await new Promise((r) => setTimeout(r, 5));
      results.push(2);
    });

    await bus.parallel(ev, 0);

    // Both should have completed — concurrent means the faster one finishes first
    expect(results).toContain(1);
    expect(results).toContain(2);
    expect(results).toHaveLength(2);
  });

  // ── dispose ──

  it("dispose: removes subscription", async () => {
    const bus = new EventBusImpl();
    const ev = makeEvent<string>("test:dispose");
    const handler = vi.fn();

    const sub = bus.on(ev, handler);
    await bus.emit(ev, "before");
    expect(handler).toHaveBeenCalledTimes(1);

    sub.dispose();
    await bus.emit(ev, "after");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // ── clear ──

  it("clear: removes all subscriptions for an event", async () => {
    const bus = new EventBusImpl();
    const ev1 = makeEvent<string>("test:clear1");
    const ev2 = makeEvent<string>("test:clear2");
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on(ev1, h1);
    bus.on(ev2, h2);

    bus.clear(ev1);

    await bus.emit(ev1, "data");
    await bus.emit(ev2, "data");

    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("clear: with no argument removes everything", async () => {
    const bus = new EventBusImpl();
    const ev1 = makeEvent<string>("test:clearAll1");
    const ev2 = makeEvent<string>("test:clearAll2");
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on(ev1, h1);
    bus.on(ev2, h2);

    bus.clear();

    await bus.emit(ev1, "data");
    await bus.emit(ev2, "data");

    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });
});
