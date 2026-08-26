/**
 * @test-harness/th-api
 *
 * REST + WebSocket API server — built on Node.js `http`, no frameworks.
 */

export { APIServer } from "./server.js";
export type { APIServerOptions } from "./server.js";

export { WebSocketHandler } from "./websocket.js";

// HTTP helpers (for custom route handlers)
export {
  readJsonBody,
  sendJson,
  sendText,
  applyCors,
  getPathname,
  parseQuery,
  matchRoute,
} from "./http.js";

// Route dispatchers
export { dispatchScanRoute } from "./routes/scans.js";
export type { ScanRouteDeps } from "./routes/scans.js";

export { dispatchReportRoute } from "./routes/reports.js";
export type { ReportRouteDeps } from "./routes/reports.js";

export { handleHealth, handleStatus } from "./routes/health.js";
export type { HealthDeps } from "./routes/health.js";
