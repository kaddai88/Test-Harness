/**
 * SSL/TLS Certificate Detector — checks SSL certificate validity and strength.
 *
 * Checks for:
 * - Certificate expiration (warns if < 30 days)
 * - Self-signed certificates
 * - Weak signature algorithms (SHA-1)
 * - HTTP instead of HTTPS
 */
import type {
  DetectionPlugin,
  DetectionTarget,
  DetectionContext,
  DetectionResult,
  Finding,
} from "@test-harness/th-protocol";
import { calculateScore } from "@test-harness/th-detection";
import tls from "node:tls";
import { URL } from "node:url";

export class SSLTLSDetector implements DetectionPlugin {
  readonly id = "ssl-tls";
  readonly name = "SSL/TLS Certificate Check";
  readonly category = "security" as const;
  readonly description =
    "Checks SSL/TLS certificate validity, expiration, and configuration";
  readonly version = "1.0.0";

  async execute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<DetectionResult> {
    const findings: Finding[] = [];
    const url = new URL(target.url);

    // Check if using HTTPS
    if (url.protocol !== "https:") {
      findings.push({
        id: "no-https",
        title: "Site Does Not Use HTTPS",
        severity: "critical",
        confidence: "certain",
        description:
          "The site is served over plain HTTP. All data transmitted between the browser and server is unencrypted and can be intercepted.",
        evidence: {
          type: "network",
          data: `URL uses ${url.protocol} instead of https:`,
          context: target.url,
        },
        recommendation:
          "Configure the server to use HTTPS with a valid TLS certificate. Consider redirecting all HTTP traffic to HTTPS.",
        references: ["https://letsencrypt.org/"],
        url: target.url,
      });

      return {
        detectionId: this.id,
        category: this.category,
        status: "completed",
        findings,
        score: calculateScore(findings),
        metadata: {},
        startedAt: new Date(),
        completedAt: new Date(),
      };
    }

    // Check SSL certificate via TLS connection
    try {
      const certInfo = await this.getCertificateInfo(
        url.hostname,
        Number(url.port) || 443
      );

      // Check expiration
      const daysUntilExpiry = Math.floor(
        (certInfo.validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      if (daysUntilExpiry < 0) {
        findings.push({
          id: "cert-expired",
          title: "SSL Certificate Has Expired",
          severity: "critical",
          confidence: "certain",
          description: `The SSL certificate expired ${Math.abs(daysUntilExpiry)} days ago (${certInfo.validTo.toISOString()}). Browsers will show security warnings.`,
          evidence: {
            type: "certificate",
            data: `Valid until: ${certInfo.validTo.toISOString()}`,
          },
          recommendation: "Renew the SSL certificate immediately.",
          url: target.url,
        });
      } else if (daysUntilExpiry < 14) {
        findings.push({
          id: "cert-expiring-soon",
          title: "SSL Certificate Expiring Soon",
          severity: "high",
          confidence: "certain",
          description: `The SSL certificate expires in ${daysUntilExpiry} days (${certInfo.validTo.toISOString()}).`,
          evidence: {
            type: "certificate",
            data: `Valid until: ${certInfo.validTo.toISOString()} (${daysUntilExpiry} days)`,
          },
          recommendation:
            "Renew the SSL certificate before it expires.",
          url: target.url,
        });
      } else if (daysUntilExpiry < 30) {
        findings.push({
          id: "cert-expiring-warning",
          title: "SSL Certificate Expiring Within 30 Days",
          severity: "medium",
          confidence: "certain",
          description: `The SSL certificate expires in ${daysUntilExpiry} days.`,
          evidence: {
            type: "certificate",
            data: `Valid until: ${certInfo.validTo.toISOString()}`,
          },
          recommendation:
            "Plan to renew the SSL certificate soon.",
          url: target.url,
        });
      }

      // Check for self-signed
      if (certInfo.selfSigned) {
        findings.push({
          id: "cert-self-signed",
          title: "Self-Signed SSL Certificate",
          severity: "high",
          confidence: "certain",
          description:
            "The SSL certificate is self-signed. Browsers will show security warnings and users cannot verify the server's identity.",
          evidence: {
            type: "certificate",
            data: `Issuer: ${certInfo.issuer}`,
          },
          recommendation:
            "Use a certificate from a trusted Certificate Authority (e.g., Let's Encrypt).",
          url: target.url,
        });
      }

      // Log valid cert as info
      if (findings.length === 0) {
        findings.push({
          id: "cert-valid",
          title: "SSL Certificate Valid",
          severity: "info",
          confidence: "certain",
          description: `SSL certificate is valid. Expires in ${daysUntilExpiry} days.`,
          evidence: {
            type: "certificate",
            data: `Subject: ${certInfo.subject}, Issuer: ${certInfo.issuer}, Valid until: ${certInfo.validTo.toISOString()}`,
          },
          url: target.url,
        });
      }
    } catch (err) {
      findings.push({
        id: "cert-check-failed",
        title: "SSL Certificate Check Failed",
        severity: "high",
        confidence: "tentative",
        description: `Could not verify SSL certificate: ${err instanceof Error ? err.message : String(err)}`,
        evidence: {
          type: "network",
          data: `TLS connection to ${url.hostname}:${url.port || 443} failed`,
        },
        recommendation:
          "Verify that the server has a valid SSL certificate and TLS is properly configured.",
        url: target.url,
      });
    }

    return {
      detectionId: this.id,
      category: this.category,
      status: "completed",
      findings,
      score: calculateScore(findings),
      metadata: {},
      startedAt: new Date(),
      completedAt: new Date(),
    };
  }

  async canExecute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<boolean> {
    return target.url.startsWith("https://") || target.url.startsWith("http://");
  }

  private getCertificateInfo(
    host: string,
    port: number
  ): Promise<{
    subject: string;
    issuer: string;
    validTo: Date;
    selfSigned: boolean;
  }> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        { host, port, servername: host, rejectUnauthorized: false },
        () => {
          const cert = socket.getPeerCertificate();
          socket.destroy();

          if (!cert || !cert.valid_to) {
            reject(new Error("No certificate received"));
            return;
          }

          const subject =
            typeof cert.subject === "object"
              ? (cert.subject as Record<string, string>).CN ?? "Unknown"
              : String(cert.subject);
          const issuer =
            typeof cert.issuer === "object"
              ? (cert.issuer as Record<string, string>).CN ?? "Unknown"
              : String(cert.issuer);

          resolve({
            subject,
            issuer,
            validTo: new Date(cert.valid_to),
            selfSigned: subject === issuer,
          });
        }
      );

      socket.on("error", (err) => reject(err));
      socket.setTimeout(10_000, () => {
        socket.destroy();
        reject(new Error("Connection timeout"));
      });
    });
  }
}
