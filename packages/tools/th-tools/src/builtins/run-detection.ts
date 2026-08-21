/**
 * Built-in tool: run_detection — execute a detection plugin against a target.
 *
 * This is the core bridge between the Agent Loop and the detection system.
 */
import { z } from "zod";
import type {
  Tool,
  ToolContext,
  ToolResult,
  DetectionPlugin,
  CrawlService,
} from "@test-harness/th-protocol";
import { CrawlServiceDefinition } from "@test-harness/th-crawl";
import type { THContainer } from "@test-harness/th-core";

const inputSchema = z.object({
  detectionId: z
    .string()
    .describe("The ID of the detection plugin to run"),
  url: z
    .string()
    .url()
    .describe("The URL to run the detection against"),
});

const outputSchema = z.object({
  detectionId: z.string(),
  status: z.string(),
  score: z.number(),
  findingCount: z.number(),
  findings: z.array(z.unknown()),
});

export function createRunDetectionTool(
  container: THContainer,
  getDetection: (id: string) => DetectionPlugin | undefined
): Tool {
  const crawlService = container.get(CrawlServiceDefinition);

  return {
    id: "run_detection",
    name: "Run Detection",
    description:
      "Run a specific detection plugin against a URL. Available detections: security-headers, ssl-tls, xss, sqli, performance, seo, accessibility. Use 'list_detections' to see all available plugins.",
    category: "detection",
    inputSchema,
    outputSchema,
    timeoutMs: 60_000,
    // run_detection is exclusive — may modify shared scan state

    async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
      const { detectionId, url } = inputSchema.parse(input);

      const detection = getDetection(detectionId);
      if (!detection) {
        return {
          success: false,
          error: `Detection plugin "${detectionId}" not found. Available: security-headers, ssl-tls`,
          duration: 0,
        };
      }

      // Fetch page data first
      const page = await crawlService.fetchPage(url);
      if (page.error) {
        return {
          success: false,
          error: `Failed to fetch ${url}: ${page.error}`,
          duration: 0,
        };
      }

      const target = {
        url,
        scope: "page" as const,
        pageData: {
          url: page.url,
          html: page.html,
          headers: page.headers,
          status: page.status,
        },
      };

      const detectionCtx = {
        scanId: context.scanId,
        config: {},
        abortSignal: context.abortSignal,
      };

      try {
        const result = await detection.execute(target, detectionCtx);
        return {
          success: true,
          data: {
            detectionId: result.detectionId,
            status: result.status,
            score: result.score,
            findingCount: result.findings.length,
            findings: result.findings.map((f) => ({
              id: f.id,
              title: f.title,
              severity: f.severity,
              confidence: f.confidence,
              description: f.description,
              recommendation: f.recommendation,
              url: f.url,
            })),
          },
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
