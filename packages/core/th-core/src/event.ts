/**
 * Event bus — typed pub/sub with multiple dispatch modes.
 *
 * Inspired by DSH's Cordis event system with four dispatch modes:
 * - emit: fire-and-forget notification (no await, no return)
 * - waterfall: around-middleware chain — each handler receives (data, next),
 *   must call next() to delegate, return without next() to short-circuit
 * - serial: sequential listeners with aggregated results (awaited, ordered)
 * - parallel: concurrent listeners (awaited, no return)
 *
 * Registration is via `on()`, `onWaterfall()`, and `onSerial()`.
 * All registrations return a Disposable for cleanup.
 */
import type { EventDefinition } from "@test-harness/th-protocol";

/** A disposable subscription — call dispose() to unsubscribe */
export interface Disposable {
  dispose(): void;
}

/** Handler for emit/parallel events */
export type EventHandler<T> = (data: T) => void | Promise<void>;

/**
 * Handler for waterfall events — around-middleware pattern.
 * Must call `next(data)` to delegate to the next handler.
 * Return without calling `next()` to short-circuit the chain.
 * The return value becomes the waterfall result.
 */
export type WaterfallHandler<T> = (
  data: T,
  next: (data: T) => Promise<T>
) => Promise<T>;

/** Handler for serial events — runs in order, result collected */
export type SerialHandler<T, R = void> = (data: T) => Promise<R> | R;

/** Internal subscription record */
interface Subscription {
  event: EventDefinition<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => any;
  mode: "on" | "once" | "waterfall" | "serial";
  once: boolean;
}

/**
 * EventBus implementation.
 *
 * Each container gets its own EventBus. Supports four dispatch modes:
 * - emit(): fire-and-forget, no await
 * - waterfall(): around-middleware chain, returns transformed data
 * - serial(): sequential handlers, returns collected results
 * - parallel(): concurrent handlers, no return
 *
 * Listeners register via on() (emit), onWaterfall(), or onSerial().
 */
export class EventBusImpl {
  private subscriptions = new Map<symbol, Subscription[]>();
  private parent?: EventBusImpl;

  constructor(parent?: EventBusImpl) {
    this.parent = parent;
  }

  /** Fire-and-forget notification */
  async emit<T>(event: EventDefinition<T>, data: T): Promise<void> {
    const subs = this.subscriptions.get(event.id) ?? [];
    const toRemove: Subscription[] = [];

    for (const sub of subs) {
      if (sub.mode === "waterfall" || sub.mode === "serial") continue;
      await (sub.handler as EventHandler<T>)(data);
      if (sub.once) toRemove.push(sub);
    }

    for (const sub of toRemove) {
      this.removeSubscription(event.id, sub);
    }
  }

  /** Subscribe to an event (emit/parallel dispatch) */
  on<T>(
    event: EventDefinition<T>,
    handler: EventHandler<T>
  ): Disposable {
    return this.addSubscription(event, handler, "on", false);
  }

  /** Subscribe to an event — fires at most once */
  once<T>(
    event: EventDefinition<T>,
    handler: EventHandler<T>
  ): Disposable {
    return this.addSubscription(event, handler, "once", true);
  }

  /**
   * Register a waterfall handler (around-middleware pattern).
   * Each handler receives (data, next). Call next(data) to delegate
   * to the next handler. Return without next() to short-circuit.
   *
   * Example:
   *   bus.onWaterfall(AgentRequestEvent, async (config, next) => {
   *     config.temperature = 0.5;  // modify before next handler
   *     const result = await next(config);  // delegate to next
   *     return result;  // can also modify the result
   *   });
   */
  onWaterfall<T>(
    event: EventDefinition<T>,
    handler: WaterfallHandler<T>
  ): Disposable {
    return this.addSubscription(event, handler, "waterfall", false);
  }

  /**
   * Register a serial handler — runs in registration order,
   * results collected into an array.
   */
  onSerial<T, R = void>(
    event: EventDefinition<T>,
    handler: SerialHandler<T, R>
  ): Disposable {
    return this.addSubscription(event, handler, "serial", false);
  }

  /**
   * Waterfall dispatch — around-middleware chain.
   * Handlers are called in registration order. Each receives (data, next).
   * The final return value is the result of the last handler or the
   * default value if no handlers are registered.
   */
  async waterfall<T>(
    event: EventDefinition<T>,
    initial: T
  ): Promise<T> {
    const subs = (this.subscriptions.get(event.id) ?? []).filter(
      (s) => s.mode === "waterfall"
    );

    // Build the chain from last to first (so first registered runs first)
    let index = subs.length - 1;
    const dispatch = async (data: T): Promise<T> => {
      if (index < 0) return data;
      const sub = subs[index]!;
      index--;
      return (sub.handler as WaterfallHandler<T>)(data, dispatch);
    };

    return dispatch(initial);
  }

  /**
   * Serial dispatch — handlers run in registration order,
   * results collected into an array.
   */
  async serial<T, R = void>(
    event: EventDefinition<T>,
    data: T
  ): Promise<R[]> {
    const results: R[] = [];
    const subs = (this.subscriptions.get(event.id) ?? []).filter(
      (s) => s.mode === "serial"
    );
    for (const sub of subs) {
      results.push(await (sub.handler as SerialHandler<T, R>)(data));
    }
    return results;
  }

  /** Parallel dispatch — all handlers fire concurrently */
  async parallel<T>(
    event: EventDefinition<T>,
    data: T
  ): Promise<void> {
    const subs = (this.subscriptions.get(event.id) ?? []).filter(
      (s) => s.mode === "on" || s.mode === "once"
    );
    await Promise.all(
      subs.map((sub) =>
        (sub.handler as EventHandler<T>)(data)
      )
    );
  }

  /** Remove all subscriptions for a specific event */
  clear(event?: EventDefinition<unknown>): void {
    if (event) {
      this.subscriptions.delete(event.id);
    } else {
      this.subscriptions.clear();
    }
  }

  private addSubscription<T>(
    event: EventDefinition<T>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (...args: any[]) => any,
    mode: "on" | "once" | "waterfall" | "serial",
    once: boolean
  ): Disposable {
    const sub: Subscription = {
      event: event as EventDefinition<unknown>,
      handler,
      mode,
      once,
    };
    const subs = this.subscriptions.get(event.id) ?? [];
    subs.push(sub);
    this.subscriptions.set(event.id, subs);

    return {
      dispose: () => this.removeSubscription(event.id, sub),
    };
  }

  private removeSubscription(
    eventId: symbol,
    sub: Subscription
  ): void {
    const subs = this.subscriptions.get(eventId);
    if (!subs) return;
    const idx = subs.indexOf(sub);
    if (idx >= 0) subs.splice(idx, 1);
    if (subs.length === 0) this.subscriptions.delete(eventId);
  }
}
