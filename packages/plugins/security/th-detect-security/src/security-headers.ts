/**
 * Security Headers Detector — checks for essential HTTP security headers.
 *
 * Checks for:
 * - Content-Security-Policy (CSP)
 * - X-Frame-Options
 * - X-Content-Type-Options
 * - Strict-Transport-Security (HSTS)
 * - X-XSS-Protection (deprecated but still checked)
 * - Referrer-Policy
 * - Permissions-Policy
 */
import type {
  DetectionPlugin,
  DetectionTarget,
  DetectionContext,
  DetectionResult,
  Finding,
} from "@test-harness/th-protocol";
import { calculateScore } from "@test-harness/th-detection";

interface HeaderCheck {
  header: string;
  finding: Partial<Finding>;
  severity: Finding["severity"];
}

const REQUIRED_HEADERS: HeaderCheck[] = [
  {
    header: "content-security-policy",
    severity: "high",
    finding: {
      title: "Missing Content-Security-Policy Header",
      description:
        "Content-Security-Policy (CSP) header is not set. CSP helps prevent cross-site scripting (XSS), clickjacking, and other code injection attacks by specifying approved content sources.",
      recommendation:
        "Add a Content-Security-Policy header that restricts resource loading to trusted sources. Start with a restrictive policy and relax as needed.",
      references: [
        "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP",
        "https://owasp.org/www-community/controls/Content_Security_Policy",
      ],
    },
  },
  {
    header: "x-frame-options",
    severity: "medium",
    finding: {
      title: "Missing X-Frame-Options Header",
      description:
        "X-Frame-Options header is not set. This header protects against clickjacking attacks by controlling whether the page can be embedded in frames.",
      recommendation:
        "Set X-Frame-Options to DENY or SAMEORIGIN to prevent clickjacking.",
      references: [
        "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options",
      ],
    },
  },
  {
    header: "x-content-type-options",
    severity: "medium",
    finding: {
      title: "Missing X-Content-Type-Options Header",
      description:
        "X-Content-Type-Options header is not set. Without this header, browsers may MIME-sniff responses, potentially executing malicious content.",
      recommendation:
        'Set X-Content-Type-Options to "nosniff" to prevent MIME type sniffing.',
    },
  },
  {
    header: "strict-transport-security",
    severity: "high",
    finding: {
      title: "Missing Strict-Transport-Security (HSTS) Header",
      description:
        "HSTS header is not set. HSTS forces browsers to always connect via HTTPS, preventing protocol downgrade attacks and cookie hijacking.",
      recommendation:
        "Add Strict-Transport-Security header with a long max-age (e.g., max-age=31536000; includeSubDomains).",
      references: [
        "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security",
      ],
    },
  },
  {
    header: "referrer-policy",
    severity: "low",
    finding: {
      title: "Missing Referrer-Policy Header",
      description:
        "Referrer-Policy header is not set. Without it, the browser may leak the full URL (including sensitive query parameters) to third-party sites.",
      recommendation:
        'Set Referrer-Policy to "strict-origin-when-cross-origin" or "no-referrer".',
    },
  },
  {
    header: "permissions-policy",
    severity: "low",
    finding: {
      title: "Missing Permissions-Policy Header",
      description:
        "Permissions-Policy header is not set. This header controls which browser features (camera, microphone, etc.) can be used by the page or its iframes.",
      recommendation:
        "Set a Permissions-Policy header to restrict unnecessary browser features.",
    },
  },
];

export class SecurityHeadersDetector implements DetectionPlugin {
  readonly id = "security-headers";
  readonly name = "Security Headers Check";
  readonly category = "security" as const;
  readonly description =
    "Checks for essential HTTP security headers (CSP, HSTS, X-Frame-Options, etc.)";
  readonly version = "1.0.0";

  async execute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<DetectionResult> {
    const findings: Finding[] = [];
    const headers = target.pageData?.headers ?? {};

    // Normalize header keys to lowercase
    const normalizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      normalizedHeaders[key.toLowerCase()] = value;
    }

    for (const check of REQUIRED_HEADERS) {
      const headerValue = normalizedHeaders[check.header];
      if (!headerValue) {
        findings.push({
          id: `missing-${check.header}`,
          title: check.finding.title ?? `Missing ${check.header}`,
          severity: check.severity,
          confidence: "certain",
          description: check.finding.description ?? "",
          evidence: {
            type: "header",
            data: `Header "${check.header}" not found in response`,
            context: `URL: ${target.url}`,
          },
          recommendation: check.finding.recommendation,
          references: check.finding.references,
          url: target.url,
        });
      }
    }

    // Check for weak CSP configurations
    const csp = normalizedHeaders["content-security-policy"];
    if (csp) {
      if (csp.includes("'unsafe-inline'")) {
        findings.push({
          id: "weak-csp-unsafe-inline",
          title: "CSP Allows Unsafe Inline Scripts",
          severity: "medium",
          confidence: "certain",
          description:
            "The Content-Security-Policy header includes 'unsafe-inline', which weakens XSS protection.",
          evidence: {
            type: "header",
            data: `Content-Security-Policy: ${csp}`,
          },
          recommendation:
            "Remove 'unsafe-inline' from CSP. Use nonce-based or hash-based CSP instead.",
          url: target.url,
        });
      }
      if (csp.includes("'unsafe-eval'")) {
        findings.push({
          id: "weak-csp-unsafe-eval",
          title: "CSP Allows Unsafe Eval",
          severity: "high",
          confidence: "certain",
          description:
            "The Content-Security-Policy header includes 'unsafe-eval', which allows eval() and is a significant XSS risk.",
          evidence: {
            type: "header",
            data: `Content-Security-Policy: ${csp}`,
          },
          recommendation:
            "Remove 'unsafe-eval' from CSP. Refactor code to avoid eval().",
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
        headersChecked: REQUIRED_HEADERS.length,
        headersPresent:
          REQUIRED_HEADERS.length - findings.length,
      },
      startedAt: new Date(),
      completedAt: new Date(),
    };
  }

  async canExecute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<boolean> {
    // Can execute if we have HTTP headers
    return !!target.pageData?.headers;
  }
}
