/**
 * Scan command — orchestrates a full website scan via the Agent Loop.
 *
 * This is the main entry point for CLI usage:
 *   th scan https://example.com
 */
import { THContainer, EventBusImpl, valueProvider } from "@test-harness/th-core";
import { LLMProviderService } from "@test-harness/th-llm";
import { OllamaProvider } from "@test-harness/th-llm-ollama";
import { QwenProvider } from "@test-harness/th-llm-qwen";
import { CrawlPlugin, CrawlServiceDefinition } from "@test-harness/th-crawl";
import { ToolsPlugin, ToolRegistry } from "@test-harness/th-tools";
import {
  DetectionRegistry,
  DetectionRunner,
} from "@test-harness/th-detection";
import { SecurityHeadersDetector, SSLTLSDetector } from "@test-harness/th-detect-security";
import { PerformanceHeadersDetector, ResourceAnalyzer } from "@test-harness/th-detect-performance";
import { MetaTagsDetector, RobotsSitemapDetector } from "@test-harness/th-detect-seo";
import { ImageAccessibilityDetector, FormAccessibilityDetector, HeadingAccessibilityDetector } from "@test-harness/th-detect-a11y";
import { FormInteractionDetector, NavigationDetector, UIFunctionalityDetector } from "@test-harness/th-detect-functionality";
import { BrowserDriverDefinition, PuppeteerBrowserProvider } from "@test-harness/th-browser";
import { AgentLoop } from "@test-harness/th-agent";
import type {
  LLMProvider,
  DetectionPlugin,
  ScanConfig,
  ScanTarget,
  Finding,
  DetectionResult,
} from "@test-harness/th-protocol";
import { AgentStreamChunkEvent } from "@test-harness/th-protocol";
import { terminal } from "../output/terminal.js";
import { createCrawlPageTool } from "@test-harness/th-tools";
import { createExtractDomTool } from "@test-harness/th-tools";
import { createHttpRequestTool } from "@test-harness/th-tools";
import { createListLinksTool } from "@test-harness/th-tools";
import { createClickElementTool } from "@test-harness/th-tools";
import { createFillFormTool } from "@test-harness/th-tools";
import { createNavigateToTool } from "@test-harness/th-tools";
import { createTakeScreenshotTool } from "@test-harness/th-tools";
import { createMeasurePerformanceTool } from "@test-harness/th-tools";
import { createAssertVisibleTool } from "@test-harness/th-tools";
import { createAssertTextTool } from "@test-harness/th-tools";

export interface ScanCommandOptions {
  /** LLM provider: ollama, openai, deepseek */
  provider?: string;
  /** Model name */
  model?: string;
  /** Ollama base URL */
  ollamaUrl?: string;
  /** Max agent turns */
  maxTurns?: number;
  /** Scan scope */
  scope?: "page" | "site" | "domain";
  /** Disable browser tools (no Puppeteer) */
  noBrowser?: boolean;
}

export async function runScan(
  url: string,
  options: ScanCommandOptions = {}
): Promise<void> {
  terminal.banner();
  terminal.info(`Target: ${url}`);
  terminal.info(`Scope: ${options.scope ?? "page"}`);
  console.log();

  // ─── 1. Bootstrap the plugin container ───
  const container = new THContainer();
  const eventBus = container.events;

  // Register core services
  const crawlPlugin = new CrawlPlugin();
  crawlPlugin.activate(container);

  // Register detection plugins
  const detectionRegistry = new DetectionRegistry();
  // Security
  detectionRegistry.register(new SecurityHeadersDetector());
  detectionRegistry.register(new SSLTLSDetector());
  // Performance
  detectionRegistry.register(new PerformanceHeadersDetector());
  detectionRegistry.register(new ResourceAnalyzer());
  // SEO
  detectionRegistry.register(new MetaTagsDetector());
  detectionRegistry.register(new RobotsSitemapDetector());
  // Accessibility
  detectionRegistry.register(new ImageAccessibilityDetector());
  detectionRegistry.register(new FormAccessibilityDetector());
  detectionRegistry.register(new HeadingAccessibilityDetector());
  // Functionality
  detectionRegistry.register(new FormInteractionDetector());
  detectionRegistry.register(new NavigationDetector());
  detectionRegistry.register(new UIFunctionalityDetector());

  // Register LLM provider
  const llmProvider: LLMProvider = createLLMProvider(options);

  // Check LLM availability
  terminal.info(`Checking LLM provider (${llmProvider.name})...`);
  const llmHealthy = await llmProvider.healthCheck();
  if (!llmHealthy) {
    terminal.warn(
      `LLM provider "${llmProvider.name}" health check failed. ` +
        "Scan may fail if the provider is unreachable."
    );
  }

  // Register tools
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(createCrawlPageTool(container));
  toolRegistry.register(createExtractDomTool(container));
  toolRegistry.register(createHttpRequestTool());
  toolRegistry.register(createListLinksTool(container));

  // Register browser tools if not disabled
  if (!options.noBrowser) {
    try {
      const browserProvider = new PuppeteerBrowserProvider();
      container.register(BrowserDriverDefinition, valueProvider(browserProvider));
      await browserProvider.launch({ headless: true });

      toolRegistry.register(createClickElementTool(container));
      toolRegistry.register(createFillFormTool(container));
      toolRegistry.register(createNavigateToTool(container));
      toolRegistry.register(createTakeScreenshotTool(container));
      toolRegistry.register(createMeasurePerformanceTool(container));
      toolRegistry.register(createAssertVisibleTool(container));
      toolRegistry.register(createAssertTextTool(container));
      terminal.success("Browser tools enabled (Puppeteer)");
    } catch (err) {
      terminal.warn(
        `Browser tools unavailable: ${err instanceof Error ? err.message : String(err)}`
      );
      terminal.info("Continuing without browser tools...");
    }
  }

  // Register run_detection tool with detection registry
  const { createRunDetectionTool } = await import(
    "@test-harness/th-tools"
  );
  toolRegistry.register(
    createRunDetectionTool(container, (id) =>
      detectionRegistry.get(id)
    )
  );

  terminal.success(
    `Loaded ${toolRegistry.size} tools, ${detectionRegistry.size} detections`
  );

  // ─── 2. Run the Agent Loop ───
  const scanConfig: ScanConfig = {
    detections: detectionRegistry.listIds(),
    strategy: "adaptive",
    llm: {
      provider: options.provider ?? "ollama",
      model: options.model ?? "llama3.1",
      temperature: 0.1,
    },
    crawl: {
      maxDepth: 2,
      maxPages: 20,
      respectRobots: true,
      rateLimit: 2,
    },
    maxTurns: options.maxTurns ?? 15,
    timeout: 300_000, // 5 minutes
  };

  const scanTarget: ScanTarget = {
    url,
    scope: options.scope ?? "page",
  };

  const agentLoop = new AgentLoop();
  const scanId = `scan_${Date.now()}`;

  console.log();
  terminal.header("Starting Agent Loop");

  // Subscribe to streaming events for real-time display
  const streamSub = eventBus.on(AgentStreamChunkEvent, (data) => {
    terminal.streamLine(data.partialContent, data.toolCallCount);
  });

  const result = await agentLoop.run({
    scanId,
    target: scanTarget,
    config: scanConfig,
    llm: llmProvider,
    toolRegistry,
    eventBus,
    container,
  });

  // ─── 3. Display results ───
  terminal.streamClear(); // Clear streaming line
  console.log();
  terminal.header("Scan Results");
  console.log();

  if (result.status === "completed") {
    terminal.success(
      `Scan completed in ${result.turns} turns`
    );
  } else if (result.status === "timeout") {
    terminal.warn(
      `Scan timed out after ${result.turns} turns`
    );
  } else if (result.status === "failed") {
    terminal.error(`Scan failed: ${result.error?.message}`);
  } else if (result.status === "cancelled") {
    terminal.warn("Scan cancelled");
  }

  // Display the LLM summary
  if (result.summary) {
    console.log();
    console.log(result.summary);
  }

  // Cleanup: close browser if it was launched
  if (!options.noBrowser) {
    try {
      const browser = container.get(BrowserDriverDefinition);
      await browser.close();
    } catch {
      // Browser wasn't registered or already closed
    }
  }

  // Cleanup
  streamSub.dispose();
  await container.dispose();
}

/** Create LLM provider based on CLI options */
function createLLMProvider(options: ScanCommandOptions): LLMProvider {
  const provider = (options.provider ?? "qwen").toLowerCase();
  const model = options.model;

  switch (provider) {
    case "qwen":
    case "dashscope":
      return new QwenProvider({
        defaultModel: model ?? "qwen-plus",
      });

    case "openai":
      return new (require("@test-harness/th-llm-openai").OpenAIProvider)({
        defaultModel: model ?? "gpt-4o",
      });

    case "deepseek":
      return new (require("@test-harness/th-llm-deepseek").DeepSeekProvider)({
        defaultModel: model ?? "deepseek-chat",
      });

    case "ollama":
    default:
      return new OllamaProvider({
        baseUrl: options.ollamaUrl ?? "http://localhost:11434",
        defaultModel: model ?? "llama3.1",
      });
  }
}
