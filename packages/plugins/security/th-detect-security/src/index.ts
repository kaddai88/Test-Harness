/**
 * @test-harness/th-detect-security
 *
 * Security detection plugin — security headers + SSL/TLS checks.
 */
import { THPlugin, type THContainer } from "@test-harness/th-core";
import { DetectionServiceDefinition } from "@test-harness/th-detection";
import { valueProvider } from "@test-harness/th-core";
import { SecurityHeadersDetector } from "./security-headers.js";
import { SSLTLSDetector } from "./ssl-tls.js";

export { SecurityHeadersDetector } from "./security-headers.js";
export { SSLTLSDetector } from "./ssl-tls.js";

/** Plugin that registers security detection modules */
export class SecurityDetectionPlugin extends THPlugin {
  static manifest = {
    name: "@test-harness/th-detect-security",
    version: "0.1.0",
    description: "Security detection plugins (headers, SSL/TLS)",
  };

  override activate(container: THContainer): void {
    // Register individual detectors as multi-provider services
    container.register(
      DetectionServiceDefinition,
      valueProvider(new SecurityHeadersDetector()),
      { id: "security-headers" }
    );
    container.register(
      DetectionServiceDefinition,
      valueProvider(new SSLTLSDetector()),
      { id: "ssl-tls" }
    );
  }

  override deactivate(): void {
    // Nothing to clean up
  }
}
