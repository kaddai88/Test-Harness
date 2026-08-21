/**
 * ScanJobProcessor — executes a full scan using the AgentLoop.
 *
 * Lifecycle:
 *  1. Load the scan from persistence
 *  2. Mark scan as "crawling" → "analyzing"
 *  3. Build a DI container with all required services
 *  4. Run the agent loop
 *  5. Persist detection results and events
 *  6. Generate a report
 *  7. Mark scan as "completed" or "failed"
 */
import type { Job, JobProcessor } from "@test-harness/th-queue";
import type { JobData } from "@test-harness/th-queue";
import type {
  DatabaseRepositories,
} from "@test-harness/th-persistence";
import type { LLMProvider } from "@test-harness/th-protocol";
import { AgentLoop } from "@test-harness/th-agent";
import { THContainer, EventBusImpl, valueProvider } from "@test-harness/th-core";
import { ToolsPlugin } from "@test-harness/th-tools";
import { CrawlPlugin } from "@test-harness/th-crawl";
import { DetectionPlugin2, DetectionRegistry, DetectionRunner } from "@test-harness/th-detection";
import { ReportGenerator } from "@test-harness/th-report";
import type { ScanConfig, ScanTarget, Finding } from "@test-harness/th-protocol";

export interface ScanJobProcessorOptions {
  repos: DatabaseRepositories;
  llm: LLMProvider;
}

export class ScanJobProcessor implements JobProcessor<JobData> {
  private readonly repos: DatabaseRepositories;
  private readonly llm: LLMProvider;

  constructor(opts: ScanJobProcessorOptions) {
    this.repos = opts.repos;
    this.llm = opts.llm;
  }

  async process(job: Job<JobData>): Promise<unknown> {
    const { scanId, targetUrl } = job.data;

    if (!scanId || !targetUrl) {
      throw new Error("scan:execute requires scanId and targetUrl in job data");
    }

    const scan = await this.repos.scans.findById(scanId);
    if (!scan) {
      throw new Error(`Scan "${scanId}" not found`);
    }

    // Transition to "analyzing"
    await this.repos.scans.updateStatus(scanId, "analyzing");
    await this.repos.scans.updateStartedAt(scanId);

    // Emit a status change event
    const seq = await this.repos.scanEvents.getNextSequence(scanId);
    await this.repos.scanEvents.create({
      scanId,
      eventType: "scan:status_changed",
      eventData: {
        scanId,
        previousStatus: scan.status,
        newStatus: "analyzing",
      },
      sequence: seq,
    });

    try {
      // Build the container with all plugins
      const container = new THContainer();
      const eventBus = container.getEventBus();

      const crawlPlugin = new CrawlPlugin();
      crawlPlugin.activate(container);

      const detectionRegistry = new DetectionRegistry();
      const toolsPlugin = new ToolsPlugin((id) => detectionRegistry.get(id));
      toolsPlugin.activate(container);

      const toolRegistry = toolsPlugin.getRegistry();
      if (!toolRegistry) {
        throw new Error("ToolRegistry was not initialized");
      }

      // Parse scan/target config from persisted row
      const target: ScanTarget = {
        url: targetUrl,
        scope: (scan.targetConfig?.scope as ScanTarget["scope"]) ?? "page",
      };

      const config: ScanConfig = {
        detections: job.data.detectionIds ?? (scan.scanConfig?.detections as string[]) ?? [],
        strategy: ((scan.scanConfig?.strategy as ScanConfig["strategy"]) ?? "adaptive") as
          | "sequential"
          | "parallel"
          | "adaptive",
        llm: { provider: "default", model: "default" },
        crawl: { maxDepth: 3, maxPages: 50, respectRobots: true, rateLimit: 2 },
        maxTurns: 20,
        timeout: 300_000,
      };

      // Run the agent loop
      const agent = new AgentLoop();
      const result = await agent.run({
        scanId,
        target,
        config,
        llm: this.llm,
        toolRegistry,
        eventBus,
        container,
        signal: job.data.config?.abortSignal as AbortSignal | undefined,
      });

      // Generate report
      const detectionResults = await this.repos.detectionResults.findByScanId(scanId);
      const reportGen = new ReportGenerator();
      const report = await reportGen.generate(
        {
          scanId,
          targetUrl,
          results: detectionResults.map((dr) => ({
            detectionId: dr.detectionId,
            category: dr.category as "security" | "performance" | "functionality" | "seo" | "accessibility",
            status: dr.status as "completed" | "failed" | "skipped",
            findings: dr.findings as unknown as Finding[],
            score: dr.score,
            metadata: {},
            startedAt: new Date(dr.startedAt ?? Date.now()),
            completedAt: new Date(dr.completedAt ?? Date.now()),
          })),
          startedAt: new Date(scan.startedAt ?? scan.createdAt),
          completedAt: new Date(),
        },
        "json"
      );

      await this.repos.reports.create({
        scanId,
        format: report.format,
        content: report.content,
        data: report.data,
      });

      // Final status
      const finalStatus = result.status === "completed" ? "completed" : "failed";
      await this.repos.scans.updateStatus(scanId, finalStatus);
      await this.repos.scans.updateCompletedAt(scanId);

      return {
        scanId,
        status: result.status,
        turns: result.turns,
        summary: result.summary,
      };
    } catch (err) {
      await this.repos.scans.updateStatus(scanId, "failed");
      await this.repos.scans.updateCompletedAt(scanId);
      throw err;
    }
  }
}
