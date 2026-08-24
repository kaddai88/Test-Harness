/**
 * Built-in tool: measure_performance — get performance metrics from the browser.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { THContainer } from "@test-harness/th-core";
import { BrowserDriverDefinition, type BrowserDriver } from "@test-harness/th-browser";

const inputSchema = z.object({
  url: z.string().url().optional().describe("URL to measure (navigates first if provided)"),
});

const outputSchema = z.object({
  ttfb: z.number(),
  domContentLoaded: z.number(),
  loadComplete: z.number(),
  firstContentfulPaint: z.number().optional(),
  largestContentfulPaint: z.number().optional(),
  cumulativeLayoutShift: z.number().optional(),
  pageSize: z.number(),
  requestCount: z.number(),
  domNodeCount: z.number().optional(),
});

export function createMeasurePerformanceTool(container: THContainer): Tool {
  return {
    id: "measure_performance",
    name: "Measure Performance",
    description:
      "Collect performance metrics from the browser (TTFB, DOMContentLoaded, LCP, CLS, page size, etc.). Use this to evaluate page load speed and Core Web Vitals.",
    category: "analysis",
    inputSchema,
    outputSchema,
    timeoutMs: 30_000,

    // Browser is a shared resource — not safe for concurrent tool use
    isConcurrencySafe: () => false,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { url } = inputSchema.parse(input);
      const browser = container.get(BrowserDriverDefinition) as BrowserDriver;
      const start = Date.now();

      try {
        if (url) {
          await browser.navigate(url, { waitUntil: "networkidle2", timeout: 25_000 });
        }

        const metrics = await browser.getPerformanceMetrics();

        if (!metrics) {
          return {
            success: false,
            error: "No performance metrics available. Ensure a page is loaded.",
            duration: Date.now() - start,
          };
        }

        return {
          success: true,
          data: metrics,
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
