/**
 * Database schema — table definitions and SQL schemas.
 *
 * These tables form the persistent storage layer for session data.
 * The schema is provider-neutral — works with both PostgreSQL and SQLite.
 */

/**
 * Session record — represents a single AI-driven test session.
 *
 * Status flow: pending → planning → executing → completed | failed | cancelled
 */
export interface SessionRow {
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
 * Report — generated report for a session.
 */
export interface ReportRow {
  id: string;
  sessionId: string;
  format: string;
  content: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

// ── SQL Schema (PostgreSQL) ──

export const POSTGRES_SCHEMA = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS sessions (
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

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  format        TEXT NOT NULL,
  content       TEXT,
  data          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_session_id ON reports(session_id);
`;

// ── SQL Schema (SQLite for development) ──

export const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
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

CREATE TABLE IF NOT EXISTS reports (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  format        TEXT NOT NULL,
  content       TEXT,
  data          TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
