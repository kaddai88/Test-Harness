/**
 * PlaywrightBrowserProvider — Playwright-based browser automation.
 *
 * Implements the BrowserDriver capability seam using Playwright.
 * Provides auto-waiting, reliable selectors, and cross-browser support.
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

import { chromium, type Browser, type Page, type Response } from "playwright";

export interface PlaywrightBrowserProviderConfig {
  /** Browser executable path */
  executablePath?: string;
  /** Default headless mode */
  headless?: boolean;
  /** Default viewport */
  defaultViewport?: { width: number; height: number };
  /** Connection timeout */
  timeout?: number;
  /** Browser type: chromium, firefox, webkit */
  browserType?: "chromium" | "firefox" | "webkit";
}

export class PlaywrightBrowserProvider implements BrowserDriver {
  readonly id = "playwright";
  readonly name = "Playwright Browser";

  private config: PlaywrightBrowserProviderConfig;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private consoleMessages: ConsoleMessage[] = [];
  private networkRequests: NetworkRequest[] = [];
  private requestStartTime = new Map<string, number>();

  constructor(config?: PlaywrightBrowserProviderConfig) {
    this.config = {
      headless: true,
      timeout: 30000,
      defaultViewport: { width: 1280, height: 800 },
      browserType: "chromium",
      ...config,
    };
  }

  async launch(options?: BrowserLaunchOptions): Promise<void> {
    const opts = { ...this.config, ...options };

    this.browser = await chromium.launch({
      executablePath: opts.executablePath,
      channel: opts.executablePath ? undefined : "chrome",
      headless: opts.headless === "shell" ? true : (opts.headless ?? true),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        ...(opts.ignoreHTTPSErrors ? ["--ignore-certificate-errors"] : []),
      ],
    });

    const context = await this.browser.newContext({
      viewport: {
        width: opts.viewportWidth ?? opts.defaultViewport?.width ?? 1280,
        height: opts.viewportHeight ?? opts.defaultViewport?.height ?? 800,
      },
      userAgent: opts.userAgent,
      extraHTTPHeaders: opts.extraHeaders,
      ignoreHTTPSErrors: opts.ignoreHTTPSErrors ?? false,
    });

    this.page = await context.newPage();

    // Setup console message capture
    this.page.on("console", (msg) => {
      const location = msg.location();
      this.consoleMessages.push({
        type: msg.type() as ConsoleMessage["type"],
        text: msg.text(),
        url: location.url,
        lineNumber: location.lineNumber,
      });
    });

    // Setup network request capture
    this.page.on("request", (request) => {
      this.requestStartTime.set(request.url(), Date.now());
    });

    this.page.on("response", async (response: Response) => {
      const url = response.url();
      const startTime = this.requestStartTime.get(url) ?? Date.now();
      this.requestStartTime.delete(url);

      try {
        const status = response.status();
        const headers = response.headers();
        const contentType = headers["content-type"] ?? "";
        const size = parseInt(headers["content-length"] ?? "0", 10);

        this.networkRequests.push({
          url,
          method: response.request().method(),
          status,
          resourceType: response.request().resourceType(),
          responseTime: Date.now() - startTime,
          size,
        });
      } catch {
        // Ignore response parsing errors
      }
    });

    // Set default timeout
    this.page.setDefaultTimeout(opts.timeout ?? 30000);
    this.page.setDefaultNavigationTimeout(opts.timeout ?? 30000);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async navigate(url: string, options?: NavigationOptions): Promise<PageInfo> {
    if (!this.page) throw new Error("Browser not launched");

    // Clear previous data
    this.consoleMessages = [];
    this.networkRequests = [];

    const response = await this.page.goto(url, {
      waitUntil: (options?.waitUntil ?? "domcontentloaded") as "domcontentloaded" | "load" | "networkidle",
      timeout: options?.timeout ?? 30000,
      referer: options?.referer,
    });

    return await this.getPageInfo(response ?? undefined);
  }

  async getPageInfo(response?: Response): Promise<PageInfo> {
    if (!this.page) throw new Error("Browser not launched");

    const url = this.page.url();
    const title = await this.page.title();
    const html = await this.page.content();

    // Get response status and headers
    let status = 200;
    let headers: Record<string, string> = {};
    if (response) {
      status = response.status();
      headers = response.headers();
    } else {
      // Try to get the last response
      const lastResponse = this.networkRequests[this.networkRequests.length - 1];
      if (lastResponse) {
        status = lastResponse.status;
      }
    }

    // Calculate load time
    const loadTime = this.networkRequests.length > 0
      ? Math.max(...this.networkRequests.map(r => r.responseTime))
      : 0;

    return {
      url,
      title,
      status,
      html,
      headers,
      loadTime,
      consoleMessages: [...this.consoleMessages],
      networkRequests: [...this.networkRequests],
    };
  }

  async click(selector: string, options?: ElementActionOptions): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");

    await this.page.click(selector, {
      timeout: options?.timeout ?? 30000,
      force: !options?.waitForVisible,
    });
  }

  async type(selector: string, text: string, options?: ElementActionOptions): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");

    await this.page.fill(selector, text, {
      timeout: options?.timeout ?? 30000,
    });
  }

  async fillForm(formSelector: string, data: FormData): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");

    for (const [field, value] of Object.entries(data)) {
      // Try multiple selector strategies
      const selectors = [
        `${formSelector} ${field}`,
        `${formSelector} [name="${field}"]`,
        `${formSelector} #${field}`,
        field,
        `[name="${field}"]`,
        `#${field}`,
      ];

      let filled = false;
      for (const selector of selectors) {
        try {
          await this.page.fill(selector, value, { timeout: 2000 });
          filled = true;
          break;
        } catch {
          // Try next selector
        }
      }

      if (!filled) {
        throw new Error(`Could not find field: ${field}`);
      }
    }
  }

  async submitForm(formSelector: string): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");

    // Try multiple submit strategies
    try {
      // Strategy 1: Click submit button
      await this.page.click(`${formSelector} button[type="submit"], ${formSelector} input[type="submit"]`, { timeout: 2000 });
    } catch {
      try {
        // Strategy 2: Press Enter on last input
        const inputs = await this.page.locator(`${formSelector} input`).all();
        if (inputs.length > 0) {
          await inputs[inputs.length - 1]!.press("Enter");
        }
      } catch {
        // Strategy 3: Evaluate form submit
        await this.page.evaluate((selector) => {
          const form = document.querySelector(selector) as HTMLFormElement;
          if (form) form.submit();
        }, formSelector);
      }
    }
  }

  async select(selector: string, value: string): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");

    await this.page.selectOption(selector, value);
  }

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    if (!this.page) throw new Error("Browser not launched");

    const screenshotOptions: any = {
      type: options?.format ?? "png",
      quality: options?.quality,
      fullPage: options?.fullPage ?? false,
      clip: options?.clip,
    };

    if (options?.selector) {
      return await this.page.locator(options.selector).screenshot(screenshotOptions) as Buffer;
    }

    return await this.page.screenshot(screenshotOptions) as Buffer;
  }

  async waitForSelector(selector: string, options?: { timeout?: number; visible?: boolean }): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");

    await this.page.waitForSelector(selector, {
      timeout: options?.timeout ?? 30000,
      state: options?.visible ? "visible" : "attached",
    });
  }

  async waitForNavigation(options?: NavigationOptions): Promise<PageInfo> {
    if (!this.page) throw new Error("Browser not launched");

    const [response] = await Promise.all([
      this.page.waitForResponse(() => true, { timeout: options?.timeout ?? 30000 }),
      this.page.waitForLoadState((options?.waitUntil ?? "domcontentloaded") as "domcontentloaded" | "load" | "networkidle"),
    ]);

    return await this.getPageInfo(response ?? undefined);
  }

  async evaluate<T>(fn: string | (() => T)): Promise<T> {
    if (!this.page) throw new Error("Browser not launched");

    if (typeof fn === "string") {
      return await this.page.evaluate(fn) as T;
    }
    return await this.page.evaluate(fn) as T;
  }

  async getElementInfo(selector: string): Promise<ElementInfo> {
    if (!this.page) throw new Error("Browser not launched");

    const element = this.page.locator(selector);
    const count = await element.count();

    if (count === 0) {
      return {
        exists: false,
        visible: false,
        text: "",
        tagName: "",
        attributes: {},
      };
    }

    const isVisible = await element.isVisible();
    const text = await element.textContent() ?? "";
    const tagName = await element.evaluate(el => el.tagName.toLowerCase());
    const boundingBox = await element.boundingBox();

    const attributes: Record<string, string> = {};
    const attrList = await element.evaluate(el => {
      const attrs: Record<string, string> = {};
      for (const attr of Array.from(el.attributes)) {
        attrs[attr.name] = attr.value;
      }
      return attrs;
    });
    Object.assign(attributes, attrList);

    return {
      exists: true,
      visible: isVisible,
      text,
      tagName,
      attributes,
      boundingBox: boundingBox ?? undefined,
    };
  }

  async isVisible(selector: string): Promise<boolean> {
    if (!this.page) throw new Error("Browser not launched");

    try {
      return await this.page.locator(selector).isVisible();
    } catch {
      return false;
    }
  }

  async getText(selector: string): Promise<string> {
    if (!this.page) throw new Error("Browser not launched");

    return await this.page.locator(selector).textContent() ?? "";
  }

  async getLinks(): Promise<Array<{ text: string; href: string; selector: string }>> {
    if (!this.page) throw new Error("Browser not launched");

    return await this.page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      return links.map((link, i) => ({
        text: link.textContent?.trim() ?? "",
        href: link.href,
        selector: `a:nth-of-type(${i + 1})`,
      }));
    });
  }

  async discoverFeatures(): Promise<DiscoveredFeature[]> {
    if (!this.page) throw new Error("Browser not launched");

    return await this.page.evaluate(() => {
      const features: DiscoveredFeature[] = [];

      // Discover forms
      document.querySelectorAll("form").forEach((form, i) => {
        const fields = Array.from(form.querySelectorAll("input, textarea, select")).map(input => ({
          name: (input as HTMLInputElement).name,
          type: (input as HTMLInputElement).type,
          selector: `${form.tagName.toLowerCase()}:nth-of-type(${i + 1}) ${(input as Element).tagName.toLowerCase()}[name="${(input as HTMLInputElement).name}"]`,
          required: (input as HTMLInputElement).required,
          placeholder: (input as HTMLInputElement).placeholder,
        }));

        features.push({
          type: "form",
          selector: `form:nth-of-type(${i + 1})`,
          action: form.action,
          method: form.method,
          fields,
        });
      });

      // Discover links
      document.querySelectorAll("a[href]").forEach((link, i) => {
        features.push({
          type: "link",
          selector: `a:nth-of-type(${i + 1})`,
          label: link.textContent?.trim(),
          href: link.getAttribute("href") ?? undefined,
        });
      });

      // Discover buttons
      document.querySelectorAll("button, input[type='button'], input[type='submit']").forEach((btn, i) => {
        features.push({
          type: "button",
          selector: `button:nth-of-type(${i + 1})`,
          label: (btn as HTMLButtonElement).textContent?.trim() ?? (btn as HTMLInputElement).value,
        });
      });

      return features;
    });
  }

  async getPerformanceMetrics(): Promise<PerformanceMetrics | null> {
    if (!this.page) throw new Error("Browser not launched");

    try {
      const metrics = await this.page.evaluate(() => {
        const perf = performance as any;
        const timing = perf.timing ?? {};
        const entries = perf.getEntriesByType("navigation") as any[];
        const navEntry = entries[0] ?? {};

        const paintEntries = perf.getEntriesByType("paint");
        const fcp = paintEntries.find((e: any) => e.name === "first-contentful-paint");

        return {
          ttfb: Number((navEntry as any).responseStart) || Number(timing.responseStart - timing.navigationStart) || 0,
          domContentLoaded: Number((navEntry as any).domContentLoadedEventEnd) || Number(timing.domContentLoadedEventEnd - timing.navigationStart) || 0,
          loadComplete: Number((navEntry as any).loadEventEnd) || Number(timing.loadEventEnd - timing.navigationStart) || 0,
          firstContentfulPaint: fcp?.startTime,
        };
      });

      return {
        ...metrics,
        pageSize: 0, // Playwright doesn't expose this directly
        requestCount: this.networkRequests.length,
      };
    } catch {
      return null;
    }
  }

  async getConsoleMessages(): Promise<ConsoleMessage[]> {
    return [...this.consoleMessages];
  }

  async getNetworkRequests(): Promise<NetworkRequest[]> {
    return [...this.networkRequests];
  }

  async goBack(): Promise<PageInfo> {
    if (!this.page) throw new Error("Browser not launched");

    await this.page.goBack();
    return await this.getPageInfo();
  }

  async goForward(): Promise<PageInfo> {
    if (!this.page) throw new Error("Browser not launched");

    await this.page.goForward();
    return await this.getPageInfo();
  }

  async reload(): Promise<PageInfo> {
    if (!this.page) throw new Error("Browser not launched");

    const response = await this.page.reload();
    return await this.getPageInfo(response ?? undefined);
  }

  async setViewport(width: number, height: number): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");

    await this.page.setViewportSize({ width, height });
  }

  async setExtraHeaders(headers: Record<string, string>): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");

    await this.page.setExtraHTTPHeaders(headers);
  }

  async setUserAgent(userAgent: string): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");

    // Playwright doesn't have page.setUserAgent, set it via context
    const context = this.page.context();
    await context.route("**/*", async (route) => {
      await route.continue({ headers: { ...route.request().headers(), "User-Agent": userAgent } });
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.page) return false;
      await this.page.evaluate(() => document.title);
      return true;
    } catch {
      return false;
    }
  }
}
