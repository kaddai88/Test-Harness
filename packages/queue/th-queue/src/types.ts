/**
 * @test-harness/th-queue — type definitions.
 *
 * Defines jobs, processors, and the TaskQueue interface.
 */

export type JobType =
  | "scan:execute"
  | "scan:crawl"
  | "scan:detect"
  | "scan:report"
  | "scan:llm-analyze";

export type JobStatus = "waiting" | "active" | "completed" | "failed" | "delayed";

export interface JobData {
  scanId: string;
  targetUrl?: string;
  detectionIds?: string[];
  config?: Record<string, unknown>;
}

export interface Job<T = JobData> {
  id: string;
  type: JobType;
  data: T;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  failedReason?: string;
  result?: unknown;
}

export interface QueueOptions {
  concurrency?: number;
  maxAttempts?: number;
  retryDelay?: number;
}

export interface JobProcessor<T = JobData> {
  process(job: Job<T>): Promise<unknown>;
}

export interface TaskQueue {
  add(type: JobType, data: JobData, opts?: { priority?: number }): Promise<string>;
  process(type: JobType, processor: JobProcessor): void;
  getJob(id: string): Promise<Job | null>;
  getJobs(type?: JobType, status?: JobStatus): Promise<Job[]>;
  remove(id: string): Promise<void>;
  close(): Promise<void>;
}
