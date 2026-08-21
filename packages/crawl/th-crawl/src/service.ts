/**
 * CrawlService — unified entry point for web crawling.
 */
import { defineService } from "@test-harness/th-core";
import type {
  CrawlService,
  CrawlOptions,
  CrawledPage,
  FetchOptions,
  FetchedPage,
  ScreenshotOptions,
  Screenshot,
  DOMExtractOptions,
  DOMExtract,
  UrlCheckResult,
  PoolStatus,
} from "@test-harness/th-protocol";
import { HttpFetcher } from "./fetcher/http-fetcher.js";
import { DOMExtractor } from "./extractor/dom-extractor.js";
import { LinkExtractor } from "./extractor/link-extractor.js";
import { RobotsParser } from "./crawler/robots.js";

export const CrawlServiceDefinition =
  defineService<CrawlService>("CrawlService");

export class CrawlServiceImpl implements CrawlService {
  private httpFetcher = new HttpFetcher();
  private domExtractor = new DOMExtractor();
  private linkExtractor = new LinkExtractor();
  private robotsParser = new RobotsParser();

  async fetchPage(
    url: string,
    options?: FetchOptions
  ): Promise<FetchedPage> {
    return this.httpFetcher.fetch(url, options);
  }

  async *crawl(
    startUrl: string,
    options?: CrawlOptions
  ): AsyncIterable<CrawledPage> {
    const maxDepth = options?.maxDepth ?? 3;
    const maxPages = options?.maxPages ?? 100;
    const concurrency = options?.concurrency ?? 3;
    const respectRobots = options?.respectRobots ?? true;

    const base = new URL(startUrl);
    const visited = new Set<string>();
    const queue: Array<{ url: string; depth: number }> = [
      { url: startUrl, depth: 0 },
    ];

    let robots = respectRobots
      ? await this.robotsParser.parse(startUrl)
      : undefined;

    let count = 0;

    while (queue.length > 0 && count < maxPages) {
      // Process up to `concurrency` pages at once
      const batch = queue.splice(0, concurrency);
      const results = await Promise.allSettled(
        batch.map(async (item) => {
          if (visited.has(item.url)) return null;
          if (robots && !robots.allowed(new URL(item.url).pathname))
            return null;

          visited.add(item.url);
          const page = await this.fetchPage(item.url);
          if (page.error) return null;

          const dom = this.domExtractor.extract(page.html, page.url);
          const links = this.linkExtractor.extract(
            page.html,
            page.url
          );

          return {
            ...page,
            depth: item.depth,
            links,
            metadata: {
              title: dom.title,
              description: dom.meta["description"] ?? "",
              headings: dom.headings,
              images: dom.images.length,
              forms: dom.forms.length,
              scripts: dom.scripts.length,
            },
          } satisfies CrawledPage;
        })
      );

      for (const result of results) {
        if (result.status !== "fulfilled" || !result.value) continue;
        count++;
        yield result.value;

        // Enqueue discovered links
        if (result.value.depth < maxDepth) {
          for (const link of result.value.links) {
            if (
              !visited.has(link.href) &&
              (!options?.sameDomain || !link.isExternal) &&
              new URL(link.href).hostname === base.hostname
            ) {
              queue.push({
                url: link.href,
                depth: result.value.depth + 1,
              });
            }
          }
        }
      }
    }
  }

  async screenshot(
    _url: string,
    _options?: ScreenshotOptions
  ): Promise<Screenshot> {
    // Phase 2: Puppeteer-based screenshot
    throw new Error(
      "Browser-based screenshot requires Puppeteer (Phase 2)"
    );
  }

  async extractDOM(
    url: string,
    options?: DOMExtractOptions
  ): Promise<DOMExtract> {
    const page = await this.fetchPage(url);
    if (page.error) throw new Error(`Failed to fetch ${url}: ${page.error}`);
    return this.domExtractor.extract(page.html, url);
  }

  async checkUrl(url: string): Promise<UrlCheckResult> {
    const start = Date.now();
    try {
      const page = await this.fetchPage(url);
      return {
        url,
        status: page.status,
        ok: page.status >= 200 && page.status < 400,
        responseTime: page.loadTime,
        error: page.error,
      };
    } catch (err) {
      return {
        url,
        status: 0,
        ok: false,
        responseTime: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  getPoolStatus(): PoolStatus {
    // Phase 2: Browser pool status
    return { available: 0, inUse: 0, pending: 0, max: 0 };
  }
}
