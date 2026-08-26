/**
 * @test-harness/th-report
 *
 * Report generation — JSON, Markdown, HTML renderers + aggregation.
 */

export { ReportGenerator } from "./generator.js";
export type { ReportInput, ReportOutput } from "./generator.js";

export {
  summarize,
  groupBySeverity,
} from "./aggregator.js";
export type { ScanSummary, FindingsGroup } from "./aggregator.js";

export { renderMarkdown } from "./renderers/markdown.js";

export { renderJson } from "./renderers/json.js";
export type { JsonReportPayload } from "./renderers/json.js";

export { renderHtml } from "./renderers/html.js";
