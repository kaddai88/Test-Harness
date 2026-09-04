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

/**
 * SiteProfile — learned element selectors and metadata for a website.
 */
export interface SiteProfileRow {
  id: string;
  name: string;
  baseUrl: string;
  elementCache: string; // JSON-serialized CachedElement[]
  updatedAt: string;
}

/**
 * CognitionEpisode — a single cognitive experience/event.
 */
export interface CognitionEpisodeRow {
  id: string;
  targetUrl: string;
  type: string;
  outcome: string;
  description: string;
  data: string; // JSON-serialized episode details
  timestamp: number;
}

/**
 * CognitionKnowledge — learned semantic knowledge.
 */
export interface CognitionKnowledgeRow {
  id: string;
  targetUrl: string | null;
  type: string;
  title: string;
  content: string;
  confidence: number;
  useCount: number;
  lastUsed: string | null;
  tags: string; // JSON-serialized string[]
  createdAt: string;
}

/**
 * CognitionProcedure — learned procedural knowledge.
 */
export interface CognitionProcedureRow {
  id: string;
  targetUrl: string | null;
  name: string;
  steps: string; // JSON-serialized step array
  successRate: number;
  useCount: number;
  lastUsed: string | null;
}

/**
 * CognitionPattern — recognized pattern from learning.
 */
export interface CognitionPatternRow {
  id: string;
  targetUrl: string | null;
  type: string;
  description: string;
  frequency: number;
  confidence: number;
  tags: string; // JSON-serialized string[]
  lastSeen: string | null;
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

CREATE TABLE IF NOT EXISTS site_profiles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  base_url      TEXT NOT NULL UNIQUE,
  element_cache TEXT NOT NULL DEFAULT '[]',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cognition_episodes (
  id          TEXT PRIMARY KEY,
  target_url  TEXT NOT NULL,
  type        TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  data        TEXT NOT NULL DEFAULT '{}',
  timestamp   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cog_episodes_url ON cognition_episodes(target_url);

CREATE TABLE IF NOT EXISTS cognition_knowledge (
  id          TEXT PRIMARY KEY,
  target_url  TEXT,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  confidence  REAL NOT NULL DEFAULT 0.5,
  use_count   INTEGER NOT NULL DEFAULT 0,
  last_used   TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cog_knowledge_url ON cognition_knowledge(target_url);

CREATE TABLE IF NOT EXISTS cognition_procedures (
  id           TEXT PRIMARY KEY,
  target_url   TEXT,
  name         TEXT NOT NULL,
  steps        TEXT NOT NULL DEFAULT '[]',
  success_rate REAL NOT NULL DEFAULT 0.0,
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used    TEXT
);

CREATE TABLE IF NOT EXISTS cognition_patterns (
  id          TEXT PRIMARY KEY,
  target_url  TEXT,
  type        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  frequency   INTEGER NOT NULL DEFAULT 0,
  confidence  REAL NOT NULL DEFAULT 0.5,
  tags        TEXT NOT NULL DEFAULT '[]',
  last_seen   TEXT
);
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

CREATE TABLE IF NOT EXISTS site_profiles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  base_url      TEXT NOT NULL UNIQUE,
  element_cache TEXT NOT NULL DEFAULT '[]',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cognition_episodes (
  id          TEXT PRIMARY KEY,
  target_url  TEXT NOT NULL,
  type        TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  data        TEXT NOT NULL DEFAULT '{}',
  timestamp   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cognition_knowledge (
  id          TEXT PRIMARY KEY,
  target_url  TEXT,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  confidence  REAL NOT NULL DEFAULT 0.5,
  use_count   INTEGER NOT NULL DEFAULT 0,
  last_used   TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cognition_procedures (
  id           TEXT PRIMARY KEY,
  target_url   TEXT,
  name         TEXT NOT NULL,
  steps        TEXT NOT NULL DEFAULT '[]',
  success_rate REAL NOT NULL DEFAULT 0.0,
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used    TEXT
);

CREATE TABLE IF NOT EXISTS cognition_patterns (
  id          TEXT PRIMARY KEY,
  target_url  TEXT,
  type        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  frequency   INTEGER NOT NULL DEFAULT 0,
  confidence  REAL NOT NULL DEFAULT 0.5,
  tags        TEXT NOT NULL DEFAULT '[]',
  last_seen   TEXT
);
`;
