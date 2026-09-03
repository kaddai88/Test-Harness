/**
 * browser_evaluate tool — page analysis via Playwright MCP.
 * Returns URL, title, and full HTML for the agent to analyze the DOM.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { THContainer } from "@test-harness/th-core";
import { BrowserDriverDefinition, type BrowserDriver } from "@test-harness/th-browser";

const inputSchema = z.object({});

export function createBrowserEvaluateTool(container: THContainer): Tool {
  return {
    id: "browser_evaluate",
    name: "Browser Evaluate",
    description: "Analyze the current page — returns URL, title, and full HTML. Use this BEFORE any action to understand the page structure (forms, buttons, inputs, links).",
    category: "browser",
    inputSchema,
    outputSchema: z.any(),
    timeoutMs: 15_000,
    isConcurrencySafe: () => true,

    async execute(_input: unknown, _context: ToolContext): Promise<ToolResult> {
      const browser = container.get(BrowserDriverDefinition) as BrowserDriver;
      const start = Date.now();
      try {
        const pageInfo = await browser.getPageInfo();
        return {
          success: true,
          data: {
            url: pageInfo.url,
            title: pageInfo.title,
            html: pageInfo.html,
          },
          duration: Date.now() - start,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          duration: Date.now() - start,
        };
      }
    },
  };
}
