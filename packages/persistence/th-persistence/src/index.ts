/**
 * @test-harness/th-persistence
 *
 * Data persistence layer — repositories for scans, detection results,
 * events, and reports.
 *
 * Two storage backends:
 * - In-memory (default): pure JS, no native deps, data lost on restart
 * - SQLite: persistent file storage, requires native bindings
 */

// Schema
export { POSTGRES_SCHEMA, SQLITE_SCHEMA } from "./schema.js";
export type {
  ScanRow,
  DetectionResultRow,
  ScanEventRow,
  ReportRow,
} from "./schema.js";

// Repository interfaces
export type {
  ScanRepository,
  CreateScanInput,
  ScanFilter,
  DetectionResultRepository,
  CreateDetectionResultInput,
  ScanEventRepository,
  CreateScanEventInput,
  ReportRepository,
  CreateReportInput,
} from "./repositories/interfaces.js";

// In-memory implementations (no native deps)
export {
  InMemoryScanRepository,
  InMemoryDetectionResultRepository,
  InMemoryScanEventRepository,
  InMemoryReportRepository,
} from "./providers/in-memory.js";

// SQLite implementations (requires native better-sqlite3)
// Only available when native bindings are installed
let _SQLiteScanRepository: any;
let _SQLiteDetectionResultRepository: any;
let _SQLiteScanEventRepository: any;
let _SQLiteReportRepository: any;
let _SQLiteDatabase: any;

try {
  const sqlite = await import("./providers/sqlite.js");
  _SQLiteScanRepository = sqlite.SQLiteScanRepository;
  _SQLiteDetectionResultRepository = sqlite.SQLiteDetectionResultRepository;
  _SQLiteScanEventRepository = sqlite.SQLiteScanEventRepository;
  _SQLiteReportRepository = sqlite.SQLiteReportRepository;
  _SQLiteDatabase = sqlite.SQLiteDatabase;
} catch {
  // better-sqlite3 not available — SQLite repos will be undefined
}

// ── Database Factory ──

import {
  InMemoryScanRepository,
  InMemoryDetectionResultRepository,
  InMemoryScanEventRepository,
  InMemoryReportRepository,
} from "./providers/in-memory.js";
import type {
  ScanRepository,
  DetectionResultRepository,
  ScanEventRepository,
  ReportRepository,
} from "./repositories/interfaces.js";

/** All repositories bundled together */
export interface DatabaseRepositories {
  scans: ScanRepository;
  detectionResults: DetectionResultRepository;
  scanEvents: ScanEventRepository;
  reports: ReportRepository;
}

/**
 * Create an in-memory database (no native deps).
 * Data is lost when the process exits.
 * This is the default — works everywhere.
 */
export function createInMemoryDatabase(): DatabaseRepositories {
  return {
    scans: new InMemoryScanRepository(),
    detectionResults: new InMemoryDetectionResultRepository(),
    scanEvents: new InMemoryScanEventRepository(),
    reports: new InMemoryReportRepository(),
  };
}

/**
 * Create a file-backed SQLite database.
 * Falls back to in-memory if native bindings are unavailable.
 */
export function createDatabase(
  dbPath?: string
): DatabaseRepositories & { close?: () => void } {
  if (!dbPath || !_SQLiteDatabase) {
    if (dbPath) {
      console.warn(
        "[Persistence] SQLite unavailable (no native bindings). Using in-memory storage."
      );
    }
    return createInMemoryDatabase();
  }
  const db = new _SQLiteDatabase(dbPath);
  return {
    scans: new _SQLiteScanRepository(db.getDb()),
    detectionResults: new _SQLiteDetectionResultRepository(db.getDb()),
    scanEvents: new _SQLiteScanEventRepository(db.getDb()),
    reports: new _SQLiteReportRepository(db.getDb()),
    close: () => db.close(),
  };
}

// Backward compat
export const createSQLiteDatabase = createDatabase;
