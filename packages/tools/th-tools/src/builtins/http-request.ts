/**
 * Built-in tool: http_request — make an arbitrary HTTP request.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import { request } from "undici";

const inputSchema = z.object({
  url: z.string().url().describe("The URL to request"),
  method: z
    .enum(["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS"])
    .optional()
    .describe("HTTP method (default: GET)"),
  headers: z
    .record(z.string())
    .optional()
    .describe("Request headers"),
  body: z.string().optional().describe("Request body (for POST/PUT)"),
  timeout: z.number().optional().describe("Timeout in ms"),
});

const outputSchema = z.object({
  status: z.number(),
  headers: z.record(z.string()),
  body: z.string(),
  loadTime: z.number(),
});

export function createHttpRequestTool(): Tool {
  return {
    id: "http_request",
    name: "HTTP Request",
    description:
      "Make an HTTP request to a URL. Use this to test API endpoints, check response headers, send POST data, etc.",
    category: "utility",
    inputSchema,
    outputSchema,
    timeoutMs: 15_000,

    // HTTP requests are independent and safe to run in parallel
    isConcurrencySafe: () => true,

    async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
      const { url, method, headers, body, timeout } =
        inputSchema.parse(input);
      const start = Date.now();

      try {
        const response = await request(url, {
          method: method ?? "GET",
          headers: {
            "User-Agent": "TestHarness/0.1",
            ...headers,
          },
          body: body ?? undefined,
          headersTimeout: timeout ?? 30000,
          bodyTimeout: timeout ?? 30000,
          signal: context.abortSignal,
        });

        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(response.headers)) {
          if (value !== undefined) {
            responseHeaders[key] = Array.isArray(value)
              ? value.join(", ")
              : String(value);
          }
        }

        const responseBody = await response.body.text();
        const loadTime = Date.now() - start;

        return {
          success: true,
          data: {
            status: response.statusCode,
            headers: responseHeaders,
            body: responseBody.slice(0, 50_000),
            loadTime,
          },
          duration: loadTime,
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
