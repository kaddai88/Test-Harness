/**
 * Test Session command — AI-driven website testing via Agent Loop.
 *
 * DSH-style architecture:
 * User describes what to test → LLM plans → executes browser actions → streams results
 *
 * Usage:
 *   th test https://example.com --instructions "Test the login functionality"
 */
import { THContainer, valueProvider } from "@test-harness/th-core";
import { OllamaProvider } from "@test-harness/th-llm-ollama";
import { QwenProvider } from "@test-harness/th-llm-qwen";
import { BrowserDriverDefinition, PuppeteerBrowserProvider } from "@test-harness/th-browser";
import { ToolRegistry, createAllTools, createReportFindingTool } from "@test-harness/th-tools";
import { AgentLoop } from "@test-harness/th-agent";
import type { LLMProvider, Finding, ScanTarget, ScanConfig } from "@test-harness/th-protocol";
import { terminal } from "../output/terminal.js";

export interface TestCommandOptions {
  /** LLM provider: ollama, openai, deepseek, qwen */
  provider?: string;
  /** Model name */
  model?: string;
  /** Ollama base URL */
  ollamaUrl?: string;
  /** Max agent turns */
  maxTurns?: number;
  /** Test instructions (natural language) */
  instructions?: string;
  /** Disable browser tools (no Puppeteer) */
  noBrowser?: boolean;
}

export async function runTest(
  url: string,
  options: TestCommandOptions = {}
): Promise<void> {
  terminal.banner();
  terminal.info(`Target: ${url}`);
  terminal.info(`Instructions: ${options.instructions ?? "(none)"}`);
  console.log();

  // ─── 1. Bootstrap the plugin container ───
  const container = new THContainer();

  // Register LLM provider
  const llmProvider: LLMProvider = createLLMProvider(options);

  terminal.info(`LLM Provider: ${llmProvider.name}`);
  const llmHealthy = await llmProvider.healthCheck();
  if (!llmHealthy) {
    terminal.warn(
      `LLM provider "${llmProvider.name}" health check failed. ` +
        "Test may fail if the provider is unreachable."
    );
  }

  // Register browser driver
  if (!options.noBrowser) {
    try {
      const browserProvider = new PuppeteerBrowserProvider();
      container.register(BrowserDriverDefinition, valueProvider(browserProvider));
      await browserProvider.launch({ headless: true });
      terminal.success("Browser automation enabled (Puppeteer)");
    } catch (err) {
      terminal.warn(
        `Browser automation unavailable: ${err instanceof Error ? err.message : String(err)}`
      );
      terminal.info("Continuing without browser tools...");
    }
  }

  // ─── 2. Register services & run the Agent Loop ───
  const sessionId = `session_${Date.now()}`;

  console.log();
  terminal.header("Starting AI Agent");

  // Register tools (browser tools included if BrowserDriver is available)
  const registry = new ToolRegistry();
  const findings: Finding[] = [];
  for (const tool of createAllTools(container)) {
    registry.register(tool);
  }
  registry.register(createReportFindingTool(findings, sessionId));

  const agentLoop = new AgentLoop();

  const target: ScanTarget = { url, scope: "page" };
  const config: ScanConfig = {
    strategy: "adaptive",
    maxTurns: options.maxTurns ?? 20,
    instructions: options.instructions,
    llm: {
      provider: llmProvider.id,
      model:
        options.model ??
        process.env.QWEN_MODEL ??
        process.env.OPENAI_MODEL ??
        process.env.OLLAMA_MODEL ??
        "qwen-plus",
      temperature: 0.1,
    },
  };

  const result = await agentLoop.run({
    scanId: sessionId,
    target,
    config,
    llm: llmProvider,
    toolRegistry: registry,
    eventBus: container.events,
    container,
  });

  // ─── 3. Display results ───
  console.log();
  terminal.header("Test Results");
  console.log();

  if (result.status === "completed") {
    terminal.success(`Test session completed in ${result.turns} turns`);
  } else if (result.status === "failed") {
    terminal.error(`Test failed: ${result.error?.message}`);
  } else if (result.status === "cancelled") {
    terminal.warn("Test cancelled");
  } else if (result.status === "timeout") {
    terminal.warn(`Test hit max turns (${result.turns})`);
  }

  if (findings.length > 0) {
    console.log();
    terminal.header(`Findings (${findings.length})`);
    for (const f of findings) {
      console.log(`  [${f.severity.toUpperCase()}] ${f.title}`);
      if (f.description) console.log(`    ${f.description}`);
    }
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

  await container.dispose();
}

/** Create LLM provider based on CLI options */
function createLLMProvider(options: TestCommandOptions): LLMProvider {
  const provider = (options.provider ?? "qwen").toLowerCase();
  const model = options.model;

  switch (provider) {
    case "qwen":
    case "dashscope":
      return new QwenProvider({
        defaultModel: model ?? "qwen-plus",
      });

    case "ollama":
    default:
      return new OllamaProvider({
        baseUrl: options.ollamaUrl ?? "http://localhost:11434",
        defaultModel: model ?? "llama3.1",
      });
  }
}
