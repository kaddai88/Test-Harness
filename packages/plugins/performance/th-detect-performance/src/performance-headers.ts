/**
 * Performance Headers Detector — checks for performance-related HTTP headers and meta tags.
 *
 * Checks for:
 * - Cache-Control header (missing → medium)
 * - Content-Encoding (gzip/brotli) (missing → medium)
 * - <link rel="preload"> hints (informational)
 * - X-DNS-Prefetch-Control (info)
 * - Page load time from FetchedPage (slow > 3s → high, > 1s → medium)
 */
import type {
  DetectionPlugin,
  DetectionTarget,
  DetectionContext,
  DetectionResult,
  Finding,
} from "@test-harness/th-protocol";
import { calculateScore } from "@test-harness/th-detection";

export class PerformanceHeadersDetector implements DetectionPlugin {
  readonly id = "performance-headers";
  readonly name = "Performance Headers Check";
  readonly category = "performance" as const;
  readonly description =
    "Checks for performance-related HTTP headers and meta tags (Cache-Control, Content-Encoding, preload hints, DNS prefetch)";
  readonly version = "1.0.0";

  async execute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<DetectionResult> {
    const findings: Finding[] = [];
    const headers = target.pageData?.headers ?? {};

    const normalizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      normalizedHeaders[key.toLowerCase()] = value;
    }

    // Cache-Control header
    const cacheControl = normalizedHeaders["cache-control"];
    if (!cacheControl) {
      findings.push({
        id: "missing-cache-control",
        title: "Missing Cache-Control Header",
        severity: "medium",
        confidence: "certain",
        description:
          "Cache-Control header is not set. Without caching directives, browsers and CDNs will re-download resources on every request, increasing load times and bandwidth usage.",
        evidence: {
          type: "header",
          data: 'Header "cache-control" not found in response',
          context: `URL: ${target.url}`,
        },
        recommendation:
          'Add a Cache-Control header with appropriate directives (e.g., "public, max-age=31536000" for static assets, "no-cache" for dynamic content).',
        references: [
          "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control",
        ],
        url: target.url,
      });
    }

    // Content-Encoding header
    const contentEncoding = normalizedHeaders["content-encoding"];
    const hasCompression =
      contentEncoding &&
      (contentEncoding.includes("gzip") ||
        contentEncoding.includes("br") ||
        contentEncoding.includes("deflate"));
    if (!hasCompression) {
      findings.push({
        id: "missing-content-encoding",
        title: "Missing Response Compression",
        severity: "medium",
        confidence: "certain",
        description:
          "Content-Encoding header is not set to gzip, brotli, or deflate. Uncompressed responses are significantly larger, increasing transfer times.",
        evidence: {
          type: "header",
          data: `Content-Encoding: ${contentEncoding ?? "(none)"}`,
          context: `URL: ${target.url}`,
        },
        recommendation:
          "Enable gzip or Brotli compression on the server for text-based responses (HTML, CSS, JS, JSON).",
        url: target.url,
      });
    }

    // Check for preload hints in HTML
    const html = target.pageData?.html ?? target.domExtract?.url ? "" : "";
    const pageHtml = target.pageData?.html ?? "";
    if (pageHtml) {
      const preloadMatches = pageHtml.match(
        /<link[^>]+rel=["']preload["'][^>]*>/gi
      );
      const preloadCount = preloadMatches?.length ?? 0;
      if (preloadCount === 0) {
        findings.push({
          id: "no-preload-hints",
          title: "No Preload Hints Found",
          severity: "info",
          confidence: "tentative",
          description:
            "No <link rel=\"preload\"> hints were found. Preload hints allow browsers to prioritize critical resource downloads.",
          evidence: {
            type: "dom_element",
            data: "No <link rel=\"preload\"> elements detected",
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Add <link rel=\"preload\"> tags for critical above-the-fold resources (fonts, hero images, key CSS/JS).",
          url: target.url,
        });
      }
    }

    // X-DNS-Prefetch-Control
    const dnsPrefetch = normalizedHeaders["x-dns-prefetch-control"];
    const hasDnsPrefetchHeader = !!dnsPrefetch;
    const htmlDnsPrefetch =
      pageHtml.match(/<meta[^>]+http-equiv=["']x-dns-prefetch-control["']/i);
    if (!hasDnsPrefetchHeader && !htmlDnsPrefetch) {
      findings.push({
        id: "no-dns-prefetch-control",
        title: "Missing X-DNS-Prefetch-Control",
        severity: "info",
        confidence: "tentative",
        description:
          "X-DNS-Prefetch-Control is not set. DNS prefetching can speed up navigation to external domains by pre-resolving DNS lookups.",
        evidence: {
          type: "header",
          data: "No X-DNS-Prefetch-Control header or meta tag",
          context: `URL: ${target.url}`,
        },
        recommendation:
          'Set X-DNS-Prefetch-Control to "on" and add <link rel="dns-prefetch"> for external origins.',
        url: target.url,
      });
    }

    // Page load time check (from metadata if provided)
    const pageData = target.pageData as
      | (typeof target)["pageData"] & { loadTimeMs?: number }
      | undefined;
    const loadTimeMs = pageData?.loadTimeMs;
    if (typeof loadTimeMs === "number") {
      if (loadTimeMs > 3000) {
        findings.push({
          id: "slow-page-load",
          title: "Slow Page Load Time",
          severity: "high",
          confidence: "certain",
          description: `Page load time is ${loadTimeMs}ms, which exceeds the 3000ms threshold. Slow pages frustrate users and hurt SEO rankings.`,
          evidence: {
            type: "network",
            data: `Load time: ${loadTimeMs}ms`,
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Optimize critical rendering path, reduce resource sizes, enable compression, and leverage caching.",
          url: target.url,
        });
      } else if (loadTimeMs > 1000) {
        findings.push({
          id: "moderate-page-load",
          title: "Moderate Page Load Time",
          severity: "medium",
          confidence: "firm",
          description: `Page load time is ${loadTimeMs}ms. While under 3s, this is above the recommended 1000ms threshold.`,
          evidence: {
            type: "network",
            data: `Load time: ${loadTimeMs}ms`,
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Consider further optimizations: image compression, lazy loading, fewer render-blocking resources.",
          url: target.url,
        });
      }
    }

    return {
      detectionId: this.id,
      category: this.category,
      status: "completed",
      findings,
      score: calculateScore(findings),
      metadata: {
        headersChecked: 4,
        hasCompression: !!hasCompression,
        hasCacheControl: !!cacheControl,
        hasDnsPrefetch: !!hasDnsPrefetchHeader || !!htmlDnsPrefetch,
      },
      startedAt: new Date(),
      completedAt: new Date(),
    };
  }

  async canExecute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<boolean> {
    return !!target.pageData;
  }
}
