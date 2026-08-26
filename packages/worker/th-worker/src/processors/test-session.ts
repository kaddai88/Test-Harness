/**
 * TestSessionJobProcessor — executes AI-driven website tests.
 *
 * DSH-style architecture:
 * 1. Load test session from persistence
 * 2. LLM generates test plan from user instructions
 * 3. Execute browser actions step by step
 * 4. Stream progress via WebSocket
 * 5. Save findings and results
 */
import type { Job, JobProcessor } from "@test-harness/th-queue";
import type { JobData } from "@test-harness/th-queue";
import type {
  DatabaseRepositories,
} from "@test-harness/th-persistence";
import type { LLMProvider } from "@test-harness/th-protocol";
import {
  AgentTurnStartedEvent,
  AgentStreamChunkEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  type ScanTarget,
  type ScanConfig,
  type Finding,
} from "@test-harness/th-protocol";
import { THContainer, valueProvider } from "@test-harness/th-core";
import { CrawlServiceDefinition, CrawlServiceImpl } from "@test-harness/th-crawl";
import { BrowserDriverDefinition, PuppeteerBrowserProvider } from "@test-harness/th-browser";
import { ToolRegistry, createAllTools, createReportFindingTool } from "@test-harness/th-tools";
import { AgentLoop } from "@test-harness/th-agent";
import fs from "node:fs";

export interface TestSessionJobProcessorOptions {
  repos: DatabaseRepositories;
  llm: LLMProvider;
  wsHandler?: { broadcast(event: { type: string; [key: string]: unknown }): void };
}

export class TestSessionJobProcessor implements JobProcessor<JobData> {
  private readonly repos: DatabaseRepositories;
  private readonly llm: LLMProvider;
  private readonly wsHandler?: { broadcast(event: { type: string; [key: string]: unknown }): void };

  constructor(opts: TestSessionJobProcessorOptions) {
    this.repos = opts.repos;
    this.llm = opts.llm;
    this.wsHandler = opts.wsHandler;
  }

  private broadcast(type: string, sessionId: string, data: Record<string, unknown>): void {
    this.wsHandler?.broadcast({ type, sessionId, ...data });
  }

  /** Launch a headless Chrome browser and register it in the container. */
  private async launchBrowser(container: THContainer): Promise<boolean> {
    try {
      const chromePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
      ];

      let executablePath: string | undefined;
      for (const path of chromePaths) {
        if (path && fs.existsSync(path)) {
          executablePath = path;
          break;
        }
      }

      const browserProvider = new PuppeteerBrowserProvider({ executablePath });
      container.register(BrowserDriverDefinition, valueProvider(browserProvider));
      await browserProvider.launch({ headless: true });
      return true;
    } catch (err) {
      console.log('[Worker] Browser not available:', err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async process(job: Job<JobData>): Promise<unknown> {
    const { sessionId, targetUrl, instructions } = job.data;

    if (!sessionId || !targetUrl) {
      throw new Error("test:execute requires sessionId and targetUrl in job data");
    }

    const session = await this.repos.scans.findById(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    // Update status to planning
    await this.repos.scans.updateStatus(sessionId, "planning");
    await this.repos.scans.updateStartedAt(sessionId);
    this.broadcast("session:status", sessionId, { status: "planning", message: "AI is generating test plan..." });

    const collectedFindings: Finding[] = [];
    const disposables: Array<{ dispose(): void }> = [];

    try {
      // ── Build container & dependencies ──
      const container = new THContainer();

      // Crawl service (required by crawl_page/extract_dom/list_links tools)
      const crawlService = new CrawlServiceImpl();
      container.register(CrawlServiceDefinition, valueProvider(crawlService));

      // Browser driver (if available)
      const browserReady = await this.launchBrowser(container);
      if (browserReady) {
        this.broadcast("session:status", sessionId, { status: "executing", message: "Browser ready" });
      } else {
        this.broadcast("session:status", sessionId, { status: "executing", message: "Crawling without browser" });
      }

      // ── Tool registry ──
      const registry = new ToolRegistry();
      for (const tool of createAllTools(container)) {
        registry.register(tool);
      }
      registry.register(createReportFindingTool(collectedFindings, sessionId));

      // ── Build ScanTarget / ScanConfig from session ──
      const targetConfig = (session.targetConfig ?? {}) as Record<string, unknown>;
      const rawConfig = (session.scanConfig ?? {}) as Record<string, unknown>;

      const target: ScanTarget = {
        url: session.targetUrl,
        scope: (targetConfig.scope as ScanTarget["scope"]) ?? "page",
      };

      const config: ScanConfig = {
        strategy: typeof rawConfig.strategy === "string" ? rawConfig.strategy : "adaptive",
        maxTurns: typeof rawConfig.maxTurns === "number" ? rawConfig.maxTurns : 20,
        instructions: session.metadata?.instructions as string | undefined ?? instructions,
        llm: {
          provider: this.llm.id,
          model:
            (rawConfig.model as string | undefined) ??
            process.env.QWEN_MODEL ??
            process.env.OPENAI_MODEL ??
            process.env.OLLAMA_MODEL ??
            "qwen-plus",
          temperature: 0.1,
        },
        crawl: {
          maxDepth: 3,
          maxPages: 20,
          respectRobots: true,
          rateLimit: 0,
        },
      };

      // ── Bridge Agent Loop events to WebSocket ──
      disposables.push(
        container.events.on(AgentTurnStartedEvent, (d) => {
          this.broadcast("agent:activity", sessionId, {
            kind: "turn_started",
            turn: d.turnNumber,
            timestamp: Date.now(),
          });
        }),
        container.events.on(AgentStreamChunkEvent, (d) => {
          this.broadcast("agent:activity", sessionId, {
            kind: "stream",
            partial: d.partialContent,
            done: d.done,
            turn: d.turnNumber,
            timestamp: Date.now(),
          });
        }),
        container.events.on(AgentToolCallEvent, (d) => {
          this.broadcast("agent:activity", sessionId, {
            kind: "tool_call",
            tool: d.toolName,
            input: d.input,
            turn: d.turnNumber,
            timestamp: Date.now(),
          });
        }),
        container.events.on(AgentToolResultEvent, (d) => {
          this.broadcast("agent:activity", sessionId, {
            kind: "tool_result",
            tool: d.toolName,
            success: d.success,
            turn: d.turnNumber,
            timestamp: Date.now(),
          });
        }),
      );

      // ── Run the Agent Loop ──
      const loop = new AgentLoop();
      const result = await loop.run({
        scanId: sessionId,
        target,
        config,
        llm: this.llm,
        toolRegistry: registry,
        eventBus: container.events,
        container,
      });

      // ── Persist results ──
      disposables.forEach((d) => d.dispose());

      const status =
        result.status === "failed"
          ? "failed"
          : result.status === "cancelled"
            ? "cancelled"
            : "completed";

      await this.repos.scans.updateStatus(sessionId, status);
      await this.repos.scans.updateCompletedAt(sessionId);
      await this.repos.scans.updateMetadata(sessionId, {
        summary: result.summary ?? "",
        findings: collectedFindings,
        turns: result.turns,
      });

      this.broadcast("scan:update", sessionId, { status });
      this.broadcast("scan:finding", sessionId, { findings: collectedFindings });
      this.broadcast("session:completed", sessionId, {
        status,
        summary: result.summary ?? "",
        findingCount: collectedFindings.length,
      });

      return {
        sessionId,
        status,
        summary: result.summary,
        findingCount: collectedFindings.length,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[TestSessionJobProcessor] Session ${sessionId} failed:`, errorMsg);
      disposables.forEach((d) => d.dispose());
      await this.repos.scans.updateStatus(sessionId, "failed");
      await this.repos.scans.updateCompletedAt(sessionId);
      this.broadcast("session:failed", sessionId, {
        status: "failed",
        error: errorMsg,
      });
      throw err;
    }
  }
}
