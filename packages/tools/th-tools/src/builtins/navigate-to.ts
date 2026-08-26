/**
 * Built-in tool: navigate_to — navigate the browser to a URL.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { THContainer } from "@test-harness/th-core";
import { BrowserDriverDefinition, type BrowserDriver } from "@test-harness/th-browser";

const inputSchema = z.object({
  url: z.string().url().describe("The URL to navigate to"),
  waitUntil: z
    .enum(["load", "domcontentloaded", "networkidle0", "networkidle2"])
    .optional()
    .describe("Wait condition (default: 'domcontentloaded')"),
  timeout: z.number().optional().describe("Navigation timeout in ms"),
});

const outputSchema = z.object({
  url: z.string(),
  title: z.string(),
  status: z.number(),
  loadTime: z.number(),
});

export function createNavigateToTool(container: THContainer): Tool {
  return {
    id: "navigate_to",
    name: "Navigate To URL",
    description:
      "Navigate the browser to a specific URL. Use this to visit pages, follow links, or test different routes on a website.",
    category: "browser",
    inputSchema,
    outputSchema,
    timeoutMs: 30_000,

    // Browser is a shared resource — not safe for concurrent tool use
    isConcurrencySafe: () => false,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { url, waitUntil, timeout } = inputSchema.parse(input);
      const browser = container.get(BrowserDriverDefinition) as BrowserDriver;
      const start = Date.now();

      try {
        const pageInfo = await browser.navigate(url, {
          waitUntil: waitUntil ?? "domcontentloaded",
          timeout: timeout ?? 25_000,
        });

        return {
          success: true,
          data: {
            url: pageInfo.url,
            title: pageInfo.title,
            status: pageInfo.status,
            loadTime: pageInfo.loadTime,
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
