/**
 * Repository interfaces — the data access abstraction layer.
 *
 * These interfaces are provider-neutral. Implementations exist for
 * both PostgreSQL (production) and SQLite (development).
 */
import type { SessionRow, ReportRow } from "../schema.js";

// ── Session Repository ──

export interface CreateSessionInput {
  id?: string;
  targetUrl: string;
  targetConfig: Record<string, unknown>;
  scanConfig: Record<string, unknown>;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionFilter {
  status?: string;
  limit?: number;
  offset?: number;
  orderBy?: "created_at" | "status";
  orderDir?: "asc" | "desc";
}

export interface SessionRepository {
  create(input: CreateSessionInput): Promise<SessionRow>;
  findById(id: string): Promise<SessionRow | null>;
  findAll(filter?: SessionFilter): Promise<SessionRow[]>;
  updateStatus(id: string, status: string): Promise<void>;
  updateStartedAt(id: string): Promise<void>;
  updateCompletedAt(id: string): Promise<void>;
  updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;
  delete(id: string): Promise<void>;
  count(filter?: SessionFilter): Promise<number>;
}

// ── Report Repository ──

export interface CreateReportInput {
  id?: string;
  sessionId: string;
  format: string;
  content?: string;
  data?: Record<string, unknown>;
}

export interface ReportRepository {
  create(input: CreateReportInput): Promise<ReportRow>;
  findBySessionId(sessionId: string): Promise<ReportRow[]>;
  findBySessionIdAndFormat(sessionId: string, format: string): Promise<ReportRow | null>;
  delete(id: string): Promise<void>;
}
