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
  type SessionTarget,
  type SessionConfig,
  type Finding,
} from "@test-harness/th-protocol";
import { THContainer, valueProvider } from "@test-harness/th-core";
import {
  BrowserDriverDefinition,
  PlaywrightBrowserProvider,
  loadSiteProfile,
  enrichSiteProfile,
  saveSiteProfile,
  createDefaultSiteProfile,
} from "@test-harness/th-browser";
import type { SiteHints } from "@test-harness/th-agent";
import { ToolRegistry, createAllTools, createMCPModeTools, createReportFindingTool, closeBrowser } from "@test-harness/th-tools";
import { AgentLoop } from "@test-harness/th-agent";
import { calculateScore } from "@test-harness/th-report";
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
    console.log(`[Worker] broadcast ${type} for ${sessionId.slice(0,8)}`);
    this.wsHandler?.broadcast({ type, sessionId, ...data });
  }

  /** Launch a headless Chrome browser (legacy mode only). MCP mode doesn't need this. */
  private async launchBrowser(container: THContainer): Promise<boolean> {
    try {
      // Use local Playwright (legacy fallback mode)
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

      const browserProvider = new PlaywrightBrowserProvider({ executablePath });
      container.register(BrowserDriverDefinition, valueProvider(browserProvider));
      await browserProvider.launch({ headless: true });
      console.log('[Worker] Using local Playwright');
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

    const session = await this.repos.sessions.findById(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    // Update status to planning
    await this.repos.sessions.updateStatus(sessionId, "planning");
    await this.repos.sessions.updateStartedAt(sessionId);
    this.broadcast("session:status", sessionId, { status: "planning", message: "AI is generating test plan..." });

    const collectedFindings: Finding[] = [];
    const collectedActivities: Record<string, unknown>[] = [];
    const disposables: Array<{ dispose(): void }> = [];

    try {
      // ── Build container & dependencies ──
      const container = new THContainer();
      const useMCPTools = process.env.BROWSER_MODE === "mcp";

      // ── Tool registry ──
      const registry = new ToolRegistry();
      if (useMCPTools) {
        // MCP mode: connect to Playwright MCP server directly, no wrapper needed
        const mcpUrl = process.env.PLAYWRIGHT_MCP_URL ?? "http://localhost:3001/sse";
        const mcpTools = await createMCPModeTools(mcpUrl);
        for (const tool of mcpTools) {
          registry.register(tool);
        }
        console.log(`[Worker] MCP mode: ${mcpTools.length} tools registered`);
        this.broadcast("session:status", sessionId, { status: "executing", message: "MCP browser ready" });
      } else {
        // Legacy mode: launch local Playwright + use wrapper tools
        const browserReady = await this.launchBrowser(container);
        if (browserReady) {
          this.broadcast("session:status", sessionId, { status: "executing", message: "Browser ready" });
        } else {
          this.broadcast("session:status", sessionId, { status: "executing", message: "Crawling without browser" });
        }
        for (const tool of createAllTools(container)) {
          registry.register(tool);
        }
      }
      registry.register(createReportFindingTool(collectedFindings, sessionId));

      // ── Build SessionTarget / SessionConfig from session ──
      const targetConfig = (session.targetConfig ?? {}) as Record<string, unknown>;
      const rawConfig = (session.scanConfig ?? {}) as Record<string, unknown>;

      const target: SessionTarget = {
        url: session.targetUrl,
        scope: (targetConfig.scope as SessionTarget["scope"]) ?? "page",
      };

      const config: SessionConfig = {
        strategy: typeof rawConfig.strategy === "string" ? rawConfig.strategy : "adaptive",
        maxTurns: typeof rawConfig.maxTurns === "number" ? rawConfig.maxTurns : 99,
        maxRetriesPerAction: typeof rawConfig.maxRetriesPerAction === "number" ? rawConfig.maxRetriesPerAction : 3,
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
      };

      // ─ Bridge Agent Loop events to WebSocket ──
      disposables.push(
        container.events.on(AgentTurnStartedEvent, (d) => {
          const activity = {
            kind: "turn_started",
            turn: d.turnNumber,
            timestamp: Date.now(),
          };
          this.broadcast("agent:activity", sessionId, activity);
          collectedActivities.push(activity);
        }),
        container.events.on(AgentStreamChunkEvent, (d) => {
          const activity = {
            kind: "stream",
            partial: d.partialContent,
            done: d.done,
            turn: d.turnNumber,
            timestamp: Date.now(),
          };
          this.broadcast("agent:activity", sessionId, activity);
          collectedActivities.push(activity);
        }),
        container.events.on(AgentToolCallEvent, (d) => {
          const activity = {
            kind: "tool_call",
            tool: d.toolName,
            input: d.input,
            turn: d.turnNumber,
            timestamp: Date.now(),
          };
          this.broadcast("agent:activity", sessionId, activity);
          collectedActivities.push(activity);
        }),
        container.events.on(AgentToolResultEvent, (d) => {
          const activity: Record<string, unknown> = {
            kind: "tool_result",
            tool: d.toolName,
            success: d.success,
            turn: d.turnNumber,
            timestamp: Date.now(),
          };

          // Capture screenshot data if available
          const resultData = d.data as { images?: Array<{ data: string; mimeType: string }> } | undefined;
          if (resultData?.images && resultData.images.length > 0) {
            const img = resultData.images[0];
            if (img) {
              activity.screenshot = img.data;
              activity.screenshotMimeType = img.mimeType;
            }
          }

          this.broadcast("agent:activity", sessionId, activity);
          collectedActivities.push(activity);
        }),
        // Workflow state change event
        container.events.on("agent:workflow_state" as any, (d: any) => {
          this.broadcast("agent:workflow_state", sessionId, {
            previousState: d.previousState,
            newState: d.newState,
            message: d.message,
            timestamp: Date.now(),
          });
        }),
      );

      // ── Build SiteHints from profile ──
      const siteHints: SiteHints | undefined = (() => {
        try {
          const profile = loadSiteProfile(targetUrl);
          if (!profile) return undefined;
          const hints: SiteHints = { name: profile.name };
          // We could extract auth patterns here if stored in the profile
          return hints;
        } catch {
          return undefined;
        }
      })();

      // ── Run the Agent Loop ──
      const abortController = new AbortController();

      // Poll for cancellation every 2 seconds
      const cancelCheck = setInterval(async () => {
        try {
          const session = await this.repos.sessions.findById(sessionId);
          if (session?.status === "cancelled") {
            console.log(`[Worker] Session ${sessionId} cancelled by user, aborting...`);
            abortController.abort();
            clearInterval(cancelCheck);
          }
        } catch {
          // Ignore polling errors
        }
      }, 2000);

      const loop = new AgentLoop();
      const result = await loop.run({
        sessionId: sessionId,
        target,
        config,
        llm: this.llm,
        toolRegistry: registry,
        eventBus: container.events,
        container,
        siteHints,
        signal: abortController.signal,
      });

      clearInterval(cancelCheck);

      // ── Persist results ──
      disposables.forEach((d) => d.dispose());

      const status =
        result.status === "failed"
          ? "failed"
          : result.status === "cancelled"
            ? "cancelled"
            : "completed";

      // Generate execution summary
      let executionSummary = null;
      try {
        executionSummary = await this.generateExecutionSummary(
          collectedActivities,
          collectedFindings,
          result.summary ?? ""
        );
      } catch (err) {
        console.error('[Worker] Failed to generate execution summary:', err);
      }

      await this.repos.sessions.updateStatus(sessionId, status);
      await this.repos.sessions.updateCompletedAt(sessionId);
      const score = calculateScore(collectedFindings);
      await this.repos.sessions.updateMetadata(sessionId, {
        summary: result.summary ?? "",
        findings: collectedFindings,
        turns: result.turns,
        activities: collectedActivities,
        score,
        executionSummary,
      });

      this.broadcast("session:update", sessionId, { status });
      this.broadcast("session:finding", sessionId, { findings: collectedFindings });
      this.broadcast("session:completed", sessionId, {
        status,
        summary: result.summary ?? "",
        findingCount: collectedFindings.length,
      });

      // ── Self-learning: enrich site profile from this session ──
      try {
        const existingProfile = loadSiteProfile(targetUrl);
        // Convert SiteProfileData to SiteProfile for enrichment
        const siteProfile = existingProfile
          ? {
              ...createDefaultSiteProfile(existingProfile.name, existingProfile.baseUrl),
              elementCache: existingProfile.elementCache,
              updatedAt: existingProfile.updatedAt,
            }
          : null;

        const enrichment = enrichSiteProfile(
          siteProfile,
          targetUrl,
          collectedActivities.map(a => ({
            kind: a.kind as string,
            tool: a.tool as string | undefined,
            input: a.input as Record<string, unknown> | undefined,
            success: a.success as boolean | undefined,
            turn: a.turn as number | undefined,
            timestamp: a.timestamp as number | undefined,
          })),
          [] // No SmartLocator cache in MCP mode
        );

        if (enrichment.summary) {
          console.log(`[Worker] Site profile enrichment: ${enrichment.summary}`);
          // Save the enriched profile back to disk
          const enrichedData = {
            name: siteProfile?.name ?? extractHostname(targetUrl),
            baseUrl: targetUrl,
            elementCache: siteProfile?.elementCache ?? [],
            updatedAt: Date.now(),
          };
          saveSiteProfile(enrichedData);
        }
      } catch (err) {
        console.warn(`[Worker] Site profile enrichment failed:`, err);
      }

      // Close browser to prevent orphan windows
      if (useMCPTools) {
        const mcpUrl = process.env.PLAYWRIGHT_MCP_URL ?? "http://localhost:3001/sse";
        await closeBrowser(mcpUrl);
      }

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
      await this.repos.sessions.updateStatus(sessionId, "failed");
      await this.repos.sessions.updateCompletedAt(sessionId);
      this.broadcast("session:failed", sessionId, {
        status: "failed",
        error: errorMsg,
      });
      throw err;
    }
  }

  /**
   * Generate a structured execution summary from activities and findings.
   * Creates a table format with test cases and screenshots.
   */
  private async generateExecutionSummary(
    activities: Array<Record<string, unknown>>,
    findings: Finding[],
    finalSummary: string
  ): Promise<Record<string, unknown> | null> {
    if (activities.length === 0) return null;

    // Group activities into test cases based on tool calls
    const testCases: Array<{
      name: string;
      action: string;
      result: string;
      screenshot?: string;
      screenshotMimeType?: string;
    }> = [];

    let currentTestCase: typeof testCases[0] | null = null;

    for (const activity of activities) {
      if (activity.kind === 'tool_call') {
        const toolName = activity.tool as string;
        const input = activity.input as Record<string, unknown> | undefined;

        // Start a new test case for significant actions
        if (['browser_click', 'browser_type', 'browser_fill_form', 'browser_navigate', 'browser_select_option'].includes(toolName)) {
          // Save previous test case
          if (currentTestCase) {
            testCases.push(currentTestCase);
          }

          // Create new test case
          let actionDesc = '';
          if (toolName === 'browser_click') {
            actionDesc = `Click: ${input?.element ?? 'unknown'}`;
          } else if (toolName === 'browser_type') {
            actionDesc = `Type "${input?.text ?? ''}" into ${input?.element ?? 'unknown'}`;
          } else if (toolName === 'browser_fill_form') {
            actionDesc = 'Fill form';
          } else if (toolName === 'browser_navigate') {
            actionDesc = `Navigate to ${input?.url ?? 'unknown'}`;
          } else if (toolName === 'browser_select_option') {
            actionDesc = `Select option: ${input?.value ?? 'unknown'}`;
          }

          currentTestCase = {
            name: toolName,
            action: actionDesc,
            result: 'pending',
          };
        }
      } else if (activity.kind === 'tool_result' && currentTestCase) {
        // Update test case with result and screenshot
        currentTestCase.result = activity.success ? 'success' : 'failed';
        if (activity.screenshot) {
          currentTestCase.screenshot = activity.screenshot as string;
          currentTestCase.screenshotMimeType = activity.screenshotMimeType as string;
        }
      }
    }

    // Add last test case
    if (currentTestCase) {
      testCases.push(currentTestCase);
    }

    // Generate overview and conclusion using LLM
    const prompt = `You just completed a test session. Based on the following data, generate a concise summary.

Test cases executed: ${testCases.length}
Findings discovered: ${findings.length}
${findings.map((f, i) => `${i+1}. [${f.severity}] ${f.title}`).join('\n')}

Agent's final summary:
${finalSummary}

Generate a JSON object with this structure:
{
  "overview": "1-2 sentence overview of what was tested",
  "conclusion": "1-2 sentence conclusion"
}

Respond with ONLY the JSON object, no markdown.`;

    let overview = '';
    let conclusion = '';

    try {
      const response = await this.llm.complete({
        model: (this.llm as any).defaultModel ?? 'qwen-plus',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 500,
      });

      const content = response.content.trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        overview = parsed.overview ?? '';
        conclusion = parsed.conclusion ?? '';
      }
    } catch (err) {
      console.error('[Worker] LLM summary generation failed:', err);
    }

    return {
      overview,
      conclusion,
      testCases,
      findings: findings.length,
    };
  }
}

/** Extract hostname from URL for site profile naming */
function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
