/**
 * Browser automation types — the capability seam for browser drivers.
 *
 * Follows DSH's Capability Seam pattern:
 * - BrowserDriverDefinition: the interface (Service Definition)
 * - PlaywrightBrowserProvider / PlaywrightMCPProvider: the implementations
 * - Agent Loop tools: the consumers
 *
 * v0.0.80 — aligned with @playwright/mcp tool set.
 */
import type { z } from "zod";
import type { CachedElement } from "./site-profile.js";

/** Browser launch options */
export interface BrowserLaunchOptions {
  /** Browser executable path (defaults to system Chrome/Chromium) */
  executablePath?: string;
  /** Headless mode (default: true) */
  headless?: boolean | "shell";
  /** Browser viewport width (default: 1280) */
  viewportWidth?: number;
  /** Browser viewport height (default: 800) */
  viewportHeight?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Ignore HTTPS errors (default: false) */
  ignoreHTTPSErrors?: boolean;
  /** User agent string */
  userAgent?: string;
  /** Proxy server URL */
  proxy?: string;
  /** Extra HTTP headers */
  extraHeaders?: Record<string, string>;
}

/** Page navigation options */
export interface NavigationOptions {
  /** Wait until condition (default: 'domcontentloaded') */
  waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
  /** Navigation timeout in ms */
  timeout?: number;
  /** Referer header */
  referer?: string;
}

/** Element interaction options */
export interface ElementActionOptions {
  /** CSS selector or XPath to locate element */
  selector: string;
  /** Action timeout in ms */
  timeout?: number;
  /** Wait for element to be visible before action */
  waitForVisible?: boolean;
}

/** Form fill data — maps field names/selectors to values */
export type FormData = Record<string, string>;

/** Screenshot options */
export interface ScreenshotOptions {
  /** Full page screenshot (default: false) */
  fullPage?: boolean;
  /** Image format (default: 'png') */
  format?: "png" | "jpeg" | "webp";
  /** JPEG quality (0-100, only for jpeg/webp) */
  quality?: number;
  /** Clip region */
  clip?: { x: number; y: number; width: number; height: number };
  /** Element selector to screenshot (instead of full page) */
  selector?: string;
}

/** Performance metrics from browser */
export interface PerformanceMetrics {
  /** Navigation timing — time to first byte */
  ttfb: number;
  /** Navigation timing — DOM content loaded */
  domContentLoaded: number;
  /** Navigation timing — page fully loaded */
  loadComplete: number;
  /** First Contentful Paint (if available) */
  firstContentfulPaint?: number;
  /** Largest Contentful Paint (if available) */
  largestContentfulPaint?: number;
  /** Cumulative Layout Shift (if available) */
  cumulativeLayoutShift?: number;
  /** Total page size in bytes */
  pageSize: number;
  /** Number of HTTP requests */
  requestCount: number;
  /** Number of DOM nodes */
  domNodeCount?: number;
}

/** Browser console message */
export interface ConsoleMessage {
  type: "log" | "warn" | "error" | "info" | "debug";
  text: string;
  url?: string;
  lineNumber?: number;
}

/** Network request info */
export interface NetworkRequest {
  url: string;
  method: string;
  status: number;
  resourceType: string;
  responseTime: number;
  size: number;
}

/** Page information extracted from browser */
export interface PageInfo {
  url: string;
  title: string;
  status: number;
  html: string;
  headers: Record<string, string>;
  loadTime: number;
  consoleMessages: ConsoleMessage[];
  networkRequests: NetworkRequest[];
  performanceMetrics?: PerformanceMetrics;
}

/** Feature discovered on a page */
export interface DiscoveredFeature {
  type: "form" | "link" | "button" | "input" | "image" | "video" | "iframe" | "script";
  selector: string;
  label?: string;
  href?: string;
  action?: string;
  method?: string;
  fields?: Array<{
    name: string;
    type: string;
    selector: string;
    required: boolean;
    placeholder?: string;
  }>;
}

/** Element information for assertions */
export interface ElementInfo {
  exists: boolean;
  visible: boolean;
  text: string;
  tagName: string;
  attributes: Record<string, string>;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

/**
 * Distilled interactive element — DOM reduced to LLM-consumable form.
 * Used by observe/find_element tools for cross-site generalization.
 */
export interface DistilledElement {
  /** Element ref for LLM reference (e.g., "@e1") */
  ref: string;
  /** Numeric index */
  index: number;
  /** HTML tag name */
  tag: string;
  /** Visible text content (truncated) */
  text: string;
  /** ARIA role (button, link, textbox, etc.) */
  role: string;
  /** ARIA label or accessible name */
  ariaLabel: string;
  /** Placeholder text (for inputs) */
  placeholder: string;
  /** Element name attribute */
  name: string;
  /** Element type attribute (for inputs) */
  type: string;
  /** Element id attribute */
  id: string;
  /** Whether element is visible and enabled */
  interactive: boolean;
  /** CSS selector to locate this element */
  selector: string;
  /** XPath to locate this element */
  xpath: string;
  /** Bounding box (if available) */
  box?: { x: number; y: number; width: number; height: number };
}

/** Result of DOM distillation */
export interface DistilledPage {
  /** Page URL */
  url: string;
  /** Page title */
  title: string;
  /** Distilled interactive elements */
  elements: DistilledElement[];
  /** Total element count */
  elementCount: number;
  /** Page structure hints */
  structure: {
    hasForms: boolean;
    formCount: number;
    hasTables: boolean;
    hasIframes: boolean;
    iframeCount: number;
    /** Detected application architecture/framework */
    architecture: 'extjs3' | 'extjs-modern' | 'jeesite' | 'react-spa' | 'vue-spa' | 'traditional' | 'unknown';
    /** Architecture-specific hints for testing */
    architectureHints: string[];
  };
}

/** Result from SmartLocator.findElement */
export interface FindElementResult {
  /** CSS selector that can be used with click/type/etc. */
  selector: string;
  /** XPath as backup */
  xpath?: string;
  /** Which strategy found this element */
  strategy: "cache" | "semantic" | "distill" | "css" | "xpath";
  /** Confidence score (0-1) */
  confidence: number;
  /** The semantic hint that was searched for */
  hint: string;
}

/**
 * BrowserDriver — the capability seam interface.
 * Every browser automation backend (Puppeteer, Playwright, etc.) implements this.
 */
export interface BrowserDriver {
  readonly id: string;
  readonly name: string;

  /** Launch browser and create a new page */
  launch(options?: BrowserLaunchOptions): Promise<void>;

  /** Close browser */
  close(): Promise<void>;

  /** Navigate to a URL */
  navigate(url: string, options?: NavigationOptions): Promise<PageInfo>;

  /** Get current page info */
  getPageInfo(): Promise<PageInfo>;

  /** Click an element */
  click(selector: string, options?: ElementActionOptions): Promise<void>;

  /** Type text into an input field */
  type(selector: string, text: string, options?: ElementActionOptions): Promise<void>;

  /** Fill a form with data */
  fillForm(formSelector: string, data: FormData): Promise<void>;

  /** Submit a form */
  submitForm(formSelector: string): Promise<void>;

  /** Select an option in a dropdown */
  select(selector: string, value: string): Promise<void>;

  /** Take a screenshot */
  screenshot(options?: ScreenshotOptions): Promise<Buffer>;

  /** Wait for an element to appear */
  waitForSelector(selector: string, options?: { timeout?: number; visible?: boolean }): Promise<void>;

  /** Wait for navigation to complete */
  waitForNavigation(options?: NavigationOptions): Promise<PageInfo>;

  /** Evaluate JavaScript in the page context */
  evaluate<T>(fn: string | (() => T)): Promise<T>;

  /** Get element information */
  getElementInfo(selector: string): Promise<ElementInfo>;

  /** Check if element is visible */
  isVisible(selector: string): Promise<boolean>;

  /** Get element text content */
  getText(selector: string): Promise<string>;

  /** Get all links on the page */
  getLinks(): Promise<Array<{ text: string; href: string; selector: string }>>;

  /** Discover interactive features on the page */
  discoverFeatures(): Promise<DiscoveredFeature[]>;

  /** Get performance metrics */
  getPerformanceMetrics(): Promise<PerformanceMetrics | null>;

  /** Get console messages */
  getConsoleMessages(): Promise<ConsoleMessage[]>;

  /** Get network requests */
  getNetworkRequests(): Promise<NetworkRequest[]>;

  /** Go back in history */
  goBack(): Promise<PageInfo>;

  /** Go forward in history */
  goForward(): Promise<PageInfo>;

  /** Reload the page */
  reload(): Promise<PageInfo>;

  /** Set viewport size */
  setViewport(width: number, height: number): Promise<void>;

  /** Set extra HTTP headers */
  setExtraHeaders(headers: Record<string, string>): Promise<void>;

  /** Set user agent */
  setUserAgent(userAgent: string): Promise<void>;

  /** Check if driver is healthy */
  healthCheck(): Promise<boolean>;

  // ─── v0.0.80 Enhanced Capabilities ───

  /** Hover over an element [MCP: browser_hover] */
  hover(selector: string): Promise<void>;

  /** Press a keyboard key [MCP: browser_press_key] */
  pressKey(key: string): Promise<void>;

  /** Handle a browser dialog (alert/confirm/prompt) [MCP: browser_handle_dialog] */
  handleDialog(accept: boolean, promptText?: string): Promise<void>;

  /** Upload file(s) via file chooser [MCP: browser_file_upload] */
  uploadFile(paths: string[]): Promise<void>;

  /** Get accessibility snapshot of the page [MCP: browser_snapshot] */
  getSnapshot(options?: { depth?: number; boxes?: boolean }): Promise<string>;

  /** Search for text/regex in the page snapshot [MCP: browser_find] */
  findInPage(options: { text?: string; regex?: string }): Promise<string>;

  /** Manage browser tabs [MCP: browser_tabs] */
  manageTabs(action: "list" | "new" | "close" | "select", index?: number, url?: string): Promise<any>;

  /** Drag from one element to another [MCP: browser_drag] */
  drag(startSelector: string, endSelector: string): Promise<void>;

  /** Drop files/data onto an element [MCP: browser_drop] */
  drop(targetSelector: string, options?: { paths?: string[]; data?: Record<string, string> }): Promise<void>;

  /** Get a specific cookie by name [MCP: browser_cookie_get] */
  getCookie(name: string): Promise<any>;

  /** Delete a specific cookie [MCP: browser_cookie_delete] */
  deleteCookie(name: string): Promise<void>;

  /** Clear all cookies [MCP: browser_cookie_clear] */
  clearCookies(): Promise<void>;

  // ─── Generalization Layer (Phase 1) ───

  /**
   * Distill the page DOM to an LLM-consumable summary.
   * Extracts only interactive elements with semantic attributes.
   * Used by observe/find_element tools for cross-site generalization.
   */
  distillDom(): Promise<DistilledPage>;

  /**
   * Find an element using multi-strategy semantic search.
   * Tries: cache → semantic search → DOM distillation → CSS selector → XPath.
   * This is the core self-healing locator for cross-site generalization.
   *
   * @param hint - Semantic description (e.g., "登录按钮", "search input")
   * @param selector - Optional CSS selector as fallback hint
   */
  findElement(hint: string, selector?: string): Promise<FindElementResult>;

  // ─── Generalization Layer (Phase 2): Site Cache Persistence ───

  /**
   * Get the current SmartLocator element cache.
   * Used by the worker to persist cache across sessions.
   */
  getSiteCache(): CachedElement[];

  /**
   * Load a previously saved element cache into the SmartLocator.
   * Called before a session starts to enable self-healing from prior knowledge.
   */
  setSiteCache(cache: CachedElement[]): void;
}
