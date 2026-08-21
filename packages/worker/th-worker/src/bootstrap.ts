/**
 * WorkerBootstrap — wires the queue, processors, and persistence together.
 *
 * Call `start()` to begin consuming jobs; call `stop()` to drain and shut down.
 */
import type { TaskQueue } from "@test-harness/th-queue";
import type { DatabaseRepositories } from "@test-harness/th-persistence";
import type { LLMProvider } from "@test-harness/th-protocol";
import { DetectionRegistry } from "@test-harness/th-detection";
import { ScanJobProcessor } from "./processors/scan.js";
import { DetectionJobProcessor } from "./processors/detection.js";

export interface WorkerBootstrapOptions {
  queue: TaskQueue;
  repos: DatabaseRepositories;
  llm: LLMProvider;
  detectionRegistry?: DetectionRegistry;
}

export class WorkerBootstrap {
  private readonly queue: TaskQueue;
  private readonly repos: DatabaseRepositories;
  private readonly llm: LLMProvider;
  private readonly detectionRegistry: DetectionRegistry;
  private started = false;

  constructor(opts: WorkerBootstrapOptions) {
    this.queue = opts.queue;
    this.repos = opts.repos;
    this.llm = opts.llm;
    this.detectionRegistry = opts.detectionRegistry ?? new DetectionRegistry();
  }

  /** Register all processors and begin consuming jobs. */
  start(): void {
    if (this.started) return;
    this.started = true;

    const scanProcessor = new ScanJobProcessor({
      repos: this.repos,
      llm: this.llm,
    });

    const detectionProcessor = new DetectionJobProcessor({
      repos: this.repos,
      registry: this.detectionRegistry,
    });

    this.queue.process("scan:execute", scanProcessor);
    this.queue.process("scan:detect", detectionProcessor);
  }

  /** Stop consuming jobs and shut down. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.queue.close();
  }

  /** Expose the detection registry so callers can register plugins. */
  getDetectionRegistry(): DetectionRegistry {
    return this.detectionRegistry;
  }
}
