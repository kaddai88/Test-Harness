/**
 * Database schema — table definitions and SQL schemas.
 *
 * These tables form the persistent storage layer for scan data.
 * The schema is provider-neutral — works with both PostgreSQL and SQLite.
 */

/**
 * Scan record — represents a single website scan.
 *
 * Status flow: pending → crawling → analyzing → completed | failed | cancelled
 */
export interface ScanRow {
  id: string;
  targetUrl: string;
  targetConfig: Record<string, unknown>;
  scanConfig: Record<string, unknown>;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Detection result — one detection plugin's findings for a scan.
 */
export interface DetectionResultRow {
  id: string;
  scanId: string;
  detectionId: string;
  category: string;
  status: string;
  findings: Array<Record<string, unknown>>;
  score: number;
  startedAt: string;
  completedAt: string;
  error: string | null;
}

/**
 * Scan event — durable event for audit trail and replay.
 */
export interface ScanEventRow {
  id: string;
  scanId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  createdAt: string;
  sequence: number;
}

/**
 * Report — generated report for a scan.
 */
export interface ReportRow {
  id: string;
  scanId: string;
  format: string;
  content: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

// ── SQL Schema (PostgreSQL) ──

export const POSTGRES_SCHEMA = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS scans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_url    TEXT NOT NULL,
  target_config JSONB NOT NULL DEFAULT '{}',
  scan_config   JSONB NOT NULL DEFAULT '{}',
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_by    TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);
CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at DESC);

CREATE TABLE IF NOT EXISTS detection_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id       UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  detection_id  TEXT NOT NULL,
  category      VARCHAR(20) NOT NULL,
  status        VARCHAR(20) NOT NULL,
  findings      JSONB NOT NULL DEFAULT '[]',
  score         NUMERIC(5,2),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_detection_results_scan_id ON detection_results(scan_id);

CREATE TABLE IF NOT EXISTS scan_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id       UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  event_data    JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sequence      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scan_events_scan_id ON scan_events(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_sequence ON scan_events(scan_id, sequence);

CREATE TABLE IF NOT EXISTS reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id       UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  format        TEXT NOT NULL,
  content       TEXT,
  data          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_scan_id ON reports(scan_id);
`;

// ── SQL Schema (SQLite for development) ──

export const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS scans (
  id            TEXT PRIMARY KEY,
  target_url    TEXT NOT NULL,
  target_config TEXT NOT NULL DEFAULT '{}',
  scan_config   TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  started_at    TEXT,
  completed_at  TEXT,
  created_by    TEXT,
  metadata      TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS detection_results (
  id            TEXT PRIMARY KEY,
  scan_id       TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  detection_id  TEXT NOT NULL,
  category      TEXT NOT NULL,
  status        TEXT NOT NULL,
  findings      TEXT NOT NULL DEFAULT '[]',
  score         REAL,
  started_at    TEXT,
  completed_at  TEXT,
  error         TEXT
);

CREATE TABLE IF NOT EXISTS scan_events (
  id            TEXT PRIMARY KEY,
  scan_id       TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  event_data    TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  sequence      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id            TEXT PRIMARY KEY,
  scan_id       TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  format        TEXT NOT NULL,
  content       TEXT,
  data          TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
