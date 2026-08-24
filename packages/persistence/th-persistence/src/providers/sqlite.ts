/**
 * SQLite repository implementations — for local development.
 *
 * Uses better-sqlite3 for synchronous SQLite access.
 * JSON fields are stored as TEXT and parsed/stringified on read/write.
 */
import Database from "better-sqlite3";
import { SQLITE_SCHEMA } from "../schema.js";
import type {
  ScanRepository,
  CreateScanInput,
  ScanFilter,
  DetectionResultRepository,
  CreateDetectionResultInput,
  ScanEventRepository,
  CreateScanEventInput,
  ReportRepository,
  CreateReportInput,
} from "../repositories/interfaces.js";
import type {
  ScanRow,
  DetectionResultRow,
  ScanEventRow,
  ReportRow,
} from "../schema.js";

/** Generate a simple UUID v4 */
function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }
  );
}

/**
 * SQLite-backed database connection.
 * Initializes schema on construction.
 */
export class SQLiteDatabase {
  private db: Database.Database;

  constructor(dbPath: string = ":memory:") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(SQLITE_SCHEMA);
  }

  getDb(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

// ── SQLite Scan Repository ──

export class SQLiteScanRepository implements ScanRepository {
  constructor(private db: Database.Database) {}

  async create(input: CreateScanInput): Promise<ScanRow> {
    const id = input.id ?? uuid();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO scans (id, target_url, target_config, scan_config, status, created_at, created_by, metadata)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`
      )
      .run(
        id,
        input.targetUrl,
        JSON.stringify(input.targetConfig),
        JSON.stringify(input.scanConfig),
        now,
        input.createdBy ?? null,
        JSON.stringify(input.metadata ?? {})
      );
    return (await this.findById(id))!;
  }

  async findById(id: string): Promise<ScanRow | null> {
    const row = this.db
      .prepare("SELECT * FROM scans WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  async findByTarget(url: string): Promise<ScanRow[]> {
    const rows = this.db
      .prepare("SELECT * FROM scans WHERE target_url = ? ORDER BY created_at DESC")
      .all(url) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  async findAll(filter?: ScanFilter): Promise<ScanRow[]> {
    let sql = "SELECT * FROM scans";
    const params: unknown[] = [];
    if (filter?.status) {
      sql += " WHERE status = ?";
      params.push(filter.status);
    }
    const orderBy = filter?.orderBy === "status" ? "status" : "created_at";
    const orderDir = filter?.orderDir === "asc" ? "ASC" : "DESC";
    sql += ` ORDER BY ${orderBy} ${orderDir}`;
    if (filter?.limit) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }
    if (filter?.offset) {
      sql += " OFFSET ?";
      params.push(filter.offset);
    }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  async updateStatus(id: string, status: string): Promise<void> {
    this.db
      .prepare("UPDATE scans SET status = ? WHERE id = ?")
      .run(status, id);
  }

  async updateStartedAt(id: string): Promise<void> {
    this.db
      .prepare("UPDATE scans SET started_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  async updateCompletedAt(id: string): Promise<void> {
    this.db
      .prepare("UPDATE scans SET completed_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    // Get current metadata, merge with new, then update
    const current = this.db
      .prepare("SELECT metadata FROM scans WHERE id = ?")
      .get(id) as { metadata: string } | undefined;

    if (current) {
      const existing = JSON.parse(current.metadata ?? "{}");
      const merged = JSON.stringify({ ...existing, ...metadata });
      this.db
        .prepare("UPDATE scans SET metadata = ? WHERE id = ?")
        .run(merged, id);
    }
  }

  async delete(id: string): Promise<void> {
    this.db.prepare("DELETE FROM scans WHERE id = ?").run(id);
  }

  async count(filter?: ScanFilter): Promise<number> {
    let sql = "SELECT COUNT(*) as count FROM scans";
    const params: unknown[] = [];
    if (filter?.status) {
      sql += " WHERE status = ?";
      params.push(filter.status);
    }
    const row = this.db.prepare(sql).get(...params) as { count: number };
    return row.count;
  }

  private mapRow(row: Record<string, unknown>): ScanRow {
    return {
      id: row.id as string,
      targetUrl: row.target_url as string,
      targetConfig: JSON.parse((row.target_config as string) ?? "{}"),
      scanConfig: JSON.parse((row.scan_config as string) ?? "{}"),
      status: row.status as string,
      createdAt: row.created_at as string,
      startedAt: (row.started_at as string) ?? null,
      completedAt: (row.completed_at as string) ?? null,
      createdBy: (row.created_by as string) ?? null,
      metadata: JSON.parse((row.metadata as string) ?? "{}"),
    };
  }
}

// ── SQLite Detection Result Repository ──

export class SQLiteDetectionResultRepository
  implements DetectionResultRepository
{
  constructor(private db: Database.Database) {}

  async create(
    input: CreateDetectionResultInput
  ): Promise<DetectionResultRow> {
    const id = input.id ?? uuid();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO detection_results (id, scan_id, detection_id, category, status, findings, score, started_at, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.scanId,
        input.detectionId,
        input.category,
        input.status,
        JSON.stringify(input.findings ?? []),
        input.score ?? null,
        now,
        input.error ?? null
      );
    return (await this.findById(id))!;
  }

  async findByScanId(scanId: string): Promise<DetectionResultRow[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM detection_results WHERE scan_id = ? ORDER BY started_at"
      )
      .all(scanId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  async findById(id: string): Promise<DetectionResultRow | null> {
    const row = this.db
      .prepare("SELECT * FROM detection_results WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    this.db
      .prepare("UPDATE detection_results SET status = ? WHERE id = ?")
      .run(status, id);
  }

  async updateCompletedAt(id: string): Promise<void> {
    this.db
      .prepare(
        "UPDATE detection_results SET completed_at = ? WHERE id = ?"
      )
      .run(new Date().toISOString(), id);
  }

  private mapRow(row: Record<string, unknown>): DetectionResultRow {
    return {
      id: row.id as string,
      scanId: row.scan_id as string,
      detectionId: row.detection_id as string,
      category: row.category as string,
      status: row.status as string,
      findings: JSON.parse((row.findings as string) ?? "[]"),
      score: (row.score as number) ?? 0,
      startedAt: (row.started_at as string) ?? "",
      completedAt: (row.completed_at as string) ?? "",
      error: (row.error as string) ?? null,
    };
  }
}

// ── SQLite Scan Event Repository ──

export class SQLiteScanEventRepository implements ScanEventRepository {
  constructor(private db: Database.Database) {}

  async create(input: CreateScanEventInput): Promise<ScanEventRow> {
    const id = input.id ?? uuid();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO scan_events (id, scan_id, event_type, event_data, created_at, sequence)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.scanId,
        input.eventType,
        JSON.stringify(input.eventData),
        now,
        input.sequence
      );
    return {
      id,
      scanId: input.scanId,
      eventType: input.eventType,
      eventData: input.eventData,
      createdAt: now,
      sequence: input.sequence,
    };
  }

  async findByScanId(scanId: string): Promise<ScanEventRow[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM scan_events WHERE scan_id = ? ORDER BY sequence"
      )
      .all(scanId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      scanId: row.scan_id as string,
      eventType: row.event_type as string,
      eventData: JSON.parse((row.event_data as string) ?? "{}"),
      createdAt: row.created_at as string,
      sequence: row.sequence as number,
    }));
  }

  async getNextSequence(scanId: string): Promise<number> {
    const row = this.db
      .prepare(
        "SELECT MAX(sequence) as maxSeq FROM scan_events WHERE scan_id = ?"
      )
      .get(scanId) as { maxSeq: number | null };
    return (row.maxSeq ?? 0) + 1;
  }
}

// ── SQLite Report Repository ──

export class SQLiteReportRepository implements ReportRepository {
  constructor(private db: Database.Database) {}

  async create(input: CreateReportInput): Promise<ReportRow> {
    const id = input.id ?? uuid();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO reports (id, scan_id, format, content, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.scanId,
        input.format,
        input.content ?? null,
        JSON.stringify(input.data ?? {}),
        now
      );
    return {
      id,
      scanId: input.scanId,
      format: input.format,
      content: input.content ?? null,
      data: input.data ?? {},
      createdAt: now,
    };
  }

  async findByScanId(scanId: string): Promise<ReportRow[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM reports WHERE scan_id = ? ORDER BY created_at DESC"
      )
      .all(scanId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      scanId: row.scan_id as string,
      format: row.format as string,
      content: (row.content as string) ?? null,
      data: JSON.parse((row.data as string) ?? "{}"),
      createdAt: row.created_at as string,
    }));
  }

  async findByScanIdAndFormat(
    scanId: string,
    format: string
  ): Promise<ReportRow | null> {
    const row = this.db
      .prepare(
        "SELECT * FROM reports WHERE scan_id = ? AND format = ? ORDER BY created_at DESC LIMIT 1"
      )
      .get(scanId, format) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      scanId: row.scan_id as string,
      format: row.format as string,
      content: (row.content as string) ?? null,
      data: JSON.parse((row.data as string) ?? "{}"),
      createdAt: row.created_at as string,
    };
  }

  async delete(id: string): Promise<void> {
    this.db.prepare("DELETE FROM reports WHERE id = ?").run(id);
  }
}
