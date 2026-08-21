/**
 * DOM Extractor — parses HTML using cheerio and extracts structured data.
 */
import * as cheerio from "cheerio";
import type { DOMExtract, FormField } from "@test-harness/th-protocol";

export class DOMExtractor {
  extract(html: string, url: string): DOMExtract {
    const $ = cheerio.load(html);

    const title = $("title").first().text().trim();

    const headings: Array<{ level: number; text: string }> = [];
    for (let i = 1; i <= 6; i++) {
      $(`h${i}`).each((_idx, el) => {
        const text = $(el).text().trim();
        if (text) headings.push({ level: i, text });
      });
    }

    const links: Array<{ href: string; text: string; rel: string }> =
      [];
    $("a[href]").each((_idx, el) => {
      const href = $(el).attr("href") ?? "";
      const text = $(el).text().trim();
      const rel = $(el).attr("rel") ?? "";
      if (href) links.push({ href, text, rel });
    });

    const forms: Array<{
      action: string;
      method: string;
      fields: FormField[];
    }> = [];
    $("form").each((_idx, formEl) => {
      const action = $(formEl).attr("action") ?? "";
      const method = ($(formEl).attr("method") ?? "GET").toUpperCase();
      const fields: FormField[] = [];

      $(formEl)
        .find("input, select, textarea")
        .each((_fidx, fieldEl) => {
          const name =
            $(fieldEl).attr("name") ??
            $(fieldEl).attr("id") ??
            "";
          const type =
            $(fieldEl).attr("type") ??
            fieldEl.tagName.toLowerCase();
          const id = $(fieldEl).attr("id");
          const required =
            $(fieldEl).attr("required") !== undefined;
          if (name) fields.push({ name, type, id, required });
        });

      forms.push({ action, method, fields });
    });

    const images: Array<{ src: string; alt: string }> = [];
    $("img[src]").each((_idx, el) => {
      images.push({
        src: $(el).attr("src") ?? "",
        alt: $(el).attr("alt") ?? "",
      });
    });

    const scripts: Array<{ src?: string; inline: boolean }> = [];
    $("script").each((_idx, el) => {
      const src = $(el).attr("src");
      scripts.push({ src, inline: !src });
    });

    const meta: Record<string, string> = {};
    $('meta[name], meta[property]').each((_idx, el) => {
      const name =
        $(el).attr("name") ?? $(el).attr("property") ?? "";
      const content = $(el).attr("content") ?? "";
      if (name && content) meta[name] = content;
    });

    return {
      url,
      title,
      headings,
      links,
      forms,
      images,
      scripts,
      meta,
    };
  }
}
