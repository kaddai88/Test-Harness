/**
 * Meta Tags Detector — checks for essential SEO meta tags.
 *
 * Checks for:
 * - <title> tag (missing → high; too short/long → medium)
 * - <meta name="description"> (missing → high; too short/long → medium)
 * - <meta name="viewport"> (missing → high)
 * - <link rel="canonical"> (missing → medium)
 * - Open Graph tags: og:title, og:description, og:image (missing → low each)
 * - Twitter Card tags (missing → low)
 */
import type {
  DetectionPlugin,
  DetectionTarget,
  DetectionContext,
  DetectionResult,
  Finding,
} from "@test-harness/th-protocol";
import { calculateScore } from "@test-harness/th-detection";

const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 70;
const DESCRIPTION_MAX = 160;

export class MetaTagsDetector implements DetectionPlugin {
  readonly id = "seo-meta-tags";
  readonly name = "SEO Meta Tags Check";
  readonly category = "seo" as const;
  readonly description =
    "Checks for essential SEO meta tags (title, description, viewport, canonical, Open Graph, Twitter Card)";
  readonly version = "1.0.0";

  async execute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<DetectionResult> {
    const findings: Finding[] = [];
    const html = target.pageData?.html ?? "";

    // Title tag
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (!titleMatch) {
      findings.push({
        id: "missing-title",
        title: "Missing <title> Tag",
        severity: "high",
        confidence: "certain",
        description:
          "The page is missing a <title> tag. Page titles are critical for SEO and are displayed in browser tabs and search results.",
        evidence: {
          type: "dom_element",
          data: "No <title> element found",
          context: `URL: ${target.url}`,
        },
        recommendation:
          "Add a descriptive <title> tag between 30-60 characters summarizing the page content.",
        url: target.url,
      });
    } else {
      const title = (titleMatch[1] ?? "").trim();
      if (title.length < TITLE_MIN) {
        findings.push({
          id: "title-too-short",
          title: "Title Tag Too Short",
          severity: "medium",
          confidence: "certain",
          description: `The <title> tag is ${title.length} characters, which is below the recommended minimum of ${TITLE_MIN} characters.`,
          evidence: {
            type: "dom_element",
            data: `Title: "${title}"`,
            context: `URL: ${target.url}`,
          },
          recommendation: `Expand the title to include more descriptive keywords (aim for ${TITLE_MIN}-${TITLE_MAX} characters).`,
          url: target.url,
        });
      } else if (title.length > TITLE_MAX) {
        findings.push({
          id: "title-too-long",
          title: "Title Tag Too Long",
          severity: "medium",
          confidence: "certain",
          description: `The <title> tag is ${title.length} characters, which exceeds the recommended maximum of ${TITLE_MAX} characters.`,
          evidence: {
            type: "dom_element",
            data: `Title: "${title}"`,
            context: `URL: ${target.url}`,
          },
          recommendation: `Shorten the title to under ${TITLE_MAX} characters so it displays fully in search results.`,
          url: target.url,
        });
      }
    }

    // Meta description
    const descriptionMatch = html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i
    );
    if (!descriptionMatch) {
      findings.push({
        id: "missing-description",
        title: "Missing Meta Description",
        severity: "high",
        confidence: "certain",
        description:
          "The page is missing a <meta name=\"description\"> tag. Search engines use this to display snippets in results.",
        evidence: {
          type: "dom_element",
          data: "No meta description found",
          context: `URL: ${target.url}`,
        },
        recommendation: `Add a descriptive meta description between ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters.`,
        url: target.url,
      });
    } else {
      const description = (descriptionMatch[1] ?? "").trim();
      if (description.length < DESCRIPTION_MIN) {
        findings.push({
          id: "description-too-short",
          title: "Meta Description Too Short",
          severity: "medium",
          confidence: "certain",
          description: `The meta description is ${description.length} characters, which is below the recommended minimum of ${DESCRIPTION_MIN} characters.`,
          evidence: {
            type: "dom_element",
            data: `Description: "${description.slice(0, 100)}..."`,
            context: `URL: ${target.url}`,
          },
          recommendation: `Expand the description to between ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters.`,
          url: target.url,
        });
      } else if (description.length > DESCRIPTION_MAX) {
        findings.push({
          id: "description-too-long",
          title: "Meta Description Too Long",
          severity: "medium",
          confidence: "certain",
          description: `The meta description is ${description.length} characters, which exceeds the recommended maximum of ${DESCRIPTION_MAX} characters.`,
          evidence: {
            type: "dom_element",
            data: `Description: "${description.slice(0, 200)}..."`,
            context: `URL: ${target.url}`,
          },
          recommendation: `Shorten the description to under ${DESCRIPTION_MAX} characters so it displays fully in search results.`,
          url: target.url,
        });
      }
    }

    // Viewport meta tag
    const viewportMatch = html.match(
      /<meta[^>]+name=["']viewport["'][^>]*>/i
    );
    if (!viewportMatch) {
      findings.push({
        id: "missing-viewport",
        title: "Missing Viewport Meta Tag",
        severity: "high",
        confidence: "certain",
        description:
          'The page is missing <meta name="viewport">. Without it, mobile users see a desktop-scale page that requires zooming and horizontal scrolling.',
        evidence: {
          type: "dom_element",
          data: "No viewport meta tag found",
          context: `URL: ${target.url}`,
        },
        recommendation:
          'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
        references: [
          "https://developer.mozilla.org/en-US/docs/Web/HTML/Viewport_meta_tag",
        ],
        url: target.url,
      });
    }

    // Canonical URL
    const canonicalMatch = html.match(
      /<link[^>]+rel=["']canonical["'][^>]*>/i
    );
    if (!canonicalMatch) {
      findings.push({
        id: "missing-canonical",
        title: "Missing Canonical URL",
        severity: "medium",
        confidence: "firm",
        description:
          'No <link rel="canonical"> tag found. Without a canonical URL, search engines may index duplicate versions of this page.',
        evidence: {
          type: "dom_element",
          data: "No canonical link found",
          context: `URL: ${target.url}`,
        },
        recommendation:
          'Add <link rel="canonical" href="..."> pointing to the preferred URL for this page.',
        url: target.url,
      });
    }

    // Open Graph tags
    const ogTags = ["og:title", "og:description", "og:image"];
    for (const tag of ogTags) {
      const ogMatch = html.match(
        new RegExp(
          `<meta[^>]+property=["']${tag}["'][^>]*>`,
          "i"
        )
      );
      if (!ogMatch) {
        findings.push({
          id: `missing-og-${tag.replace(/[:/]/g, "-")}`,
          title: `Missing Open Graph Tag: ${tag}`,
          severity: "low",
          confidence: "certain",
          description: `The Open Graph tag "${tag}" is missing. Open Graph tags control how the page appears when shared on social platforms.`,
          evidence: {
            type: "dom_element",
            data: `No <meta property="${tag}"> found`,
            context: `URL: ${target.url}`,
          },
          recommendation: `Add <meta property="${tag}" content="...">.`,
          references: ["https://ogp.me/"],
          url: target.url,
        });
      }
    }

    // Twitter Card tags
    const twitterCardMatch = html.match(
      /<meta[^>]+name=["']twitter:card["'][^>]*>/i
    );
    const twitterTitleMatch = html.match(
      /<meta[^>]+name=["']twitter:title["'][^>]*>/i
    );
    const twitterDescriptionMatch = html.match(
      /<meta[^>]+name=["']twitter:description["'][^>]*>/i
    );
    const twitterImageMatch = html.match(
      /<meta[^>]+name=["']twitter:image["'][^>]*>/i
    );
    const hasTwitterCard =
      !!twitterCardMatch &&
      !!twitterTitleMatch &&
      !!twitterDescriptionMatch;
    if (!hasTwitterCard) {
      const missingTwitter = [];
      if (!twitterCardMatch) missingTwitter.push("twitter:card");
      if (!twitterTitleMatch) missingTwitter.push("twitter:title");
      if (!twitterDescriptionMatch)
        missingTwitter.push("twitter:description");
      if (!twitterImageMatch) missingTwitter.push("twitter:image");

      findings.push({
        id: "missing-twitter-card",
        title: "Missing Twitter Card Tags",
        severity: "low",
        confidence: "firm",
        description: `Missing Twitter Card meta tags: ${missingTwitter.join(", ")}. These control how the page appears when shared on Twitter/X.`,
        evidence: {
          type: "dom_element",
          data: `Missing Twitter tags: ${missingTwitter.join(", ")}`,
          context: `URL: ${target.url}`,
        },
        recommendation:
          'Add <meta name="twitter:card" content="summary_large_image"> and related Twitter meta tags.',
        url: target.url,
      });
    }

    return {
      detectionId: this.id,
      category: this.category,
      status: "completed",
      findings,
      score: calculateScore(findings),
      metadata: {
        hasTitle: !!titleMatch,
        hasDescription: !!descriptionMatch,
        hasViewport: !!viewportMatch,
        hasCanonical: !!canonicalMatch,
        hasTwitterCard,
      },
      startedAt: new Date(),
      completedAt: new Date(),
    };
  }

  async canExecute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<boolean> {
    return !!target.pageData?.html;
  }
}
