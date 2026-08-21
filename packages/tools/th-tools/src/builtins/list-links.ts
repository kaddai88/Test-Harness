/**
 * Built-in tool: list_links — extract all links from a page.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult, CrawlService } from "@test-harness/th-protocol";
import { CrawlServiceDefinition } from "@test-harness/th-crawl";
import type { THContainer } from "@test-harness/th-core";
import { LinkExtractor } from "@test-harness/th-crawl";

const inputSchema = z.object({
  url: z.string().url().describe("The URL to extract links from"),
  scope: z
    .enum(["all", "internal", "external"])
    .optional()
    .describe("Filter links by scope (default: all)"),
});

const outputSchema = z.object({
  totalLinks: z.number(),
  internalLinks: z.number(),
  externalLinks: z.number(),
  links: z.array(z.unknown()),
});

export function createListLinksTool(
  container: THContainer
): Tool {
  const crawlService = container.get(CrawlServiceDefinition);
  const linkExtractor = new LinkExtractor();

  return {
    id: "list_links",
    name: "List Links",
    description:
      "Extract all links from a web page. Returns internal and external links with their text and relationship attributes.",
    category: "crawl",
    inputSchema,
    outputSchema,
    timeoutMs: 15_000,
    isConcurrencySafe: () => true,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { url, scope } = inputSchema.parse(input);

      const page = await crawlService.fetchPage(url);
      if (page.error) {
        return {
          success: false,
          error: `Failed to fetch ${url}: ${page.error}`,
          duration: 0,
        };
      }

      let links = linkExtractor.extract(page.html, page.url);
      const internalCount = links.filter((l) => !l.isExternal).length;
      const externalCount = links.filter((l) => l.isExternal).length;

      // Filter by scope
      if (scope === "internal") {
        links = links.filter((l) => !l.isExternal);
      } else if (scope === "external") {
        links = links.filter((l) => l.isExternal);
      }

      return {
        success: true,
        data: {
          totalLinks: links.length,
          internalLinks: internalCount,
          externalLinks: externalCount,
          links: links.map((l) => ({
            href: l.href,
            text: l.text.slice(0, 100),
            isExternal: l.isExternal,
          })),
        },
        duration: page.loadTime,
      };
    },
  };
}
