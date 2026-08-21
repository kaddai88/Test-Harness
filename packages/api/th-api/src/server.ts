/**
 * APIServer — HTTP + WebSocket server built on Node.js `http`.
 *
 * No external framework dependencies. Routes are dispatched manually.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { DatabaseRepositories } from "@test-harness/th-persistence";
import type { TaskQueue } from "@test-harness/th-queue";
import type { DetectionRegistry } from "@test-harness/th-detection";
import { applyCors, getPathname, sendJson } from "./http.js";
import { dispatchScanRoute } from "./routes/scans.js";
import { dispatchDetectionRoute } from "./routes/detections.js";
import { dispatchReportRoute } from "./routes/reports.js";
import { handleHealth, handleStatus } from "./routes/health.js";
import { WebSocketHandler } from "./websocket.js";

export interface APIServerOptions {
  port?: number;
  repos: DatabaseRepositories;
  queue: TaskQueue;
  detectionRegistry?: DetectionRegistry;
}

/** A minimal DetectionRegistry-like stub when none is provided. */
const emptyDetectionRegistry: DetectionRegistry = {
  getAll: () => [],
  get: () => undefined,
  getByCategory: () => [],
  listIds: () => [],
  has: () => false,
  size: 0,
  register: () => {
    throw new Error("No detection registry configured");
  },
} as unknown as DetectionRegistry;

export class APIServer {
  private server: ReturnType<typeof createServer>;
  private ws: WebSocketHandler;
  private readonly port: number;
  private readonly repos: DatabaseRepositories;
  private readonly queue: TaskQueue;
  private readonly detectionRegistry: DetectionRegistry;

  constructor(opts: APIServerOptions) {
    this.port = opts.port ?? 3000;
    this.repos = opts.repos;
    this.queue = opts.queue;
    this.detectionRegistry = opts.detectionRegistry ?? emptyDetectionRegistry;
    this.ws = new WebSocketHandler();

    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        console.error("[APIServer] Unhandled error:", err);
        if (!res.headersSent) {
          sendJson(res, 500, { error: "Internal server error" });
        }
      });
    });

    this.server.on("upgrade", (req, socket, head) => {
      this.handleUpgrade(req, socket as Duplex, head as Buffer);
    });
  }

  async start(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`[APIServer] Listening on http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.ws.closeAll();
    return new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Access the WebSocket handler for broadcasting events. */
  getWebSocketHandler(): WebSocketHandler {
    return this.ws;
  }

  /** The underlying port. */
  getPort(): number {
    return this.port;
  }

  // ── Internal ──

  private handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): void {
    this.ws.handleUpgrade(req, socket, head);
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    applyCors(res);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const pathname = getPathname(req.url);

    // Health / status
    if (pathname === "/api/v1/health" && req.method === "GET") {
      await handleHealth(req, res, {
        repos: this.repos,
        queue: this.queue,
      });
      return;
    }
    if (pathname === "/api/v1/status" && req.method === "GET") {
      await handleStatus(req, res, {
        repos: this.repos,
        queue: this.queue,
      });
      return;
    }

    // Scan routes
    const handled1 = await dispatchScanRoute(req, res, {
      repos: this.repos,
      queue: this.queue,
    }, pathname);
    if (handled1) return;

    // Detection routes
    const handled2 = await dispatchDetectionRoute(req, res, {
      registry: this.detectionRegistry,
    }, pathname);
    if (handled2) return;

    // Report routes
    const handled3 = await dispatchReportRoute(req, res, {
      repos: this.repos,
    }, pathname);
    if (handled3) return;

    // 404
    sendJson(res, 404, { error: "Not found" });
  }
}
