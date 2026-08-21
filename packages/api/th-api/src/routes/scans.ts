/**
 * Scan routes — CRUD + enqueue.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseRepositories } from "@test-harness/th-persistence";
import type { TaskQueue } from "@test-harness/th-queue";
import {
  sendJson,
  readJsonBody,
  parseQuery,
  matchRoute,
} from "../http.js";

export interface ScanRouteDeps {
  repos: DatabaseRepositories;
  queue: TaskQueue;
}

interface CreateScanRequest {
  targetUrl: string;
  targetConfig?: Record<string, unknown>;
  scanConfig?: Record<string, unknown>;
  detectionIds?: string[];
}

/** POST /api/v1/scans — create a new scan and enqueue it. */
export async function handleCreateScan(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ScanRouteDeps
): Promise<void> {
  let body: CreateScanRequest;
  try {
    body = await readJsonBody<CreateScanRequest>(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!body.targetUrl) {
    sendJson(res, 400, { error: "targetUrl is required" });
    return;
  }

  const scan = await deps.repos.scans.create({
    targetUrl: body.targetUrl,
    targetConfig: body.targetConfig ?? {},
    scanConfig: body.scanConfig ?? {},
  });

  // Enqueue a scan:execute job
  await deps.queue.add(
    "scan:execute",
    {
      scanId: scan.id,
      targetUrl: body.targetUrl,
      detectionIds: body.detectionIds,
      config: body.scanConfig,
    },
    { priority: 0 }
  );

  await deps.repos.scans.updateStatus(scan.id, "pending");

  sendJson(res, 201, scan);
}

/** GET /api/v1/scans — list scans (paginated). */
export async function handleListScans(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ScanRouteDeps
): Promise<void> {
  const query = parseQuery(req.url);
  const limit = Math.min(parseInt(query.limit ?? "50", 10), 200);
  const offset = parseInt(query.offset ?? "0", 10);
  const status = query.status;

  const filter = {
    limit,
    offset,
    status,
    orderBy: "created_at" as const,
    orderDir: "desc" as const,
  };

  const [scans, total] = await Promise.all([
    deps.repos.scans.findAll(filter),
    deps.repos.scans.count(status ? { status } : undefined),
  ]);

  sendJson(res, 200, { scans, total, limit, offset });
}

/** GET /api/v1/scans/:id — get scan detail with results. */
export async function handleGetScan(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ScanRouteDeps,
  params: Record<string, string>
): Promise<void> {
  const id = params.id;
  if (!id) {
    sendJson(res, 400, { error: "Missing scan id" });
    return;
  }
  const scan = await deps.repos.scans.findById(id);
  if (!scan) {
    sendJson(res, 404, { error: "Scan not found" });
    return;
  }

  const [detectionResults, events] = await Promise.all([
    deps.repos.detectionResults.findByScanId(scan.id),
    deps.repos.scanEvents.findByScanId(scan.id),
  ]);

  sendJson(res, 200, { scan, detectionResults, events });
}

/** DELETE /api/v1/scans/:id — delete a scan. */
export async function handleDeleteScan(
  _req: IncomingMessage,
  res: ServerResponse,
  deps: ScanRouteDeps,
  params: Record<string, string>
): Promise<void> {
  const id = params.id;
  if (!id) {
    sendJson(res, 400, { error: "Missing scan id" });
    return;
  }
  const scan = await deps.repos.scans.findById(id);
  if (!scan) {
    sendJson(res, 404, { error: "Scan not found" });
    return;
  }

  await deps.repos.scans.delete(id);
  sendJson(res, 200, { deleted: true });
}

/** POST /api/v1/scans/:id/cancel — cancel a running scan. */
export async function handleCancelScan(
  _req: IncomingMessage,
  res: ServerResponse,
  deps: ScanRouteDeps,
  params: Record<string, string>
): Promise<void> {
  const id = params.id;
  if (!id) {
    sendJson(res, 400, { error: "Missing scan id" });
    return;
  }
  const scan = await deps.repos.scans.findById(id);
  if (!scan) {
    sendJson(res, 404, { error: "Scan not found" });
    return;
  }

  if (scan.status === "completed" || scan.status === "failed") {
    sendJson(res, 409, {
      error: `Cannot cancel scan in "${scan.status}" status`,
    });
    return;
  }

  await deps.repos.scans.updateStatus(id, "cancelled");
  await deps.repos.scans.updateCompletedAt(id);
  sendJson(res, 200, { cancelled: true });
}

/** Route dispatcher for scan endpoints. */
export async function dispatchScanRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ScanRouteDeps,
  pathname: string
): Promise<boolean> {
  const method = req.method ?? "GET";

  if (method === "POST" && pathname === "/api/v1/scans") {
    await handleCreateScan(req, res, deps);
    return true;
  }

  if (method === "GET" && pathname === "/api/v1/scans") {
    await handleListScans(req, res, deps);
    return true;
  }

  const cancelMatch = matchRoute(
    "/api/v1/scans/:id/cancel",
    pathname
  );
  if (method === "POST" && cancelMatch) {
    await handleCancelScan(req, res, deps, cancelMatch);
    return true;
  }

  const scanMatch = matchRoute("/api/v1/scans/:id", pathname);
  if (scanMatch) {
    if (method === "GET") {
      await handleGetScan(req, res, deps, scanMatch);
      return true;
    }
    if (method === "DELETE") {
      await handleDeleteScan(req, res, deps, scanMatch);
      return true;
    }
  }

  return false;
}
