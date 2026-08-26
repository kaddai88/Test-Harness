/**
 * WorkerBootstrap — wires the queue, processors, and persistence together.
 *
 * DSH-style: AI-driven test sessions, not fixed detection plugins.
 */
import type { TaskQueue } from "@test-harness/th-queue";
import type { DatabaseRepositories } from "@test-harness/th-persistence";
import type { LLMProvider } from "@test-harness/th-protocol";
import { TestSessionJobProcessor } from "./processors/test-session.js";

export interface WebSocketHandlerLike {
  broadcast(event: { type: string; [key: string]: unknown }): void;
}

export interface WorkerBootstrapOptions {
  queue: TaskQueue;
  repos: DatabaseRepositories;
  llm: LLMProvider;
  wsHandler?: WebSocketHandlerLike;
}

export class WorkerBootstrap {
  private readonly queue: TaskQueue;
  private readonly repos: DatabaseRepositories;
  private readonly llm: LLMProvider;
  private readonly wsHandler?: WebSocketHandlerLike;
  private started = false;

  constructor(opts: WorkerBootstrapOptions) {
    this.queue = opts.queue;
    this.repos = opts.repos;
    this.llm = opts.llm;
    this.wsHandler = opts.wsHandler;
  }

  /** Register all processors and begin consuming jobs. */
  start(): void {
    if (this.started) return;
    this.started = true;

    const testProcessor = new TestSessionJobProcessor({
      repos: this.repos,
      llm: this.llm,
      wsHandler: this.wsHandler,
    });

    this.queue.process("test:execute", testProcessor);
  }

  /** Stop consuming jobs and shut down. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.queue.close();
  }
}
