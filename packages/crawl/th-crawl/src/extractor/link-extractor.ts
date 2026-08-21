/**
 * Link Extractor — extracts and classifies links from DOM.
 */
import * as cheerio from "cheerio";
import type { ExtractedLink } from "@test-harness/th-protocol";

export class LinkExtractor {
  /** Extract all links from HTML, classifying internal vs external */
  extract(html: string, baseUrl: string): ExtractedLink[] {
    const $ = cheerio.load(html);
    const base: URL = new URL(baseUrl);
    const links: ExtractedLink[] = [];

    $("a[href]").each((_idx, el) => {
      const href = $(el).attr("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("javascript:"))
        return;

      const text = $(el).text().trim();
      const rel = $(el).attr("rel") ?? "";

      let resolvedUrl: URL;
      try {
        resolvedUrl = new URL(href, baseUrl);
      } catch {
        return; // Skip invalid URLs
      }

      const isExternal = resolvedUrl.hostname !== base.hostname;

      links.push({
        href: resolvedUrl.href,
        text,
        rel,
        isExternal,
      });
    });

    return links;
  }

  /** Find broken links (links returning non-2xx status) */
  filterUnique(links: ExtractedLink[]): ExtractedLink[] {
    const seen = new Set<string>();
    return links.filter((link) => {
      if (seen.has(link.href)) return false;
      seen.add(link.href);
      return true;
    });
  }
}
