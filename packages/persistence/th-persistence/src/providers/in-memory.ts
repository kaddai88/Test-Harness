/**
 * In-memory repository implementations — no native dependencies.
 *
 * Stores everything in Maps. Data is lost when the process exits.
 * Perfect for development, testing, and demo mode.
 */
import type {
  SessionRepository,
  CreateSessionInput,
  SessionFilter,
  ReportRepository,
  CreateReportInput,
} from "../repositories/interfaces.js";
import type { SessionRow, ReportRow } from "../schema.js";

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

function now(): string {
  return new Date().toISOString();
}

// ── In-memory Session Repository ──

export class InMemorySessionRepository implements SessionRepository {
  private store = new Map<string, SessionRow>();

  async create(input: CreateSessionInput): Promise<SessionRow> {
    const row: SessionRow = {
      id: input.id ?? uuid(),
      targetUrl: input.targetUrl,
      targetConfig: input.targetConfig,
      scanConfig: input.scanConfig,
      status: "pending",
      createdAt: now(),
      startedAt: null,
      completedAt: null,
      createdBy: input.createdBy ?? null,
      metadata: input.metadata ?? {},
    };
    this.store.set(row.id, row);
    return { ...row };
  }

  async findById(id: string): Promise<SessionRow | null> {
    const row = this.store.get(id);
    return row ? { ...row } : null;
  }

  async findAll(filter?: SessionFilter): Promise<SessionRow[]> {
    let rows = Array.from(this.store.values());
    if (filter?.status) {
      rows = rows.filter((r) => r.status === filter.status);
    }
    const dir = filter?.orderDir === "asc" ? 1 : -1;
    const key = filter?.orderBy === "status" ? "status" : "createdAt";
    rows.sort((a, b) => dir * (a[key] as string).localeCompare(b[key] as string));
    if (filter?.offset) rows = rows.slice(filter.offset);
    if (filter?.limit) rows = rows.slice(0, filter.limit);
    return rows.map((r) => ({ ...r }));
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const row = this.store.get(id);
    if (row) row.status = status;
  }

  async updateStartedAt(id: string): Promise<void> {
    const row = this.store.get(id);
    if (row) row.startedAt = now();
  }

  async updateCompletedAt(id: string): Promise<void> {
    const row = this.store.get(id);
    if (row) row.completedAt = now();
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    const row = this.store.get(id);
    if (row) {
      row.metadata = { ...row.metadata, ...metadata };
    }
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async count(filter?: SessionFilter): Promise<number> {
    if (!filter?.status) return this.store.size;
    let count = 0;
    this.store.forEach((r) => { if (r.status === filter.status) count++; });
    return count;
  }
}

// ── In-memory Report Repository ──

export class InMemoryReportRepository implements ReportRepository {
  private store = new Map<string, ReportRow>();

  async create(input: CreateReportInput): Promise<ReportRow> {
    const row: ReportRow = {
      id: input.id ?? uuid(),
      sessionId: input.sessionId,
      format: input.format,
      content: input.content ?? null,
      data: input.data ?? {},
      createdAt: now(),
    };
    this.store.set(row.id, row);
    return { ...row };
  }

  async findBySessionId(sessionId: string): Promise<ReportRow[]> {
    return Array.from(this.store.values())
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ ...r }));
  }

  async findBySessionIdAndFormat(sessionId: string, format: string): Promise<ReportRow | null> {
    for (const row of this.store.values()) {
      if (row.sessionId === sessionId && row.format === format) return { ...row };
    }
    return null;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
