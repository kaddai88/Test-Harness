/**
 * Built-in tool: crawl_page — fetches a web page and returns its content.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult, CrawlService } from "@test-harness/th-protocol";
import { CrawlServiceDefinition } from "@test-harness/th-crawl";
import type { THContainer } from "@test-harness/th-core";

const inputSchema = z.object({
  url: z.string().url().describe("The URL to fetch"),
  mode: z
    .enum(["http", "browser"])
    .optional()
    .describe("Fetch mode: 'http' for fast HTTP, 'browser' for JS rendering"),
  timeout: z
    .number()
    .optional()
    .describe("Request timeout in milliseconds (default: 30000)"),
});

const outputSchema = z.object({
  url: z.string(),
  status: z.number(),
  html: z.string(),
  headers: z.record(z.string()),
  loadTime: z.number(),
  title: z.string().optional(),
});

export function createCrawlPageTool(
  container: THContainer
): Tool {
  const crawlService = container.get(CrawlServiceDefinition);

  return {
    id: "crawl_page",
    name: "Crawl Page",
    description:
      "Fetch a web page and return its HTML content, status code, headers, and load time. Use this to inspect the raw page source.",
    category: "crawl",
    inputSchema,
    outputSchema,
    timeoutMs: 30_000,
    // crawl_page is exclusive — shares browser pool, rate-limited

    async execute(
      input: unknown,
      _context: ToolContext
    ): Promise<ToolResult> {
      const { url, mode, timeout } = inputSchema.parse(input);
      const page = await crawlService.fetchPage(url, {
        mode: mode ?? "http",
        timeout,
      });

      if (page.error) {
        return {
          success: false,
          error: page.error,
          duration: page.loadTime,
        };
      }

      // Extract title for summary
      const titleMatch = page.html.match(/<title[^>]*>([^<]*)<\/title>/i);
      const title = titleMatch?.[1]?.trim();

      return {
        success: true,
        data: {
          url: page.url,
          status: page.status,
          html: page.html.slice(0, 50_000), // Truncate for LLM context
          headers: page.headers,
          loadTime: page.loadTime,
          title,
        },
        duration: page.loadTime,
      };
    },
  };
}
