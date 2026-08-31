/**
 * Playwright MCP Client — connects to @playwright/mcp server for browser automation.
 *
 * Uses Model Context Protocol (MCP) to communicate with Playwright MCP server.
 * Provides standardized browser automation tools for AI agents.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn } from "node:child_process";
import type { BrowserDriver, BrowserLaunchOptions, NavigationOptions, ElementActionOptions, FormData, ScreenshotOptions, PageInfo, PerformanceMetrics, ConsoleMessage, NetworkRequest, DiscoveredFeature, ElementInfo } from "./types.js";

export interface PlaywrightMCPConfig {
  /** MCP server URL (default: http://localhost:3001) */
  serverUrl?: string;
  /** Path to Playwright MCP server executable */
  serverPath?: string;
  /** Server arguments */
  serverArgs?: string[];
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

export class PlaywrightMCPProvider implements BrowserDriver {
  readonly id = "playwright-mcp";
  readonly name = "Playwright MCP Browser";

  private config: PlaywrightMCPConfig;
  private client: Client | null = null;
  private serverProcess: any = null;
  private isConnected = false;

  constructor(config?: PlaywrightMCPConfig) {
    this.config = {
      serverUrl: "http://localhost:3001",
      timeout: 30000,
      ...config,
    };
  }

  /** Start MCP server and connect client */
  async launch(options?: BrowserLaunchOptions): Promise<void> {
    // Start Playwright MCP server as child process
    if (this.config.serverPath) {
      this.serverProcess = spawn(this.config.serverPath, this.config.serverArgs ?? [], {
        stdio: "pipe",
        env: { ...process.env, PORT: "3001" },
      });

      // Wait for server to start
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Connect MCP client using Streamable HTTP transport
    this.client = new Client(
      { name: "test-harness", version: "1.0.0" },
      { capabilities: {} }
    );

    const transport = new StreamableHTTPClientTransport(new URL(this.config.serverUrl!));
    await this.client.connect(transport);
    this.isConnected = true;

    console.log('[MCP] Connected to Playwright MCP server');
  }

  /** Disconnect client and stop server */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
    this.isConnected = false;
  }

  /** Call an MCP tool */
  private async callTool(name: string, arguments_: Record<string, unknown>): Promise<any> {
    if (!this.client || !this.isConnected) {
      throw new Error("MCP client not connected");
    }

    const result = await this.client.callTool({
      name,
      arguments: arguments_,
    });

    return result;
  }

  async navigate(url: string, options?: NavigationOptions): Promise<PageInfo> {
    const result = await this.callTool("browser_navigate", {
      url,
      waitUntil: options?.waitUntil ?? "domcontentloaded",
      timeout: options?.timeout ?? this.config.timeout,
    });

    return this.extractPageInfo(result);
  }

  async getPageInfo(): Promise<PageInfo> {
    const result = await this.callTool("browser_snapshot", {});
    return this.extractPageInfo(result);
  }

  async click(selector: string, options?: ElementActionOptions): Promise<void> {
    await this.callTool("browser_click", {
      element: selector,
      ref: selector,
    });
  }

  async type(selector: string, text: string, options?: ElementActionOptions): Promise<void> {
    await this.callTool("browser_type", {
      element: selector,
      ref: selector,
      text,
    });
  }

  async fillForm(formSelector: string, data: FormData): Promise<void> {
    for (const [field, value] of Object.entries(data)) {
      await this.callTool("browser_type", {
        element: field,
        ref: field,
        text: value,
      });
    }
  }

  async submitForm(formSelector: string): Promise<void> {
    await this.callTool("browser_click", {
      element: "submit",
      ref: "submit",
    });
  }

  async select(selector: string, value: string): Promise<void> {
    await this.callTool("browser_select_option", {
      element: selector,
      ref: selector,
      values: [value],
    });
  }

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    const result = await this.callTool("browser_take_screenshot", {
      fullPage: options?.fullPage ?? false,
      type: options?.format ?? "png",
    });

    if (result.content && result.content[0]?.data) {
      return Buffer.from(result.content[0].data, "base64");
    }
    throw new Error("Screenshot failed");
  }

  async waitForSelector(selector: string, options?: { timeout?: number; visible?: boolean }): Promise<void> {
    await this.callTool("browser_wait_for", {
      element: selector,
      ref: selector,
      state: options?.visible ? "visible" : "attached",
      timeout: options?.timeout ?? this.config.timeout,
    });
  }

  async waitForNavigation(options?: NavigationOptions): Promise<PageInfo> {
    await this.callTool("browser_wait_for", {
      state: "load",
      timeout: options?.timeout ?? this.config.timeout,
    });
    return await this.getPageInfo();
  }

  async evaluate<T>(fn: string | (() => T)): Promise<T> {
    const script = typeof fn === "string" ? fn : fn.toString();
    const result = await this.callTool("browser_evaluate", {
      function: script,
    });
    return result.content?.[0]?.text as T;
  }

  async getElementInfo(selector: string): Promise<ElementInfo> {
    const result = await this.callTool("browser_snapshot", {});
    // Parse snapshot to find element
    return {
      exists: false,
      visible: false,
      text: "",
      tagName: "",
      attributes: {},
    };
  }

  async isVisible(selector: string): Promise<boolean> {
    try {
      await this.callTool("browser_snapshot", {});
      return false; // Simplified - would need to parse snapshot
    } catch {
      return false;
    }
  }

  async getText(selector: string): Promise<string> {
    const result = await this.callTool("browser_snapshot", {});
    return ""; // Simplified
  }

  async getLinks(): Promise<Array<{ text: string; href: string; selector: string }>> {
    return []; // Simplified
  }

  async discoverFeatures(): Promise<DiscoveredFeature[]> {
    return []; // Simplified
  }

  async getPerformanceMetrics(): Promise<PerformanceMetrics | null> {
    return null; // MCP doesn't expose performance metrics directly
  }

  async getConsoleMessages(): Promise<ConsoleMessage[]> {
    return []; // MCP doesn't expose console messages directly
  }

  async getNetworkRequests(): Promise<NetworkRequest[]> {
    return []; // MCP doesn't expose network requests directly
  }

  async goBack(): Promise<PageInfo> {
    await this.callTool("browser_navigate_back", {});
    return await this.getPageInfo();
  }

  async goForward(): Promise<PageInfo> {
    await this.callTool("browser_navigate_forward", {});
    return await this.getPageInfo();
  }

  async reload(): Promise<PageInfo> {
    await this.callTool("browser_navigate", { url: "" });
    return await this.getPageInfo();
  }

  async setViewport(width: number, height: number): Promise<void> {
    await this.callTool("browser_resize", {
      width,
      height,
    });
  }

  async setExtraHeaders(headers: Record<string, string>): Promise<void> {
    // MCP doesn't support setting extra headers directly
  }

  async setUserAgent(userAgent: string): Promise<void> {
    // MCP doesn't support setting user agent directly
  }

  async healthCheck(): Promise<boolean> {
    return this.isConnected && this.client !== null;
  }

  private extractPageInfo(result: any): PageInfo {
    return {
      url: result.url ?? "",
      title: result.title ?? "",
      status: 200,
      html: result.html ?? "",
      headers: {},
      loadTime: 0,
      consoleMessages: [],
      networkRequests: [],
    };
  }
}
