/**
 * PuppeteerBrowserProvider — Puppeteer-based browser automation.
 *
 * Implements the BrowserDriver capability seam using puppeteer-core.
 * Supports headless and headed modes, viewport control, and full page interaction.
 */
import type {
  BrowserDriver,
  BrowserLaunchOptions,
  NavigationOptions,
  ElementActionOptions,
  FormData,
  ScreenshotOptions,
  PageInfo,
  PerformanceMetrics,
  ConsoleMessage,
  NetworkRequest,
  DiscoveredFeature,
  ElementInfo,
} from "./types.js";

// Dynamic import to avoid hard dependency on puppeteer-core at build time
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let puppeteer: any = null;

async function getPuppeteer(): Promise<any> {
  if (!puppeteer) {
    puppeteer = await import("puppeteer-core");
  }
  return puppeteer;
}

export interface PuppeteerBrowserProviderConfig {
  /** Chrome/Chromium executable path */
  executablePath?: string;
  /** Default headless mode */
  headless?: boolean | "shell";
  /** Default viewport */
  defaultViewport?: { width: number; height: number };
  /** Connection timeout */
  timeout?: number;
}

export class PuppeteerBrowserProvider implements BrowserDriver {
  readonly id = "puppeteer";
  readonly name = "Puppeteer Browser";

  private config: PuppeteerBrowserProviderConfig;
  private browser: any = null;
  private page: any = null;
  private consoleMessages: ConsoleMessage[] = [];
  private networkRequests: NetworkRequest[] = [];

  constructor(config?: PuppeteerBrowserProviderConfig) {
    this.config = {
      headless: true,
      timeout: 30000,
      defaultViewport: { width: 1280, height: 800 },
      ...config,
    };
  }

  async launch(options?: BrowserLaunchOptions): Promise<void> {
    const pptr = await getPuppeteer();
    const opts = { ...this.config, ...options };

    this.browser = await pptr.launch({
      executablePath: opts.executablePath,
      headless: opts.headless ?? true,
      defaultViewport: {
        width: opts.viewportWidth ?? opts.defaultViewport?.width ?? 1280,
        height: opts.viewportHeight ?? opts.defaultViewport?.height ?? 800,
      },
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        ...(opts.ignoreHTTPSErrors ? ["--ignore-certificate-errors"] : []),
      ],
    });

    const pages = await this.browser.pages();
    this.page = pages[0] ?? (await this.browser.newPage());

    // Setup console message capture
    this.page.on("console", (msg: any) => {
      this.consoleMessages.push({
        type: msg.type(),
        text: msg.text(),
        url: msg.location()?.url,
        lineNumber: msg.location()?.lineNumber,
      });
    });

    // Setup network request capture
    this.page.on("request", (request: any) => {
      (request as any)._startTime = Date.now();
    });

    this.page.on("response", (response: any) => {
      const request = response.request();
      const startTime = (request as any)._startTime ?? Date.now();
      this.networkRequests.push({
        url: request.url(),
        method: request.method(),
        status: response.status(),
        resourceType: request.resourceType(),
        responseTime: Date.now() - startTime,
        size: 0, // Response size not easily available without body
      });
    });

    if (opts.userAgent) {
      await this.page.setUserAgent(opts.userAgent);
    }

    if (opts.extraHeaders) {
      await this.page.setExtraHTTPHeaders(opts.extraHeaders);
    }

    if (opts.timeout) {
      this.page.setDefaultTimeout(opts.timeout);
      this.page.setDefaultNavigationTimeout(opts.timeout);
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async navigate(url: string, options?: NavigationOptions): Promise<PageInfo> {
    this.ensurePage();
    this.consoleMessages = [];
    this.networkRequests = [];

    const navOptions: any = {
      waitUntil: options?.waitUntil ?? "domcontentloaded",
    };
    if (options?.timeout) navOptions.timeout = options.timeout;
    if (options?.referer) navOptions.referer = options.referer;

    const response = await this.page.goto(url, navOptions);
    return this.getPageInfo(response?.status() ?? 0);
  }

  async getPageInfo(status?: number): Promise<PageInfo> {
    this.ensurePage();

    const url = this.page.url();
    const title = await this.page.title();
    const html = await this.page.content();

    // Extract headers from last response (limited — Puppeteer doesn't expose all headers easily)
    const headers: Record<string, string> = {};

    const loadTime = await this.page.evaluate(() => {
      const perf = performance.getEntriesByType("navigation")[0] as any;
      return perf ? perf.loadEventEnd - perf.startTime : 0;
    });

    return {
      url,
      title,
      status: status ?? 200,
      html,
      headers,
      loadTime,
      consoleMessages: [...this.consoleMessages],
      networkRequests: [...this.networkRequests],
    };
  }

  async click(selector: string, options?: ElementActionOptions): Promise<void> {
    this.ensurePage();
    if (options?.waitForVisible) {
      await this.page.waitForSelector(selector, {
        visible: true,
        timeout: options.timeout,
      });
    }
    await this.page.click(selector);
  }

  async type(selector: string, text: string, options?: ElementActionOptions): Promise<void> {
    this.ensurePage();
    if (options?.waitForVisible) {
      await this.page.waitForSelector(selector, {
        visible: true,
        timeout: options.timeout,
      });
    }
    await this.page.type(selector, text);
  }

  async fillForm(formSelector: string, data: FormData): Promise<void> {
    this.ensurePage();
    for (const [field, value] of Object.entries(data)) {
      // Try by name attribute first, then by selector
      const selector = field.startsWith("[") || field.startsWith(".") || field.startsWith("#")
        ? field
        : `${formSelector} [name="${field}"]`;
      await this.page.type(selector, value);
    }
  }

  async submitForm(formSelector: string): Promise<void> {
    this.ensurePage();
    await this.page.evaluate((selector: string) => {
      const form = document.querySelector(selector) as HTMLFormElement;
      if (form) form.submit();
    }, formSelector);
  }

  async select(selector: string, value: string): Promise<void> {
    this.ensurePage();
    await this.page.select(selector, value);
  }

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    this.ensurePage();
    const screenshotOptions: any = {
      encoding: "binary",
      type: options?.format ?? "png",
    };

    if (options?.fullPage) screenshotOptions.fullPage = true;
    if (options?.quality) screenshotOptions.quality = options.quality;
    if (options?.clip) screenshotOptions.clip = options.clip;
    if (options?.selector) {
      const element = await this.page.$(options.selector);
      if (!element) throw new Error(`Element not found: ${options.selector}`);
      return Buffer.from(await element.screenshot(screenshotOptions));
    }

    return Buffer.from(await this.page.screenshot(screenshotOptions));
  }

  async waitForSelector(
    selector: string,
    options?: { timeout?: number; visible?: boolean }
  ): Promise<void> {
    this.ensurePage();
    await this.page.waitForSelector(selector, {
      timeout: options?.timeout,
      visible: options?.visible,
    });
  }

  async waitForNavigation(options?: NavigationOptions): Promise<PageInfo> {
    this.ensurePage();
    const navOptions: any = {
      waitUntil: options?.waitUntil ?? "domcontentloaded",
    };
    if (options?.timeout) navOptions.timeout = options.timeout;

    await this.page.waitForNavigation(navOptions);
    return this.getPageInfo();
  }

  async evaluate<T>(fn: string | (() => T)): Promise<T> {
    this.ensurePage();
    return this.page.evaluate(fn);
  }

  async getElementInfo(selector: string): Promise<ElementInfo> {
    this.ensurePage();
    return this.page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) {
        return {
          exists: false,
          visible: false,
          text: "",
          tagName: "",
          attributes: {},
        };
      }
      const rect = el.getBoundingClientRect();
      const attrs: Record<string, string> = {};
      for (const attr of Array.from(el.attributes)) {
        attrs[attr.name] = attr.value;
      }
      return {
        exists: true,
        visible: rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden",
        text: (el as HTMLElement).innerText ?? "",
        tagName: el.tagName.toLowerCase(),
        attributes: attrs,
        boundingBox: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      };
    }, selector);
  }

  async isVisible(selector: string): Promise<boolean> {
    const info = await this.getElementInfo(selector);
    return info.exists && info.visible;
  }

  async getText(selector: string): Promise<string> {
    this.ensurePage();
    return this.page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      return el ? (el as HTMLElement).innerText ?? "" : "";
    }, selector);
  }

  async getLinks(): Promise<Array<{ text: string; href: string; selector: string }>> {
    this.ensurePage();
    return this.page.evaluate(() => {
      const links: Array<{ text: string; href: string; selector: string }> = [];
      document.querySelectorAll("a[href]").forEach((a, i) => {
        links.push({
          text: (a as HTMLElement).innerText?.trim() ?? "",
          href: a.getAttribute("href") ?? "",
          selector: `a:nth-of-type(${i + 1})`,
        });
      });
      return links;
    });
  }

  async discoverFeatures(): Promise<DiscoveredFeature[]> {
    this.ensurePage();
    return this.page.evaluate(() => {
      const features: DiscoveredFeature[] = [];

      // Discover forms
      document.querySelectorAll("form").forEach((form: HTMLFormElement, i: number) => {
        const fields: DiscoveredFeature["fields"] = [];
        form.querySelectorAll("input, textarea, select").forEach((input: Element) => {
          const el = input as HTMLInputElement;
          fields.push({
            name: el.name || el.id || "",
            type: el.type || el.tagName.toLowerCase(),
            selector: `[name="${el.name}"]` || `#${el.id}`,
            required: el.required,
            placeholder: el.placeholder,
          });
        });
        features.push({
          type: "form",
          selector: `form:nth-of-type(${i + 1})`,
          action: form.action,
          method: form.method?.toUpperCase() ?? "GET",
          fields,
        });
      });

      // Discover buttons
      document.querySelectorAll("button, input[type='submit'], input[type='button']").forEach((btn: Element, i: number) => {
        const el = btn as HTMLButtonElement;
        features.push({
          type: "button",
          selector: `button:nth-of-type(${i + 1})`,
          label: el.innerText ?? el.value ?? "",
        });
      });

      // Discover inputs
      document.querySelectorAll("input:not([type='submit']):not([type='button']), textarea").forEach((input: Element, i: number) => {
        const el = input as HTMLInputElement;
        features.push({
          type: "input",
          selector: `input:nth-of-type(${i + 1})`,
          label: el.name || el.placeholder || "",
        });
      });

      // Discover iframes
      document.querySelectorAll("iframe").forEach((iframe: HTMLIFrameElement, i: number) => {
        features.push({
          type: "iframe",
          selector: `iframe:nth-of-type(${i + 1})`,
          href: iframe.src,
        });
      });

      return features;
    });
  }

  async getPerformanceMetrics(): Promise<PerformanceMetrics | null> {
    this.ensurePage();
    return this.page.evaluate(() => {
      const nav = (performance.getEntriesByType("navigation") as PerformanceNavigationTiming[])[0];
      if (!nav) return null;

      let lcp = 0;
      let cls = 0;
      let fcp = 0;

      // Try to get LCP
      const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
      if (lcpEntries.length > 0) {
        lcp = (lcpEntries[lcpEntries.length - 1] as PerformanceEntry).startTime;
      }

      // Try to get FCP
      const fcpEntries = performance.getEntriesByType("paint");
      for (const entry of fcpEntries) {
        if (entry.name === "first-contentful-paint") {
          fcp = entry.startTime;
          break;
        }
      }

      // Try to get CLS
      let clsEntries: PerformanceEntry[] = [];
      try {
        clsEntries = performance.getEntriesByType("layout-shift");
      } catch {
        // CLS not supported in all browsers
      }
      for (const entry of clsEntries) {
        const clsEntry = entry as any;
        if (!clsEntry.hadRecentInput) {
          cls += clsEntry.value ?? 0;
        }
      }

      // Calculate page size
      const resources = performance.getEntriesByType("resource");
      let pageSize = 0;
      for (const resource of resources) {
        const resEntry = resource as PerformanceResourceTiming;
        pageSize += (resEntry as any).transferSize ?? 0;
      }

      return {
        ttfb: nav.responseStart - nav.startTime,
        domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
        loadComplete: nav.loadEventEnd - nav.startTime,
        firstContentfulPaint: fcp || undefined,
        largestContentfulPaint: lcp || undefined,
        cumulativeLayoutShift: cls || undefined,
        pageSize,
        requestCount: resources.length,
        domNodeCount: document.querySelectorAll("*").length,
      };
    });
  }

  async getConsoleMessages(): Promise<ConsoleMessage[]> {
    return [...this.consoleMessages];
  }

  async getNetworkRequests(): Promise<NetworkRequest[]> {
    return [...this.networkRequests];
  }

  async goBack(): Promise<PageInfo> {
    this.ensurePage();
    await this.page.goBack({ waitUntil: "domcontentloaded" });
    return this.getPageInfo();
  }

  async goForward(): Promise<PageInfo> {
    this.ensurePage();
    await this.page.goForward({ waitUntil: "domcontentloaded" });
    return this.getPageInfo();
  }

  async reload(): Promise<PageInfo> {
    this.ensurePage();
    await this.page.reload({ waitUntil: "domcontentloaded" });
    return this.getPageInfo();
  }

  async setViewport(width: number, height: number): Promise<void> {
    this.ensurePage();
    await this.page.setViewport({ width, height });
  }

  async setExtraHeaders(headers: Record<string, string>): Promise<void> {
    this.ensurePage();
    await this.page.setExtraHTTPHeaders(headers);
  }

  async setUserAgent(userAgent: string): Promise<void> {
    this.ensurePage();
    await this.page.setUserAgent(userAgent);
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (this.page) {
        await this.page.evaluate(() => 1 + 1);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private ensurePage(): void {
    if (!this.page) {
      throw new Error("Browser not launched. Call launch() first.");
    }
  }
}
