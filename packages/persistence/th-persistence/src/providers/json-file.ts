/**
 * JSON file-based database — simple persistent storage without native dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  ScanRow,
  DetectionResultRow,
  ScanEventRow,
  ReportRow,
} from '../schema.js';
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
    scans: Record<string, ScanRow>;
    detectionResults: Record<string, DetectionResultRow>;
    scanEvents: Record<string, ScanEventRow>;
    reports: Record<string, ReportRow>;
  };

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = { scans: {}, detectionResults: {}, scanEvents: {}, reports: {} };

    // Ensure parent directory exists
    ensureDir(filePath);

    // Load existing data
    if (fs.existsSync(filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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

// ── JSON File Scan Repository ──

export class JsonFileScanRepository implements ScanRepository {
  constructor(private db: JsonFileDatabase) {}

  async create(input: CreateScanInput): Promise<ScanRow> {
    const id = input.id ?? uuid();
    const row: ScanRow = {
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
    this.db.getData().scans[id] = row;
    this.db.save();
    return { ...row };
  }

  async findById(id: string): Promise<ScanRow | null> {
    const row = this.db.getData().scans[id];
    return row ? { ...row } : null;
  }

  async findByTarget(url: string): Promise<ScanRow[]> {
    return Object.values(this.db.getData().scans)
      .filter((r) => r.targetUrl === url)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findAll(filter?: ScanFilter): Promise<ScanRow[]> {
    let rows = Object.values(this.db.getData().scans);
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
    const row = this.db.getData().scans[id];
    if (row) {
      row.status = status;
      this.db.save();
    }
  }

  async updateStartedAt(id: string): Promise<void> {
    const row = this.db.getData().scans[id];
    if (row) {
      row.startedAt = now();
      this.db.save();
    }
  }

  async updateCompletedAt(id: string): Promise<void> {
    const row = this.db.getData().scans[id];
    if (row) {
      row.completedAt = now();
      this.db.save();
    }
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    const row = this.db.getData().scans[id];
    if (row) {
      row.metadata = { ...row.metadata, ...metadata };
      this.db.save();
    }
  }

  async delete(id: string): Promise<void> {
    delete this.db.getData().scans[id];
    this.db.save();
  }

  async count(filter?: ScanFilter): Promise<number> {
    const rows = Object.values(this.db.getData().scans);
    if (filter?.status) {
      return rows.filter((r) => r.status === filter.status).length;
    }
    return rows.length;
  }
}

// ── JSON File Detection Result Repository ──

export class JsonFileDetectionResultRepository implements DetectionResultRepository {
  constructor(private db: JsonFileDatabase) {}

  async create(input: CreateDetectionResultInput): Promise<DetectionResultRow> {
    const id = input.id ?? uuid();
    const row: DetectionResultRow = {
      id,
      scanId: input.scanId,
      detectionId: input.detectionId,
      category: input.category,
      status: input.status,
      findings: input.findings ?? [],
      score: input.score ?? 0,
      startedAt: now(),
      completedAt: '',
      error: input.error ?? null,
    };
    this.db.getData().detectionResults[id] = row;
    this.db.save();
    return { ...row };
  }

  async findByScanId(scanId: string): Promise<DetectionResultRow[]> {
    return Object.values(this.db.getData().detectionResults)
      .filter((r) => r.scanId === scanId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  async findById(id: string): Promise<DetectionResultRow | null> {
    const row = this.db.getData().detectionResults[id];
    return row ? { ...row } : null;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const row = this.db.getData().detectionResults[id];
    if (row) {
      row.status = status;
      this.db.save();
    }
  }

  async updateCompletedAt(id: string): Promise<void> {
    const row = this.db.getData().detectionResults[id];
    if (row) {
      row.completedAt = now();
      this.db.save();
    }
  }
}

// ─ JSON File Scan Event Repository ──

export class JsonFileScanEventRepository implements ScanEventRepository {
  constructor(private db: JsonFileDatabase) {}

  async create(input: CreateScanEventInput): Promise<ScanEventRow> {
    const id = input.id ?? uuid();
    const row: ScanEventRow = {
      id,
      scanId: input.scanId,
      eventType: input.eventType,
      eventData: input.eventData,
      createdAt: now(),
      sequence: input.sequence,
    };
    this.db.getData().scanEvents[id] = row;
    this.db.save();
    return { ...row };
  }

  async findByScanId(scanId: string): Promise<ScanEventRow[]> {
    return Object.values(this.db.getData().scanEvents)
      .filter((r) => r.scanId === scanId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async getNextSequence(scanId: string): Promise<number> {
    const events = await this.findByScanId(scanId);
    return events.length > 0 ? events[events.length - 1]!.sequence + 1 : 1;
  }
}

// ── JSON File Report Repository ──

export class JsonFileReportRepository implements ReportRepository {
  constructor(private db: JsonFileDatabase) {}

  async create(input: CreateReportInput): Promise<ReportRow> {
    const id = input.id ?? uuid();
    const row: ReportRow = {
      id,
      scanId: input.scanId,
      format: input.format,
      content: input.content ?? null,
      data: input.data ?? {},
      createdAt: now(),
    };
    this.db.getData().reports[id] = row;
    this.db.save();
    return { ...row };
  }

  async findByScanId(scanId: string): Promise<ReportRow[]> {
    return Object.values(this.db.getData().reports)
      .filter((r) => r.scanId === scanId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findByScanIdAndFormat(scanId: string, format: string): Promise<ReportRow | null> {
    const row = Object.values(this.db.getData().reports).find(
      (r) => r.scanId === scanId && r.format === format
    );
    return row ? { ...row } : null;
  }

  async delete(id: string): Promise<void> {
    delete this.db.getData().reports[id];
    this.db.save();
  }
}
