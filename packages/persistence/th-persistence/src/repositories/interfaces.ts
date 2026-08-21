/**
 * Repository interfaces — the data access abstraction layer.
 *
 * These interfaces are provider-neutral. Implementations exist for
 * both PostgreSQL (production) and SQLite (development).
 */
import type {
  ScanRow,
  DetectionResultRow,
  ScanEventRow,
  ReportRow,
} from "../schema.js";

// ── Scan Repository ──

export interface CreateScanInput {
  id?: string;
  targetUrl: string;
  targetConfig: Record<string, unknown>;
  scanConfig: Record<string, unknown>;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

export interface ScanFilter {
  status?: string;
  limit?: number;
  offset?: number;
  orderBy?: "created_at" | "status";
  orderDir?: "asc" | "desc";
}

export interface ScanRepository {
  create(input: CreateScanInput): Promise<ScanRow>;
  findById(id: string): Promise<ScanRow | null>;
  findByTarget(url: string): Promise<ScanRow[]>;
  findAll(filter?: ScanFilter): Promise<ScanRow[]>;
  updateStatus(id: string, status: string): Promise<void>;
  updateStartedAt(id: string): Promise<void>;
  updateCompletedAt(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  count(filter?: ScanFilter): Promise<number>;
}

// ── Detection Result Repository ──

export interface CreateDetectionResultInput {
  id?: string;
  scanId: string;
  detectionId: string;
  category: string;
  status: string;
  findings?: Array<Record<string, unknown>>;
  score?: number;
  error?: string;
}

export interface DetectionResultRepository {
  create(input: CreateDetectionResultInput): Promise<DetectionResultRow>;
  findByScanId(scanId: string): Promise<DetectionResultRow[]>;
  findById(id: string): Promise<DetectionResultRow | null>;
  updateStatus(id: string, status: string): Promise<void>;
  updateCompletedAt(id: string): Promise<void>;
}

// ── Scan Event Repository ──

export interface CreateScanEventInput {
  id?: string;
  scanId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  sequence: number;
}

export interface ScanEventRepository {
  create(input: CreateScanEventInput): Promise<ScanEventRow>;
  findByScanId(scanId: string): Promise<ScanEventRow[]>;
  getNextSequence(scanId: string): Promise<number>;
}

// ── Report Repository ──

export interface CreateReportInput {
  id?: string;
  scanId: string;
  format: string;
  content?: string;
  data?: Record<string, unknown>;
}

export interface ReportRepository {
  create(input: CreateReportInput): Promise<ReportRow>;
  findByScanId(scanId: string): Promise<ReportRow[]>;
  findByScanIdAndFormat(scanId: string, format: string): Promise<ReportRow | null>;
  delete(id: string): Promise<void>;
}
