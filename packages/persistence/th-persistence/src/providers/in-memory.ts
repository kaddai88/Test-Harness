/**
 * In-memory repository implementations — no native dependencies.
 *
 * Stores everything in Maps. Data is lost when the process exits.
 * Perfect for development, testing, and demo mode.
 */
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

// ── In-memory Scan Repository ──

export class InMemoryScanRepository implements ScanRepository {
  private store = new Map<string, ScanRow>();

  async create(input: CreateScanInput): Promise<ScanRow> {
    const row: ScanRow = {
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

  async findById(id: string): Promise<ScanRow | null> {
    const row = this.store.get(id);
    return row ? { ...row } : null;
  }

  async findByTarget(url: string): Promise<ScanRow[]> {
    return Array.from(this.store.values())
      .filter((r) => r.targetUrl === url)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findAll(filter?: ScanFilter): Promise<ScanRow[]> {
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

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async count(filter?: ScanFilter): Promise<number> {
    if (!filter?.status) return this.store.size;
    let count = 0;
    this.store.forEach((r) => { if (r.status === filter.status) count++; });
    return count;
  }
}

// ── In-memory Detection Result Repository ──

export class InMemoryDetectionResultRepository implements DetectionResultRepository {
  private store = new Map<string, DetectionResultRow>();

  async create(input: CreateDetectionResultInput): Promise<DetectionResultRow> {
    const row: DetectionResultRow = {
      id: input.id ?? uuid(),
      scanId: input.scanId,
      detectionId: input.detectionId,
      category: input.category,
      status: input.status,
      findings: input.findings ?? [],
      score: input.score ?? 0,
      startedAt: now(),
      completedAt: "",
      error: input.error ?? null,
    };
    this.store.set(row.id, row);
    return { ...row };
  }

  async findByScanId(scanId: string): Promise<DetectionResultRow[]> {
    return Array.from(this.store.values())
      .filter((r) => r.scanId === scanId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((r) => ({ ...r }));
  }

  async findById(id: string): Promise<DetectionResultRow | null> {
    const row = this.store.get(id);
    return row ? { ...row } : null;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const row = this.store.get(id);
    if (row) row.status = status;
  }

  async updateCompletedAt(id: string): Promise<void> {
    const row = this.store.get(id);
    if (row) row.completedAt = now();
  }
}

// ─ In-memory Scan Event Repository ──

export class InMemoryScanEventRepository implements ScanEventRepository {
  private store = new Map<string, ScanEventRow>();

  async create(input: CreateScanEventInput): Promise<ScanEventRow> {
    const row: ScanEventRow = {
      id: input.id ?? uuid(),
      scanId: input.scanId,
      eventType: input.eventType,
      eventData: input.eventData,
      createdAt: now(),
      sequence: input.sequence,
    };
    this.store.set(row.id, row);
    return { ...row };
  }

  async findByScanId(scanId: string): Promise<ScanEventRow[]> {
    return Array.from(this.store.values())
      .filter((r) => r.scanId === scanId)
      .sort((a, b) => a.sequence - b.sequence)
      .map((r) => ({ ...r }));
  }

  async getNextSequence(scanId: string): Promise<number> {
    const events = await this.findByScanId(scanId);
    return events.length > 0 ? events[events.length - 1]!.sequence + 1 : 1;
  }
}

// ── In-memory Report Repository ──

export class InMemoryReportRepository implements ReportRepository {
  private store = new Map<string, ReportRow>();

  async create(input: CreateReportInput): Promise<ReportRow> {
    const row: ReportRow = {
      id: input.id ?? uuid(),
      scanId: input.scanId,
      format: input.format,
      content: input.content ?? null,
      data: input.data ?? {},
      createdAt: now(),
    };
    this.store.set(row.id, row);
    return { ...row };
  }

  async findByScanId(scanId: string): Promise<ReportRow[]> {
    return Array.from(this.store.values())
      .filter((r) => r.scanId === scanId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ ...r }));
  }

  async findByScanIdAndFormat(scanId: string, format: string): Promise<ReportRow | null> {
    for (const row of this.store.values()) {
      if (row.scanId === scanId && row.format === format) return { ...row };
    }
    return null;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
