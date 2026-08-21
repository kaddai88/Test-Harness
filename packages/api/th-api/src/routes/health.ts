/**
 * Health & status routes.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseRepositories } from "@test-harness/th-persistence";
import type { TaskQueue } from "@test-harness/th-queue";
import { sendJson } from "../http.js";

export interface HealthDeps {
  repos: DatabaseRepositories;
  queue: TaskQueue;
}

export async function handleHealth(
  _req: IncomingMessage,
  res: ServerResponse,
  _deps: HealthDeps
): Promise<void> {
  sendJson(res, 200, {
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  });
}

export async function handleStatus(
  _req: IncomingMessage,
  res: ServerResponse,
  deps: HealthDeps
): Promise<void> {
  const totalScans = await deps.repos.scans.count();
  const pendingScans = await deps.repos.scans.count({ status: "pending" });
  const activeScans = await deps.repos.scans.count({ status: "analyzing" });
  const completedScans = await deps.repos.scans.count({ status: "completed" });
  const failedScans = await deps.repos.scans.count({ status: "failed" });

  const waitingJobs = await deps.queue.getJobs(undefined, "waiting");
  const activeJobs = await deps.queue.getJobs(undefined, "active");

  sendJson(res, 200, {
    status: "ok",
    scans: {
      total: totalScans,
      pending: pendingScans,
      active: activeScans,
      completed: completedScans,
      failed: failedScans,
    },
    queue: {
      waiting: waitingJobs.length,
      active: activeJobs.length,
    },
  });
}
