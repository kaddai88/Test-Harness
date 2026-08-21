/**
 * @test-harness/th-persistence
 *
 * Data persistence layer — repositories for scans, detection results,
 * events, and reports. Supports PostgreSQL (production) and SQLite (development).
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

// SQLite implementations
export {
  SQLiteDatabase,
  SQLiteScanRepository,
  SQLiteDetectionResultRepository,
  SQLiteScanEventRepository,
  SQLiteReportRepository,
} from "./providers/sqlite.js";

// ── Database Factory ──

import {
  SQLiteDatabase,
  SQLiteScanRepository,
  SQLiteDetectionResultRepository,
  SQLiteScanEventRepository,
  SQLiteReportRepository,
} from "./providers/sqlite.js";
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
 * Create an in-memory SQLite database with all repositories.
 * Perfect for development and testing.
 */
export function createInMemoryDatabase(): DatabaseRepositories & {
  close: () => void;
} {
  const db = new SQLiteDatabase(":memory:");
  return {
    scans: new SQLiteScanRepository(db.getDb()),
    detectionResults: new SQLiteDetectionResultRepository(db.getDb()),
    scanEvents: new SQLiteScanEventRepository(db.getDb()),
    reports: new SQLiteReportRepository(db.getDb()),
    close: () => db.close(),
  };
}

/**
 * Create a file-backed SQLite database with all repositories.
 * Good for single-node deployments.
 */
export function createSQLiteDatabase(
  dbPath: string = "./testharness.db"
): DatabaseRepositories & { close: () => void } {
  const db = new SQLiteDatabase(dbPath);
  return {
    scans: new SQLiteScanRepository(db.getDb()),
    detectionResults: new SQLiteDetectionResultRepository(db.getDb()),
    scanEvents: new SQLiteScanEventRepository(db.getDb()),
    reports: new SQLiteReportRepository(db.getDb()),
    close: () => db.close(),
  };
}
