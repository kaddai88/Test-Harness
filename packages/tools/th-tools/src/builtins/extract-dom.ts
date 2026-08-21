/**
 * Built-in tool: extract_dom — extracts structured DOM data from a page.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult, CrawlService } from "@test-harness/th-protocol";
import { CrawlServiceDefinition } from "@test-harness/th-crawl";
import type { THContainer } from "@test-harness/th-core";

const inputSchema = z.object({
  url: z.string().url().describe("The URL to extract DOM from"),
});

const outputSchema = z.object({
  url: z.string(),
  title: z.string(),
  headings: z.array(z.object({ level: z.number(), text: z.string() })),
  links: z.array(z.object({ href: z.string(), text: z.string(), rel: z.string() })),
  forms: z.array(z.unknown()),
  images: z.array(z.object({ src: z.string(), alt: z.string() })),
  scripts: z.array(z.unknown()),
  meta: z.record(z.string()),
});

export function createExtractDomTool(
  container: THContainer
): Tool {
  const crawlService = container.get(CrawlServiceDefinition);

  return {
    id: "extract_dom",
    name: "Extract DOM",
    description:
      "Extract structured data from a web page: title, headings, links, forms, images, scripts, and meta tags. Use this to analyze the page structure.",
    category: "crawl",
    inputSchema,
    outputSchema,
    timeoutMs: 20_000,
    isConcurrencySafe: () => true,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { url } = inputSchema.parse(input);
      try {
        const dom = await crawlService.extractDOM(url);
        return {
          success: true,
          data: dom,
          duration: 0,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          duration: 0,
        };
      }
    },
  };
}
