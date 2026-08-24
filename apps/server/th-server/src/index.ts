#!/usr/bin/env node
/**
 * @test-harness/th-server — entry point.
 *
 * Starts the Test-Harness server with environment-based configuration.
 */
import { TestHarnessServer } from "./app.js";

export { TestHarnessServer } from "./app.js";
export type { TestHarnessServerOptions } from "./app.js";

console.log("[Server] Starting Test-Harness...");
const server = new TestHarnessServer();

process.on("SIGINT", async () => {
  console.log("\n[Server] SIGINT received, shutting down...");
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n[Server] SIGTERM received, shutting down...");
  await server.stop();
  process.exit(0);
});

server.start({
  port: parseInt(process.env.PORT ?? "3000", 10),
  dbPath: process.env.DB_PATH,
}).catch((err) => {
  console.error("[Server] Failed to start:", err);
  process.exit(1);
});
