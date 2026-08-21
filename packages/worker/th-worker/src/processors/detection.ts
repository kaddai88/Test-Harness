/**
 * DetectionJobProcessor — runs a single detection plugin against a scan target.
 *
 * This is the simpler building block for scans that use the "parallel" strategy
 * instead of the full agent loop.
 */
import type { Job, JobProcessor, JobData } from "@test-harness/th-queue";
import type { DatabaseRepositories } from "@test-harness/th-persistence";
import { DetectionRegistry, DetectionRunner } from "@test-harness/th-detection";
import type {
  DetectionPlugin,
  DetectionTarget,
  DetectionContext,
} from "@test-harness/th-protocol";

export interface DetectionJobData extends JobData {
  detectionId: string;
}

export interface DetectionJobProcessorOptions {
  repos: DatabaseRepositories;
  registry: DetectionRegistry;
}

export class DetectionJobProcessor implements JobProcessor<DetectionJobData> {
  private readonly repos: DatabaseRepositories;
  private readonly registry: DetectionRegistry;
  private readonly runner: DetectionRunner;

  constructor(opts: DetectionJobProcessorOptions) {
    this.repos = opts.repos;
    this.registry = opts.registry;
    this.runner = new DetectionRunner();
  }

  async process(job: Job<DetectionJobData>): Promise<unknown> {
    const { scanId, targetUrl, detectionId } = job.data;

    if (!scanId || !targetUrl || !detectionId) {
      throw new Error(
        "scan:detect requires scanId, targetUrl, and detectionId in job data"
      );
    }

    const plugin: DetectionPlugin | undefined = this.registry.get(detectionId);
    if (!plugin) {
      throw new Error(`Detection plugin "${detectionId}" not registered`);
    }

    // Persist a detection result row in "running" state
    const resultRow = await this.repos.detectionResults.create({
      scanId,
      detectionId,
      category: plugin.category,
      status: "running",
      findings: [],
    });

    const target: DetectionTarget = {
      url: targetUrl,
      scope: "page",
    };

    const context: DetectionContext = {
      scanId,
      config: job.data.config ?? {},
      abortSignal: new AbortController().signal,
    };

    // Emit detection:started event
    const seq = await this.repos.scanEvents.getNextSequence(scanId);
    await this.repos.scanEvents.create({
      scanId,
      eventType: "detection:started",
      eventData: { scanId, detectionId },
      sequence: seq,
    });

    const result = await this.runner.run(plugin, target, context);

    // Update the row with results
    await this.repos.detectionResults.updateStatus(resultRow.id, result.status);
    await this.repos.detectionResults.updateCompletedAt(resultRow.id);

    // Emit detection:completed event
    const seq2 = await this.repos.scanEvents.getNextSequence(scanId);
    await this.repos.scanEvents.create({
      scanId,
      eventType: "detection:completed",
      eventData: {
        scanId,
        detectionId,
        result: {
          status: result.status,
          findingCount: result.findings.length,
          score: result.score,
        },
      },
      sequence: seq2,
    });

    return {
      detectionId: result.detectionId,
      status: result.status,
      findingCount: result.findings.length,
      score: result.score,
    };
  }
}
