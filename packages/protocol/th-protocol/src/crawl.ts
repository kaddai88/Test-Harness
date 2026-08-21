/**
 * Crawl service types — the capability seam for web crawling.
 */
import type { DOMExtract } from "./models.js";

/** HTTP or browser fetch mode */
export type FetchMode = "http" | "browser";

/** Options for fetching a single page */
export interface FetchOptions {
  mode?: FetchMode;
  headers?: Record<string, string>;
  timeout?: number;
  /** CSS selector to wait for (browser mode) */
  waitFor?: string;
  userAgent?: string;
  followRedirects?: boolean;
}

/** Result of fetching a single page */
export interface FetchedPage {
  url: string;
  originalUrl: string;
  status: number;
  headers: Record<string, string>;
  html: string;
  loadTime: number;
  redirects: RedirectInfo[];
  error?: string;
}

/** Redirect chain info */
export interface RedirectInfo {
  from: string;
  to: string;
  status: number;
}

/** Options for crawling multiple pages */
export interface CrawlOptions {
  maxDepth?: number;
  maxPages?: number;
  respectRobots?: boolean;
  rateLimit?: number;
  urlPatterns?: { include?: string[]; exclude?: string[] };
  sameDomain?: boolean;
  concurrency?: number;
}

/** A crawled page with extracted metadata */
export interface CrawledPage extends FetchedPage {
  depth: number;
  links: ExtractedLink[];
  metadata: PageMetadata;
}

/** Extracted link from a page */
export interface ExtractedLink {
  href: string;
  text: string;
  rel: string;
  isExternal: boolean;
}

/** Page metadata */
export interface PageMetadata {
  title: string;
  description: string;
  headings: Array<{ level: number; text: string }>;
  images: number;
  forms: number;
  scripts: number;
}

/** Screenshot options */
export interface ScreenshotOptions {
  fullPage?: boolean;
  viewport?: { width: number; height: number };
  format?: "png" | "jpeg";
}

/** Screenshot result */
export interface Screenshot {
  data: Buffer;
  format: string;
  width: number;
  height: number;
}

/** DOM extraction options */
export interface DOMExtractOptions {
  selector?: string;
  depth?: number;
  includeAttributes?: string[];
}

/** URL check result (for broken link detection) */
export interface UrlCheckResult {
  url: string;
  status: number;
  ok: boolean;
  responseTime: number;
  error?: string;
}

/** Browser pool status */
export interface PoolStatus {
  available: number;
  inUse: number;
  pending: number;
  max: number;
}

/**
 * CrawlService — the service definition for web crawling.
 */
export interface CrawlService {
  fetchPage(url: string, options?: FetchOptions): Promise<FetchedPage>;
  crawl(
    startUrl: string,
    options?: CrawlOptions
  ): AsyncIterable<CrawledPage>;
  screenshot(
    url: string,
    options?: ScreenshotOptions
  ): Promise<Screenshot>;
  extractDOM(
    url: string,
    options?: DOMExtractOptions
  ): Promise<DOMExtract>;
  checkUrl(url: string): Promise<UrlCheckResult>;
  getPoolStatus(): PoolStatus;
}
