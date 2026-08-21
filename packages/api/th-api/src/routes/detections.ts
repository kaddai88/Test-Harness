/**
 * Detection routes — list available detection plugins.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DetectionRegistry } from "@test-harness/th-detection";
import { sendJson } from "../http.js";

export interface DetectionRouteDeps {
  registry: DetectionRegistry;
}

/** GET /api/v1/detections — list available detection plugins. */
export async function handleListDetections(
  _req: IncomingMessage,
  res: ServerResponse,
  deps: DetectionRouteDeps
): Promise<void> {
  const plugins = deps.registry.getAll().map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    description: p.description,
    version: p.version,
  }));

  sendJson(res, 200, { detections: plugins, total: plugins.length });
}

/** Route dispatcher for detection endpoints. */
export async function dispatchDetectionRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: DetectionRouteDeps,
  pathname: string
): Promise<boolean> {
  const method = req.method ?? "GET";

  if (method === "GET" && pathname === "/api/v1/detections") {
    await handleListDetections(req, res, deps);
    return true;
  }

  return false;
}
