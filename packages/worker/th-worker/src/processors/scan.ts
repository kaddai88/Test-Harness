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
 *  8. Broadcast progress via WebSocket
 */
import type { Job, JobProcessor } from "@test-harness/th-queue";
import type { JobData } from "@test-harness/th-queue";
import type {
  DatabaseRepositories,
} from "@test-harness/th-persistence";
import type { LLMProvider } from "@test-harness/th-protocol";
import { AgentLoop } from "@test-harness/th-agent";
import { THContainer, EventBusImpl, valueProvider } from "@test-harness/th-core";
import { ToolsPlugin, ToolRegistry } from "@test-harness/th-tools";
import { CrawlPlugin, CrawlServiceDefinition } from "@test-harness/th-crawl";
import { DetectionRegistry, DetectionRunner } from "@test-harness/th-detection";
import { SecurityHeadersDetector, SSLTLSDetector } from "@test-harness/th-detect-security";
import { PerformanceHeadersDetector, ResourceAnalyzer } from "@test-harness/th-detect-performance";
import { MetaTagsDetector, RobotsSitemapDetector } from "@test-harness/th-detect-seo";
import { ImageAccessibilityDetector, FormAccessibilityDetector, HeadingAccessibilityDetector } from "@test-harness/th-detect-a11y";
import { FormInteractionDetector, NavigationDetector, UIFunctionalityDetector } from "@test-harness/th-detect-functionality";
import { BrowserDriverDefinition, PuppeteerBrowserProvider } from "@test-harness/th-browser";
import { ReportGenerator } from "@test-harness/th-report";
import type { ScanConfig, ScanTarget, Finding, DetectionPlugin } from "@test-harness/th-protocol";

export interface ScanJobProcessorOptions {
  repos: DatabaseRepositories;
  llm: LLMProvider;
  detectionRegistry?: DetectionRegistry;
  wsHandler?: { broadcast(event: { type: string; [key: string]: unknown }): void };
}

export class ScanJobProcessor implements JobProcessor<JobData> {
  private readonly repos: DatabaseRepositories;
  private readonly llm: LLMProvider;
  private readonly detectionRegistry: DetectionRegistry;
  private readonly wsHandler?: { broadcast(event: { type: string; [key: string]: unknown }): void };

  constructor(opts: ScanJobProcessorOptions) {
    this.repos = opts.repos;
    this.llm = opts.llm;
    this.detectionRegistry = opts.detectionRegistry ?? new DetectionRegistry();
    this.wsHandler = opts.wsHandler;
  }

  private broadcast(type: string, scanId: string, data: Record<string, unknown>): void {
    this.wsHandler?.broadcast({ type, scanId, ...data });
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

    // Transition to "crawling"
    await this.repos.scans.updateStatus(scanId, "crawling");
    await this.repos.scans.updateStartedAt(scanId);
    this.broadcast("scan:progress", scanId, { status: "crawling", progress: 5, message: "Starting scan..." });

    // Emit status change event
    const seq = await this.repos.scanEvents.getNextSequence(scanId);
    await this.repos.scanEvents.create({
      scanId,
      eventType: "scan:status_changed",
      eventData: { scanId, previousStatus: scan.status, newStatus: "crawling" },
      sequence: seq,
    });

    try {
      // Build container with all plugins
      const container = new THContainer();
      const eventBus = container.getEventBus();

      // Crawl service
      const crawlPlugin = new CrawlPlugin();
      crawlPlugin.activate(container);

      // Browser driver (optional)
      try {
        const browserProvider = new PuppeteerBrowserProvider();
        container.register(BrowserDriverDefinition, valueProvider(browserProvider));
        await browserProvider.launch({ headless: true });
        this.broadcast("scan:progress", scanId, { status: "crawling", progress: 10, message: "Browser ready" });
      } catch {
        // Browser not available — continue without it
      }

      // Tools plugin with detection lookup
      const toolsPlugin = new ToolsPlugin((id) => this.detectionRegistry.get(id));
      toolsPlugin.activate(container);

      const toolRegistry = toolsPlugin.getRegistry();
      if (!toolRegistry) {
        throw new Error("ToolRegistry was not initialized");
      }

      this.broadcast("scan:progress", scanId, {
        status: "crawling",
        progress: 15,
        message: `Loaded ${toolRegistry.size} tools, ${this.detectionRegistry.size} detections`,
      });

      // Parse scan/target config
      const target: ScanTarget = {
        url: targetUrl,
        scope: (scan.targetConfig?.scope as ScanTarget["scope"]) ?? "page",
      };

      const config: ScanConfig = {
        detections: this.detectionRegistry.listIds(),
        strategy: ((scan.scanConfig?.strategy as ScanConfig["strategy"]) ?? "adaptive") as
          | "sequential" | "parallel" | "adaptive",
        llm: { provider: this.llm.id, model: process.env.QWEN_MODEL ?? "qwen3.7-plus" },
        crawl: { maxDepth: 3, maxPages: 50, respectRobots: true, rateLimit: 2 },
        maxTurns: 20,
        timeout: 300_000,
      };

      // Run agent loop
      this.broadcast("scan:progress", scanId, { status: "analyzing", progress: 20, message: "Running AI agent..." });

      const agent = new AgentLoop();
      const result = await agent.run({
        scanId,
        target,
        config,
        llm: this.llm,
        toolRegistry,
        eventBus,
        container,
      });

      // Close browser
      try {
        const browser = container.get(BrowserDriverDefinition);
        await browser.close();
      } catch {
        // Browser not available
      }

      // Generate report
      this.broadcast("scan:progress", scanId, { status: "reporting", progress: 90, message: "Generating report..." });

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

      this.broadcast("scan:completed", scanId, {
        status: finalStatus,
        summary: result.summary,
        progress: 100,
        message: `Scan ${finalStatus}`,
      });

      return {
        scanId,
        status: result.status,
        turns: result.turns,
        summary: result.summary,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[ScanJobProcessor] Scan ${scanId} failed:`, errorMsg);
      await this.repos.scans.updateStatus(scanId, "failed");
      await this.repos.scans.updateCompletedAt(scanId);
      this.broadcast("scan:completed", scanId, {
        status: "failed",
        error: errorMsg,
        progress: 100,
      });
      throw err;
    }
  }

  /** Register all detection plugins into the registry */
  private registerAllDetections(registry: DetectionRegistry): void {
    // Security
    registry.register(new SecurityHeadersDetector());
    registry.register(new SSLTLSDetector());
    // Performance
    registry.register(new PerformanceHeadersDetector());
    registry.register(new ResourceAnalyzer());
    // SEO
    registry.register(new MetaTagsDetector());
    registry.register(new RobotsSitemapDetector());
    // Accessibility
    registry.register(new ImageAccessibilityDetector());
    registry.register(new FormAccessibilityDetector());
    registry.register(new HeadingAccessibilityDetector());
    // Functionality
    registry.register(new FormInteractionDetector());
    registry.register(new NavigationDetector());
    registry.register(new UIFunctionalityDetector());
  }
}
