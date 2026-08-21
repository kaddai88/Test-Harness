#!/usr/bin/env node
/**
 * @test-harness/th-server — entry point.
 *
 * Starts the Test-Harness server with environment-based configuration.
 */
import { TestHarnessServer } from "./app.js";

export { TestHarnessServer } from "./app.js";
export type { TestHarnessServerOptions } from "./app.js";

// Auto-start when run directly
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/th-server/dist/index.js") ||
    process.argv[1].endsWith("/th-server/src/index.ts"));

if (isMainModule) {
  const server = new TestHarnessServer();

  const shutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}, shutting down...`);
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  server.start().catch((err) => {
    console.error("[Server] Failed to start:", err);
    process.exit(1);
  });
}
