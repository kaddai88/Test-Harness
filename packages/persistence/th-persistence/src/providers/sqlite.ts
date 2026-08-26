/**
 * SQLite repository implementations — placeholder module.
 *
 * This module intentionally throws when instantiated to signal that
 * better-sqlite3 native bindings are not available.
 *
 * The persistence layer will automatically fall back to json-file.ts
 * when this module fails to load.
 */

export class SQLiteDatabase {
  constructor(_dbPath?: string) {
    throw new Error(
      "better-sqlite3 native bindings not available. " +
      "Using JSON file database instead. " +
      "To enable SQLite, run: pnpm rebuild better-sqlite3"
    );
  }
  getDb(): never { throw new Error("SQLite not available"); }
  close(): void {}
}

export class SQLiteSessionRepository {
  constructor() { throw new Error("SQLite not available"); }
}

export class SQLiteReportRepository {
  constructor() { throw new Error("SQLite not available"); }
}
