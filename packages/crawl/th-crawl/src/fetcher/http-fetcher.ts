/**
 * HTTP Fetcher — fetches pages using undici (fast HTTP client).
 */
import { fetch as undiciFetch } from "undici";
import type {
  FetchOptions,
  FetchedPage,
  RedirectInfo,
} from "@test-harness/th-protocol";

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_USER_AGENT =
  "TestHarness/0.1 (Website Quality Analyzer)";

export class HttpFetcher {
  async fetch(
    url: string,
    options?: FetchOptions
  ): Promise<FetchedPage> {
    const startTime = Date.now();
    const redirects: RedirectInfo[] = [];
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await undiciFetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            options?.userAgent ?? DEFAULT_USER_AGENT,
          ...(options?.headers ?? {}),
        },
        redirect: options?.followRedirects === false ? "manual" : "follow",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const body = await response.text();
      const loadTime = Date.now() - startTime;

      // Collect headers
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        url: response.url || url,
        originalUrl: url,
        status: response.status,
        headers,
        html: body,
        loadTime,
        redirects,
      };
    } catch (err) {
      const loadTime = Date.now() - startTime;
      return {
        url,
        originalUrl: url,
        status: 0,
        headers: {},
        html: "",
        loadTime,
        redirects,
        error:
          err instanceof Error ? err.message : String(err),
      };
    }
  }
}
