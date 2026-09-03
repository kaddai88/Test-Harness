/**
 * Playwright MCP Client — based on @playwright/mcp v0.0.80 official tool set.
 *
 * All 30+ tools from @playwright/mcp:
 * Core: browser_snapshot, browser_navigate, browser_click, browser_type,
 *       browser_fill_form, browser_select_option, browser_take_screenshot,
 *       browser_evaluate, browser_run_code_unsafe, browser_hover,
 *       browser_press_key, browser_drag, browser_drop, browser_file_upload,
 *       browser_handle_dialog, browser_find, browser_wait_for, browser_resize,
 *       browser_navigate_back, browser_navigate_forward, browser_close
 * Diagnostics: browser_console_messages, browser_network_requests, browser_network_request
 * Tabs: browser_tabs
 * Cookies (opt-in): browser_cookie_get, browser_cookie_delete, browser_cookie_clear
 * Network mock (opt-in): browser_route, browser_route_list, browser_unroute, browser_network_state_set
 * Config (opt-in): browser_get_config
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn } from "node:child_process";
import type { BrowserDriver, BrowserLaunchOptions, NavigationOptions, ElementActionOptions, FormData, ScreenshotOptions, PageInfo, PerformanceMetrics, ConsoleMessage, NetworkRequest, DiscoveredFeature, ElementInfo, DistilledPage, FindElementResult } from "./types.js";
import type { CachedElement } from "./site-profile.js";
import { SmartLocator } from "./smart-locator.js";
import { DISTILL_SCRIPT } from "./distill-dom.js";

export interface PlaywrightMCPConfig {
  serverUrl?: string;
  serverPath?: string;
  serverArgs?: string[];
  timeout?: number;
}

export class PlaywrightMCPProvider implements BrowserDriver {
  readonly id = "playwright-mcp";
  readonly name = "Playwright MCP Browser";

  private config: PlaywrightMCPConfig;
  private client: Client | null = null;
  private serverProcess: any = null;
  private isConnected = false;
  private smartLocator: SmartLocator;

  constructor(config?: PlaywrightMCPConfig) {
    this.config = { serverUrl: "http://localhost:3001", timeout: 30000, ...config };
    this.smartLocator = new SmartLocator(this as unknown as BrowserDriver);
  }

  async launch(_options?: BrowserLaunchOptions): Promise<void> {
    if (this.config.serverPath) {
      this.serverProcess = spawn(this.config.serverPath, this.config.serverArgs ?? [], {
        stdio: "pipe",
        env: { ...process.env, PORT: "3001" },
      });
      await new Promise((r) => setTimeout(r, 2000));
    }
    this.client = new Client({ name: "test-harness", version: "1.0.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(this.config.serverUrl!));
    await this.client.connect(transport);
    this.isConnected = true;
    console.log('[MCP] Connected to Playwright MCP server');
  }

  async close(): Promise<void> {
    try {
      await this.callTool("browser_close", {});
    } catch {
      // Page may already be closed
    }
    if (this.client) { await this.client.close(); this.client = null; }
    if (this.serverProcess) { this.serverProcess.kill(); this.serverProcess = null; }
    this.isConnected = false;
  }

  // ─── MCP helpers ───

  private extractSection(text: string, section: string): string {
    const idx = text.indexOf(`### ${section}\n`);
    if (idx === -1) return text;
    const after = text.slice(idx + `### ${section}\n`.length);
    const next = after.indexOf('\n### ');
    return (next !== -1 ? after.slice(0, next) : after).trim();
  }

  private extractText(result: any): string {
    const raw = result?.content?.[0]?.text ?? '';
    const section = this.extractSection(raw, 'Result');
    // Strip one layer of surrounding quotes
    if (section.startsWith('"') && section.endsWith('"') && section.length > 2) {
      return section.slice(1, -1);
    }
    return section;
  }

  private extractJson(result: any): any {
    const section = this.extractSection(result?.content?.[0]?.text ?? '', 'Result');
    // First parse: may return a string if content was JSON.stringify'd
    try {
      const first = JSON.parse(section);
      // If it's a string, it was double-encoded — parse again
      if (typeof first === 'string') {
        try { return JSON.parse(first); } catch { return first; }
      }
      return first;
    } catch {
      return section;
    }
  }

  // JS helper: cross-frame querySelector (searches main doc + same-origin iframes only)
  // Note: For cross-origin iframe support, use browser_run_code_unsafe with page.frames()
  // See getPageInfo() for an example of native iframe handling.
  private static readonly CROSS_FRAME_QUERY = `
    function cfq(sel, root) {
      root = root || document;
      var el = root.querySelector(sel);
      if (el) return el;
      var iframes = root.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try { var inner = iframes[i].contentDocument; if (inner) { el = cfq(sel, inner); if (el) return el; } } catch(e) {}
      }
      return null;
    }
    function cfqa(sel, root) {
      root = root || document;
      var els = Array.from(root.querySelectorAll(sel));
      var iframes = root.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try { var inner = iframes[i].contentDocument; if (inner) els = els.concat(Array.from(inner.querySelectorAll(sel))); } catch(e) {}
      }
      return els;
    }`;

  private async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    if (!this.client || !this.isConnected) throw new Error("MCP client not connected");
    try {
      const result = await this.client.callTool({ name, arguments: args });
      if (result?.isError) console.error(`[MCP] ${name} error:`, this.extractText(result).slice(0, 200));
      return result;
    } catch (err) {
      console.error(`[MCP] ${name} threw:`, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Navigation (official: browser_navigate) ───

  async navigate(url: string, _options?: NavigationOptions): Promise<PageInfo> {
    await this.callTool("browser_navigate", { url });
    await new Promise((r) => setTimeout(r, 800));
    return await this.getPageInfo();
  }

  async goBack(): Promise<PageInfo> {
    await this.callTool("browser_navigate_back", {});
    await new Promise((r) => setTimeout(r, 500));
    return await this.getPageInfo();
  }

  async goForward(): Promise<PageInfo> {
    await this.callTool("browser_navigate_forward", {});
    await new Promise((r) => setTimeout(r, 500));
    return await this.getPageInfo();
  }

  async reload(): Promise<PageInfo> {
    // Use browser_run_code_unsafe for native page.reload()
    await this.callTool("browser_run_code_unsafe", {
      code: `async (page) => { await page.reload(); return 'ok'; }`,
    });
    await new Promise((r) => setTimeout(r, 800));
    return await this.getPageInfo();
  }

  // ─── Page Info (browser_run_code_unsafe for native iframe support) ───

  /**
   * Get current page info including all iframe content.
   * 
   * Uses browser_run_code_unsafe (v0.0.72+) to access Playwright's page.frames() API,
   * which natively supports all iframes including cross-origin ones.
   * This is more reliable than browser_evaluate with manual iframe traversal.
   */
  async getPageInfo(): Promise<PageInfo> {
    // Use browser_run_code_unsafe to access Playwright's native frame handling
    // page.frames() returns all frames including cross-origin iframes
    const result = await this.callTool("browser_run_code_unsafe", {
      code: `async (page) => {
        const frames = page.frames();
        const frameData = [];
        
        for (const frame of frames) {
          try {
            const url = frame.url();
            const name = frame.name();
            // Skip about:blank frames (empty iframes)
            if (url === 'about:blank' && !name) continue;
            
            const html = await frame.content();
            frameData.push({
              url,
              name,
              html,
              isMain: frame === page.mainFrame()
            });
          } catch (e) {
            // Frame may be detached or inaccessible
            frameData.push({
              url: frame.url(),
              name: frame.name(),
              html: '',
              isMain: frame === page.mainFrame(),
              error: e.message
            });
          }
        }
        
        return JSON.stringify({
          url: page.url(),
          title: await page.title(),
          frames: frameData
        });
      }`,
    });
    
    let info: { url?: string; title?: string; frames?: Array<{ url: string; name: string; html: string; isMain: boolean; error?: string }> };
    try { info = this.extractJson(result); } catch { info = {}; }

    // Combine all frame HTML into a single document with iframe markers
    let combinedHtml = '';
    if (info.frames && info.frames.length > 0) {
      // Find main frame first
      const mainFrame = info.frames.find(f => f.isMain);
      if (mainFrame) {
        combinedHtml = mainFrame.html;
      }
      // Append other frames with markers
      for (const frame of info.frames) {
        if (!frame.isMain && frame.html) {
          const marker = `<!-- IFRAME: ${frame.name || frame.url} -->`;
          combinedHtml += `\n${marker}\n${frame.html}`;
        }
      }
    }

    return {
      url: info.url ?? '',
      title: info.title ?? '',
      status: 200,
      html: combinedHtml,
      headers: {},
      loadTime: 0,
      consoleMessages: [],
      networkRequests: [],
    };
  }

  // ─── Element Interaction (official: browser_click/browser_type with target param) ──

  async click(selector: string, _options?: ElementActionOptions): Promise<void> {
    const r = await this.callTool("browser_click", {
      element: `Click ${selector}`,
      target: selector,
    });
    if (r?.isError) throw new Error(`Click failed: ${this.extractText(r).slice(0, 200)}`);
  }

  async type(selector: string, text: string, _options?: ElementActionOptions): Promise<void> {
    const r = await this.callTool("browser_type", {
      element: `Type into ${selector}`,
      target: selector,
      text,
    });
    if (r?.isError) throw new Error(`Type failed: ${this.extractText(r).slice(0, 200)}`);
  }

  /** Official browser_fill_form: fields = [{ target, name, value, type }] */
  async fillForm(formSelector: string, data: FormData): Promise<void> {
    const fields = Object.entries(data).map(([name, value]) => ({
      target: `${formSelector} [name="${name}"], ${formSelector} #${name}, [name="${name}"], #${name}`,
      name,
      value,
      type: 'textbox' as const,
    }));

    const r = await this.callTool("browser_fill_form", { fields });
    if (r?.isError) {
      // Fallback: cross-frame evaluate to fill fields
      const fs = formSelector.replace(/'/g, "\\'");
      const assignments = Object.entries(data).map(([field, value]) => {
        const ev = value.replace(/'/g, "\\'");
        return `var e=cfq('${fs} [name="${field}"]')||cfq('${fs} #${field}')||cfq('[name="${field}"]')||cfq('#${field}');if(e){e.value='${ev}';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}`;
      }).join('');
      await this.callTool("browser_evaluate", { function: `() => { ${PlaywrightMCPProvider.CROSS_FRAME_QUERY} ${assignments} return 'ok'; }` });
    }

    // Verify (cross-frame)
    const checks = Object.entries(data).map(([field, value]) =>
      `var e=cfq('[name="${field}"]')||cfq('#${field}');if(!e||e.value!=='${value.replace(/'/g, "\\'")}')throw new Error('${field} not filled');`
    ).join('');
    await this.callTool("browser_evaluate", { function: `() => { ${PlaywrightMCPProvider.CROSS_FRAME_QUERY} ${checks} return 'ok'; }` });
  }

  async submitForm(formSelector: string): Promise<void> {
    // Try native click on submit button
    const selectors = [
      `${formSelector} button[type="submit"]`,
      `${formSelector} input[type="submit"]`,
      `${formSelector} button`,
      'button[type="submit"]',
    ];
    for (const sel of selectors) {
      try {
        const r = await this.callTool("browser_click", { element: `Submit ${sel}`, target: sel });
        if (!r?.isError) return;
      } catch { /* try next */ }
    }
    // Fallback: cross-frame evaluate form.submit()
    const s = formSelector.replace(/'/g, "\\'");
    await this.callTool("browser_evaluate", {
      function: `() => { ${PlaywrightMCPProvider.CROSS_FRAME_QUERY} var f=cfq('${s}'); if(f&&f.tagName==='FORM'){f.submit();return 'ok';} throw new Error('No form found'); }`,
    });
  }

  async select(selector: string, value: string, _options?: ElementActionOptions): Promise<void> {
    const r = await this.callTool("browser_select_option", {
      element: `Select in ${selector}`,
      target: selector,
      values: [value],
    });
    if (r?.isError) throw new Error(`Select failed: ${this.extractText(r).slice(0, 200)}`);
  }

  // ─── Screenshot (official: browser_take_screenshot) ───

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    const r = await this.callTool("browser_take_screenshot", {
      fullPage: options?.fullPage ?? false,
      filename: `screenshot.${options?.format ?? 'png'}`,
      scale: 'css',
    });
    if (r?.content?.[0]?.data) return Buffer.from(r.content[0].data, "base64");
    throw new Error("Screenshot failed");
  }

  // ─── Wait ──

  async waitForSelector(selector: string, options?: { timeout?: number; visible?: boolean }): Promise<void> {
    const timeout = options?.timeout ?? this.config.timeout ?? 30000;
    const state = options?.visible ? 'visible' : 'attached';
    // Use browser_run_code_unsafe for native page.waitForSelector()
    const s = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const r = await this.callTool("browser_run_code_unsafe", {
      code: `async (page) => {
        try {
          await page.waitForSelector('${s}', { state: '${state}', timeout: ${timeout} });
          return 'ok';
        } catch (e) {
          return 'timeout:' + e.message;
        }
      }`,
    });
    const text = this.extractText(r);
    if (text.startsWith('timeout:')) {
      throw new Error(`waitForSelector timeout: ${selector}`);
    }
  }

  async waitForNavigation(options?: NavigationOptions): Promise<PageInfo> {
    const timeout = options?.timeout ?? this.config.timeout ?? 30000;
    // Use browser_wait_for with textGone to wait for page load
    // Alternatively use browser_run_code_unsafe for page.waitForLoadState
    await this.callTool("browser_run_code_unsafe", {
      code: `async (page) => {
        await page.waitForLoadState('domcontentloaded', { timeout: ${timeout} });
        return 'ok';
      }`,
    });
    return await this.getPageInfo();
  }

  // ─── Evaluate (official: browser_evaluate) ───

  async evaluate<T>(fn: string | (() => T)): Promise<T> {
    const script = typeof fn === "string" ? fn : fn.toString();
    const r = await this.callTool("browser_evaluate", { function: script });
    return this.extractText(r) as T;
  }

  // ─── DOM Queries (cross-frame via browser_evaluate) ───

  async getElementInfo(selector: string): Promise<ElementInfo> {
    const s = selector.replace(/'/g, "\\'");
    const r = await this.callTool("browser_evaluate", {
      function: `() => { ${PlaywrightMCPProvider.CROSS_FRAME_QUERY} var el=cfq('${s}');if(!el)return JSON.stringify({exists:false});const a={};for(const attr of el.attributes)a[attr.name]=attr.value;return JSON.stringify({exists:true,visible:el.offsetWidth>0&&el.offsetHeight>0,text:(el.innerText||'').slice(0,200),tagName:el.tagName.toLowerCase(),attributes:a}); }`,
    });
    try { return this.extractJson(r); } catch { return { exists: false, visible: false, text: '', tagName: '', attributes: {} }; }
  }

  async isVisible(selector: string): Promise<boolean> {
    const s = selector.replace(/'/g, "\\'");
    const r = await this.callTool("browser_evaluate", {
      function: `() => { ${PlaywrightMCPProvider.CROSS_FRAME_QUERY} var el=cfq('${s}');if(!el)return false;const r=el.getBoundingClientRect(),w=getComputedStyle(el);return r.width>0&&r.height>0&&w.visibility!=='hidden'&&w.display!=='none'; }`,
    });
    return this.extractText(r) === 'true';
  }

  async getText(selector: string): Promise<string> {
    const s = selector.replace(/'/g, "\\'");
    const r = await this.callTool("browser_evaluate", {
      function: `() => { ${PlaywrightMCPProvider.CROSS_FRAME_QUERY} var el=cfq('${s}');return el?(el.innerText||el.textContent||''):''; }`,
    });
    return this.extractText(r);
  }

  // ─── discoverFeatures/getLinks via browser_run_code_unsafe ───

  async getLinks(): Promise<Array<{ text: string; href: string; selector: string }>> {
    const result = await this.callTool("browser_run_code_unsafe", {
      code: `async (page) => {
        return JSON.stringify(await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href]'));
          return links.map((link, i) => ({
            text: (link.textContent || '').trim().slice(0, 100),
            href: link.href,
            selector: 'a:nth-of-type(' + (i + 1) + ')'
          }));
        }));
      }`,
    });
    try { return this.extractJson(result); } catch { return []; }
  }

  async discoverFeatures(): Promise<DiscoveredFeature[]> {
    const result = await this.callTool("browser_run_code_unsafe", {
      code: `async (page) => {
        return JSON.stringify(await page.evaluate(() => {
          const features = [];
          // Forms
          document.querySelectorAll('form').forEach((form, i) => {
            const fields = Array.from(form.querySelectorAll('input, textarea, select')).map(input => ({
              name: input.name,
              type: input.type,
              selector: form.tagName.toLowerCase() + ':nth-of-type(' + (i + 1) + ') ' + input.tagName.toLowerCase() + '[name="' + input.name + '"]',
              required: input.required,
              placeholder: input.placeholder
            }));
            features.push({ type: 'form', selector: 'form:nth-of-type(' + (i + 1) + ')', action: form.action, method: form.method, fields });
          });
          // Links
          document.querySelectorAll('a[href]').forEach((link, i) => {
            features.push({ type: 'link', selector: 'a:nth-of-type(' + (i + 1) + ')', label: (link.textContent || '').trim(), href: link.getAttribute('href') });
          });
          // Buttons
          document.querySelectorAll('button, input[type="button"], input[type="submit"]').forEach((btn, i) => {
            features.push({ type: 'button', selector: 'button:nth-of-type(' + (i + 1) + ')', label: btn.textContent?.trim() || btn.value });
          });
          return features;
        }));
      }`,
    });
    try { return this.extractJson(result); } catch { return []; }
  }

  // ─── Performance & Diagnostics ──

  async getPerformanceMetrics(): Promise<PerformanceMetrics | null> {
    const r = await this.callTool("browser_evaluate", {
      function: `() => { const p=performance,n=(p.getEntriesByType('navigation')[0]||{}),f=p.getEntriesByType('paint').find(e=>e.name==='first-contentful-paint');return JSON.stringify({ttfb:n.responseStart||0,dc:n.domContentLoadedEventEnd||0,lc:n.loadEventEnd||0,fcp:f?.startTime,dn:document.querySelectorAll('*').length}); }`,
    });
    try {
      const d = this.extractJson(r);
      return { ttfb: Number(d.ttfb ?? 0), domContentLoaded: Number(d.dc ?? 0), loadComplete: Number(d.lc ?? 0), firstContentfulPaint: d.fcp, pageSize: 0, requestCount: 0, domNodeCount: d.dn };
    } catch { return null; }
  }

  async getConsoleMessages(): Promise<ConsoleMessage[]> {
    try {
      const r = await this.callTool("browser_console_messages", { level: "info", all: true });
      const text = this.extractText(r);
      if (!text) return [];
      // Parse structured console output: each line is a message
      // Format varies but typically: "[level] message" or just "message"
      return text.split('\n').filter((l: string) => l.trim()).map((line: string) => {
        const levelMatch = line.match(/^\[(\w+)\]/);
        const type = (levelMatch?.[1] ?? 'info') as ConsoleMessage['type'];
        const msg = levelMatch ? line.slice(levelMatch[0].length).trim() : line.trim();
        return { type, text: msg };
      });
    } catch { return []; }
  }

  async getNetworkRequests(): Promise<NetworkRequest[]> {
    try {
      const r = await this.callTool("browser_network_requests", {});
      const text = this.extractText(r);
      if (!text) return [];
      // Parse numbered list: "1. GET https://... 200 (stylesheet)"
      // Format: "N. METHOD URL STATUS (type)"
      return text.split('\n').filter((l: string) => l.trim()).map((line: string): NetworkRequest => {
        const match = line.match(/^\s*\d+\.\s+(\w+)\s+(\S+)\s+(\d+)?\s*\(?([\w-]+)?\)?/);
        if (match) {
          return {
            method: match[1] ?? 'GET',
            url: match[2] ?? '',
            status: Number(match[3] ?? 0),
            resourceType: match[4] ?? 'other',
            responseTime: 0,
            size: 0,
          };
        }
        // Fallback: treat as URL
        return { url: line.trim(), method: 'GET', status: 0, resourceType: 'other', responseTime: 0, size: 0 };
      }).filter((r) => r.url);
    } catch { return []; }
  }

  // ─── Viewport ──

  async setViewport(width: number, height: number): Promise<void> {
    await this.callTool("browser_resize", { width, height });
  }

  async setExtraHeaders(_headers: Record<string, string>): Promise<void> {
    // Use browser_run_code_unsafe to set headers via context
    const h = JSON.stringify(_headers);
    await this.callTool("browser_run_code_unsafe", {
      code: `async (page) => {
        await page.context().setExtraHTTPHeaders(${h});
        return 'ok';
      }`,
    });
  }

  async setUserAgent(_ua: string): Promise<void> {
    // Use browser_run_code_unsafe to set user agent via context routing
    await this.callTool("browser_run_code_unsafe", {
      code: `async (page) => {
        await page.context().route('**/*', async (route) => {
          await route.continue({ headers: { ...route.request().headers(), 'User-Agent': ${JSON.stringify(_ua)} } });
        });
        return 'ok';
      }`,
    });
  }

  // ─── v0.0.80 New Capabilities ───

  async hover(selector: string): Promise<void> {
    const r = await this.callTool("browser_hover", {
      element: `Hover ${selector}`,
      target: selector,
    });
    if (r?.isError) throw new Error(`Hover failed: ${this.extractText(r).slice(0, 200)}`);
  }

  async pressKey(key: string): Promise<void> {
    const r = await this.callTool("browser_press_key", { key });
    if (r?.isError) throw new Error(`Press key failed: ${this.extractText(r).slice(0, 200)}`);
  }

  async handleDialog(accept: boolean, promptText?: string): Promise<void> {
    const args: Record<string, unknown> = { accept };
    if (promptText !== undefined) args.promptText = promptText;
    const r = await this.callTool("browser_handle_dialog", args);
    if (r?.isError) throw new Error(`Handle dialog failed: ${this.extractText(r).slice(0, 200)}`);
  }

  async uploadFile(paths: string[]): Promise<void> {
    const r = await this.callTool("browser_file_upload", { paths });
    if (r?.isError) throw new Error(`File upload failed: ${this.extractText(r).slice(0, 200)}`);
  }

  async getSnapshot(options?: { depth?: number; boxes?: boolean }): Promise<string> {
    const args: Record<string, unknown> = {};
    if (options?.depth !== undefined) args.depth = options.depth;
    if (options?.boxes !== undefined) args.boxes = options.boxes;
    const r = await this.callTool("browser_snapshot", args);
    return this.extractText(r);
  }

  async findInPage(options: { text?: string; regex?: string }): Promise<string> {
    const args: Record<string, unknown> = {};
    if (options.text) args.text = options.text;
    if (options.regex) args.regex = options.regex;
    const r = await this.callTool("browser_find", args);
    return this.extractText(r);
  }

  async manageTabs(action: "list" | "new" | "close" | "select", index?: number, url?: string): Promise<any> {
    const args: Record<string, unknown> = { action };
    if (index !== undefined) args.index = index;
    if (url !== undefined) args.url = url;
    const r = await this.callTool("browser_tabs", args);
    return this.extractText(r);
  }

  async drag(startSelector: string, endSelector: string): Promise<void> {
    const r = await this.callTool("browser_drag", {
      startElement: `Drag from ${startSelector}`,
      startTarget: startSelector,
      endElement: `Drop to ${endSelector}`,
      endTarget: endSelector,
    });
    if (r?.isError) throw new Error(`Drag failed: ${this.extractText(r).slice(0, 200)}`);
  }

  async drop(targetSelector: string, options?: { paths?: string[]; data?: Record<string, string> }): Promise<void> {
    const args: Record<string, unknown> = {
      element: `Drop on ${targetSelector}`,
      target: targetSelector,
    };
    if (options?.paths) args.paths = options.paths;
    if (options?.data) args.data = options.data;
    const r = await this.callTool("browser_drop", args);
    if (r?.isError) throw new Error(`Drop failed: ${this.extractText(r).slice(0, 200)}`);
  }

  async getCookie(name: string): Promise<any> {
    const r = await this.callTool("browser_cookie_get", { name });
    return this.extractJson(r);
  }

  async deleteCookie(name: string): Promise<void> {
    await this.callTool("browser_cookie_delete", { name });
  }

  async clearCookies(): Promise<void> {
    await this.callTool("browser_cookie_clear", {});
  }

  // ─── Generalization Layer ───

  async distillDom(): Promise<DistilledPage> {
    const result = await this.callTool("browser_evaluate", { function: DISTILL_SCRIPT });
    const text = this.extractText(result);
    try {
      return JSON.parse(text) as DistilledPage;
    } catch {
      return { url: '', title: '', elements: [], elementCount: 0, structure: { hasForms: false, formCount: 0, hasTables: false, hasIframes: false, iframeCount: 0 } };
    }
  }

  async findElement(hint: string, selector?: string): Promise<FindElementResult> {
    return await this.smartLocator.findElement(hint, selector);
  }

  getSiteCache(): CachedElement[] {
    return this.smartLocator.getCache();
  }

  setSiteCache(cache: CachedElement[]): void {
    this.smartLocator.setCache(cache);
  }

  async healthCheck(): Promise<boolean> {
    return this.isConnected && this.client !== null;
  }
}
