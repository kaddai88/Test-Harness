/**
 * Report routes — generate and retrieve scan reports.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseRepositories } from "@test-harness/th-persistence";
import { ReportGenerator } from "@test-harness/th-report";
import type { DetectionResult, Finding } from "@test-harness/th-protocol";
import { sendJson, sendText, parseQuery, matchRoute } from "../http.js";

export interface ReportRouteDeps {
  repos: DatabaseRepositories;
}

/** GET /api/v1/scans/:id/report — get or generate a report. */
export async function handleGetReport(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ReportRouteDeps,
  params: Record<string, string>
): Promise<void> {
  const query = parseQuery(req.url);
  const rawFormat = query.format ?? "json";
  if (rawFormat !== "json" && rawFormat !== "markdown" && rawFormat !== "html") {
    sendJson(res, 400, {
      error: `Unsupported format "${rawFormat}". Use json, markdown, or html.`,
    });
    return;
  }
  const format: "json" | "markdown" | "html" = rawFormat;

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

  // Check if a cached report exists
  const cached = await deps.repos.reports.findByScanIdAndFormat(
    id,
    format
  );
  if (cached?.content) {
    if (format === "json") {
      sendJson(res, 200, {
        scanId: scan.id,
        format,
        content: cached.content,
        data: cached.data,
      });
    } else {
      const ct = format === "html" ? "text/html" : "text/markdown";
      sendText(res, 200, cached.content, ct);
    }
    return;
  }

  // Generate on-the-fly
  const detectionResults = await deps.repos.detectionResults.findByScanId(id);

  const generator = new ReportGenerator();
  const output = await generator.generate(
    {
      scanId: scan.id,
      targetUrl: scan.targetUrl,
      results: detectionResults.map(
        (dr): DetectionResult => ({
          detectionId: dr.detectionId,
          category: dr.category as
            | "security"
            | "performance"
            | "functionality"
            | "seo"
            | "accessibility",
          status: dr.status as "completed" | "failed" | "skipped",
          findings: dr.findings as unknown as Finding[],
          score: dr.score,
          metadata: {},
          startedAt: new Date(dr.startedAt ?? Date.now()),
          completedAt: new Date(dr.completedAt ?? Date.now()),
        })
      ),
      startedAt: new Date(scan.startedAt ?? scan.createdAt),
      completedAt: new Date(scan.completedAt ?? Date.now()),
    },
    format
  );

  // Persist for future requests
  await deps.repos.reports.create({
    scanId: scan.id,
    format: output.format,
    content: output.content,
    data: output.data,
  });

  if (format === "json") {
    sendJson(res, 200, {
      scanId: scan.id,
      format: output.format,
      content: output.content,
      data: output.data,
    });
  } else {
    const ct = format === "html" ? "text/html" : "text/markdown";
    sendText(res, 200, output.content, ct);
  }
}

/** Route dispatcher for report endpoints. */
export async function dispatchReportRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ReportRouteDeps,
  pathname: string
): Promise<boolean> {
  const method = req.method ?? "GET";

  const reportMatch = matchRoute(
    "/api/v1/scans/:id/report",
    pathname
  );
  if (method === "GET" && reportMatch) {
    await handleGetReport(req, res, deps, reportMatch);
    return true;
  }

  return false;
}
