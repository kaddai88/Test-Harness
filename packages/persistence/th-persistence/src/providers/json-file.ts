/**
 * JSON file-based database — simple persistent storage without native dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SessionRow, ReportRow } from '../schema.js';
import type {
  SessionRepository,
  CreateSessionInput,
  SessionFilter,
  ReportRepository,
  CreateReportInput,
} from '../repositories/interfaces.js';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
    /[xy]/g,
    (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }
  );
}

function now(): string {
  return new Date().toISOString();
}

/** Ensure parent directory exists */
function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** JSON file database */
export class JsonFileDatabase {
  private filePath: string;
  private data: {
    sessions: Record<string, SessionRow>;
    reports: Record<string, ReportRow>;
  };

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = { sessions: {}, reports: {} };

    // Ensure parent directory exists
    ensureDir(filePath);

    // Load existing data
    if (fs.existsSync(filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        // Backward compat: rename old `scans` key → `sessions`
        if (raw.scans && !raw.sessions) {
          raw.sessions = raw.scans;
          delete raw.scans;
        }
        // Drop legacy keys
        delete raw.detectionResults;
        delete raw.scanEvents;
        this.data = {
          sessions: raw.sessions ?? {},
          reports: raw.reports ?? {},
        };
      } catch (err) {
        console.warn('[JsonDB] Failed to load existing data, starting fresh:', err);
      }
    }

    // Save periodically
    setInterval(() => this.save(), 5000);
  }

  save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('[JsonDB] Failed to save:', err);
    }
  }

  close(): void {
    this.save();
  }

  getData() {
    return this.data;
  }
}

// ── JSON File Session Repository ──

export class JsonFileSessionRepository implements SessionRepository {
  constructor(private db: JsonFileDatabase) {}

  async create(input: CreateSessionInput): Promise<SessionRow> {
    const id = input.id ?? uuid();
    const row: SessionRow = {
      id,
      targetUrl: input.targetUrl,
      targetConfig: input.targetConfig ?? {},
      scanConfig: input.scanConfig ?? {},
      status: 'pending',
      createdAt: now(),
      startedAt: null,
      completedAt: null,
      createdBy: input.createdBy ?? null,
      metadata: input.metadata ?? {},
    };
    this.db.getData().sessions[id] = row;
    this.db.save();
    return { ...row };
  }

  async findById(id: string): Promise<SessionRow | null> {
    const row = this.db.getData().sessions[id];
    return row ? { ...row } : null;
  }

  async findAll(filter?: SessionFilter): Promise<SessionRow[]> {
    let rows = Object.values(this.db.getData().sessions);
    if (filter?.status) {
      rows = rows.filter((r) => r.status === filter.status);
    }
    const dir = filter?.orderDir === 'asc' ? 1 : -1;
    const key = filter?.orderBy === 'status' ? 'status' : 'createdAt';
    rows.sort((a, b) => dir * (a[key] as string).localeCompare(b[key] as string));
    if (filter?.offset) rows = rows.slice(filter.offset);
    if (filter?.limit) rows = rows.slice(0, filter.limit);
    return rows.map((r) => ({ ...r }));
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const row = this.db.getData().sessions[id];
    if (row) {
      row.status = status;
      this.db.save();
    }
  }

  async updateStartedAt(id: string): Promise<void> {
    const row = this.db.getData().sessions[id];
    if (row) {
      row.startedAt = now();
      this.db.save();
    }
  }

  async updateCompletedAt(id: string): Promise<void> {
    const row = this.db.getData().sessions[id];
    if (row) {
      row.completedAt = now();
      this.db.save();
    }
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    const row = this.db.getData().sessions[id];
    if (row) {
      row.metadata = { ...row.metadata, ...metadata };
      this.db.save();
    }
  }

  async delete(id: string): Promise<void> {
    delete this.db.getData().sessions[id];
    this.db.save();
  }

  async count(filter?: SessionFilter): Promise<number> {
    const rows = Object.values(this.db.getData().sessions);
    if (filter?.status) {
      return rows.filter((r) => r.status === filter.status).length;
    }
    return rows.length;
  }
}

// ── JSON File Report Repository ──

export class JsonFileReportRepository implements ReportRepository {
  constructor(private db: JsonFileDatabase) {}

  async create(input: CreateReportInput): Promise<ReportRow> {
    const id = input.id ?? uuid();
    const row: ReportRow = {
      id,
      sessionId: input.sessionId,
      format: input.format,
      content: input.content ?? null,
      data: input.data ?? {},
      createdAt: now(),
    };
    this.db.getData().reports[id] = row;
    this.db.save();
    return { ...row };
  }

  async findBySessionId(sessionId: string): Promise<ReportRow[]> {
    return Object.values(this.db.getData().reports)
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findBySessionIdAndFormat(sessionId: string, format: string): Promise<ReportRow | null> {
    const row = Object.values(this.db.getData().reports).find(
      (r) => r.sessionId === sessionId && r.format === format
    );
    return row ? { ...row } : null;
  }

  async delete(id: string): Promise<void> {
    delete this.db.getData().reports[id];
    this.db.save();
  }
}
