/**
 * @test-harness/th-persistence
 *
 * Data persistence layer — repositories for sessions and reports.
 *
 * Two storage backends:
 * - In-memory (default): pure JS, no native deps, data lost on restart
 * - JSON File: persistent file storage, pure JS
 */

// Schema
export { POSTGRES_SCHEMA, SQLITE_SCHEMA } from "./schema.js";
export type { SessionRow, ReportRow } from "./schema.js";

// Repository interfaces
export type {
  SessionRepository,
  CreateSessionInput,
  SessionFilter,
  ReportRepository,
  CreateReportInput,
} from "./repositories/interfaces.js";

// In-memory implementations (no native deps)
export {
  InMemorySessionRepository,
  InMemoryReportRepository,
} from "./providers/in-memory.js";

// JSON File implementations (pure JS, persistent)
let _JsonFileSessionRepository: any;
let _JsonFileReportRepository: any;
let _JsonFileDatabase: any;

try {
  const jsonFile = await import("./providers/json-file.js");
  _JsonFileSessionRepository = jsonFile.JsonFileSessionRepository;
  _JsonFileReportRepository = jsonFile.JsonFileReportRepository;
  _JsonFileDatabase = jsonFile.JsonFileDatabase;
  console.log("[Persistence] JSON file database loaded successfully");
} catch (e) {
  console.error("[Persistence] JSON file database failed to load:", e);
}

// ── Database Factory ──

import {
  InMemorySessionRepository,
  InMemoryReportRepository,
} from "./providers/in-memory.js";
import type {
  SessionRepository,
  ReportRepository,
} from "./repositories/interfaces.js";

/** All repositories bundled together */
export interface DatabaseRepositories {
  sessions: SessionRepository;
  reports: ReportRepository;
}

/**
 * Create an in-memory database (no native deps).
 * Data is lost when the process exits.
 * This is the default — works everywhere.
 */
export function createInMemoryDatabase(): DatabaseRepositories {
  return {
    sessions: new InMemorySessionRepository(),
    reports: new InMemoryReportRepository(),
  };
}

/**
 * Create a persistent database.
 * Priority: JSON File > In-Memory
 */
export function createDatabase(
  dbPath?: string
): DatabaseRepositories & { close?: () => void } {
  if (!dbPath) {
    return createInMemoryDatabase();
  }

  // Fallback to JSON file database
  if (_JsonFileDatabase) {
    const db = new _JsonFileDatabase(dbPath);
    return {
      sessions: new _JsonFileSessionRepository(db),
      reports: new _JsonFileReportRepository(db),
      close: () => db.close(),
    };
  }

  // Last resort: in-memory
  console.warn("[Persistence] No persistent storage available. Using in-memory.");
  return createInMemoryDatabase();
}
