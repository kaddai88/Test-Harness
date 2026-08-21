/**
 * @test-harness/th-worker
 *
 * Worker process — job processors for scans and detections.
 */

export { WorkerBootstrap } from "./bootstrap.js";
export type { WorkerBootstrapOptions } from "./bootstrap.js";

export { ScanJobProcessor } from "./processors/scan.js";
export type { ScanJobProcessorOptions } from "./processors/scan.js";

export { DetectionJobProcessor } from "./processors/detection.js";
export type {
  DetectionJobData,
  DetectionJobProcessorOptions,
} from "./processors/detection.js";
