/**
 * Tests for SQLite repositories.
 *
 * better-sqlite3 requires native bindings. Skip gracefully if unavailable.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Try to load better-sqlite3 — skip all tests if native bindings are missing.
let SQLiteDatabase: typeof import("./sqlite.js").SQLiteDatabase;
let SQLiteScanRepository: typeof import("./sqlite.js").SQLiteScanRepository;
let SQLiteDetectionResultRepository: typeof import("./sqlite.js").SQLiteDetectionResultRepository;
let SQLiteScanEventRepository: typeof import("./sqlite.js").SQLiteScanEventRepository;
let SQLiteReportRepository: typeof import("./sqlite.js").SQLiteReportRepository;
let canRun = false;

try {
  const mod = await import("./sqlite.js");
  SQLiteDatabase = mod.SQLiteDatabase;
  SQLiteScanRepository = mod.SQLiteScanRepository;
  SQLiteDetectionResultRepository = mod.SQLiteDetectionResultRepository;
  SQLiteScanEventRepository = mod.SQLiteScanEventRepository;
  SQLiteReportRepository = mod.SQLiteReportRepository;
  // Attempt to actually instantiate — this triggers native binding load.
  const testDb = new SQLiteDatabase(":memory:");
  testDb.close();
  canRun = true;
} catch {
  canRun = false;
}

const describeSqlite = canRun ? describe : describe.skip;

describeSqlite("SQLite Repositories", () => {
  let db: InstanceType<typeof SQLiteDatabase>;

  beforeEach(() => {
    db = new SQLiteDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  // ── createInMemoryDatabase ──

  it("createInMemoryDatabase creates all repos", () => {
    const rawDb = db.getDb();
    const scanRepo = new SQLiteScanRepository(rawDb);
    const detectionRepo = new SQLiteDetectionResultRepository(rawDb);
    const eventRepo = new SQLiteScanEventRepository(rawDb);
    const reportRepo = new SQLiteReportRepository(rawDb);

    expect(scanRepo).toBeDefined();
    expect(detectionRepo).toBeDefined();
    expect(eventRepo).toBeDefined();
    expect(reportRepo).toBeDefined();
  });

  // ── ScanRepository ──

  describe("SQLiteScanRepository", () => {
    let repo: InstanceType<typeof SQLiteScanRepository>;

    beforeEach(() => {
      repo = new SQLiteScanRepository(db.getDb());
    });

    it("create and findById", async () => {
      const scan = await repo.create({
        id: "scan-1",
        targetUrl: "https://example.com",
        targetConfig: { depth: 2 },
        scanConfig: { detectionIds: ["d1"] },
        createdBy: "tester",
        metadata: { note: "test scan" },
      });

      expect(scan.id).toBe("scan-1");
      expect(scan.targetUrl).toBe("https://example.com");
      expect(scan.targetConfig).toEqual({ depth: 2 });
      expect(scan.status).toBe("pending");
      expect(scan.createdBy).toBe("tester");

      const found = await repo.findById("scan-1");
      expect(found).not.toBeNull();
      expect(found!.id).toBe("scan-1");
    });

    it("findById returns null for missing id", async () => {
      const result = await repo.findById("nonexistent");
      expect(result).toBeNull();
    });

    it("findAll returns all scans", async () => {
      await repo.create({ id: "s1", targetUrl: "https://a.com", targetConfig: {}, scanConfig: {} });
      await repo.create({ id: "s2", targetUrl: "https://b.com", targetConfig: {}, scanConfig: {} });

      const all = await repo.findAll();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it("findAll filters by status", async () => {
      await repo.create({ id: "s1", targetUrl: "https://a.com", targetConfig: {}, scanConfig: {} });
      await repo.create({ id: "s2", targetUrl: "https://b.com", targetConfig: {}, scanConfig: {} });
      await repo.updateStatus("s1", "completed");

      const pending = await repo.findAll({ status: "pending" });
      const pendingIds = pending.map((s) => s.id);
      expect(pendingIds).toContain("s2");
      expect(pendingIds).not.toContain("s1");
    });

    it("updateStatus changes status", async () => {
      await repo.create({ id: "s1", targetUrl: "https://a.com", targetConfig: {}, scanConfig: {} });
      await repo.updateStatus("s1", "running");
      const updated = await repo.findById("s1");
      expect(updated!.status).toBe("running");
    });

    it("delete removes the scan", async () => {
      await repo.create({ id: "s1", targetUrl: "https://a.com", targetConfig: {}, scanConfig: {} });
      await repo.delete("s1");
      const found = await repo.findById("s1");
      expect(found).toBeNull();
    });
  });

  // ── DetectionResultRepository ──

  describe("SQLiteDetectionResultRepository", () => {
    let scanRepo: InstanceType<typeof SQLiteScanRepository>;
    let repo: InstanceType<typeof SQLiteDetectionResultRepository>;

    beforeEach(async () => {
      scanRepo = new SQLiteScanRepository(db.getDb());
      repo = new SQLiteDetectionResultRepository(db.getDb());
      await scanRepo.create({ id: "scan-1", targetUrl: "https://example.com", targetConfig: {}, scanConfig: {} });
    });

    it("create and findByScanId", async () => {
      await repo.create({
        id: "det-1", scanId: "scan-1", detectionId: "plugin-a",
        category: "security", status: "completed",
        findings: [{ severity: "high", title: "XSS" }], score: 75,
      });

      const results = await repo.findByScanId("scan-1");
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("det-1");
      expect(results[0]!.score).toBe(75);
    });

    it("findByScanId returns empty for unknown scan", async () => {
      const results = await repo.findByScanId("nonexistent");
      expect(results).toEqual([]);
    });

    it("multiple results for same scan", async () => {
      await repo.create({ id: "det-1", scanId: "scan-1", detectionId: "plugin-a", category: "security", status: "completed", score: 75 });
      await repo.create({ id: "det-2", scanId: "scan-1", detectionId: "plugin-b", category: "accessibility", status: "completed", score: 90 });

      const results = await repo.findByScanId("scan-1");
      expect(results).toHaveLength(2);
    });
  });

  // ── ScanEventRepository ──

  describe("SQLiteScanEventRepository", () => {
    let scanRepo: InstanceType<typeof SQLiteScanRepository>;
    let repo: InstanceType<typeof SQLiteScanEventRepository>;

    beforeEach(async () => {
      scanRepo = new SQLiteScanRepository(db.getDb());
      repo = new SQLiteScanEventRepository(db.getDb());
      await scanRepo.create({ id: "scan-1", targetUrl: "https://example.com", targetConfig: {}, scanConfig: {} });
    });

    it("create and findByScanId", async () => {
      await repo.create({
        id: "ev-1", scanId: "scan-1", eventType: "scan:started",
        eventData: { timestamp: 1000 }, sequence: 1,
      });

      const events = await repo.findByScanId("scan-1");
      expect(events).toHaveLength(1);
      expect(events[0]!.eventType).toBe("scan:started");
      expect(events[0]!.sequence).toBe(1);
    });

    it("findByScanId orders by sequence", async () => {
      await repo.create({ id: "ev-3", scanId: "scan-1", eventType: "third", eventData: {}, sequence: 3 });
      await repo.create({ id: "ev-1", scanId: "scan-1", eventType: "first", eventData: {}, sequence: 1 });
      await repo.create({ id: "ev-2", scanId: "scan-1", eventType: "second", eventData: {}, sequence: 2 });

      const events = await repo.findByScanId("scan-1");
      expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    });

    it("getNextSequence returns 1 for empty scan", async () => {
      const seq = await repo.getNextSequence("scan-1");
      expect(seq).toBe(1);
    });

    it("getNextSequence returns max + 1", async () => {
      await repo.create({ id: "ev-1", scanId: "scan-1", eventType: "first", eventData: {}, sequence: 1 });
      await repo.create({ id: "ev-2", scanId: "scan-1", eventType: "second", eventData: {}, sequence: 2 });

      const seq = await repo.getNextSequence("scan-1");
      expect(seq).toBe(3);
    });
  });

  // ── ReportRepository ──

  describe("SQLiteReportRepository", () => {
    let scanRepo: InstanceType<typeof SQLiteScanRepository>;
    let repo: InstanceType<typeof SQLiteReportRepository>;

    beforeEach(async () => {
      scanRepo = new SQLiteScanRepository(db.getDb());
      repo = new SQLiteReportRepository(db.getDb());
      await scanRepo.create({ id: "scan-1", targetUrl: "https://example.com", targetConfig: {}, scanConfig: {} });
    });

    it("create and findByScanId", async () => {
      await repo.create({
        id: "rpt-1", scanId: "scan-1", format: "html",
        content: "<h1>Report</h1>", data: { sections: ["summary"] },
      });

      const reports = await repo.findByScanId("scan-1");
      expect(reports).toHaveLength(1);
      expect(reports[0]!.format).toBe("html");
      expect(reports[0]!.content).toBe("<h1>Report</h1>");
    });

    it("findByScanIdAndFormat", async () => {
      await repo.create({ id: "rpt-html", scanId: "scan-1", format: "html", content: "<html></html>" });
      await repo.create({ id: "rpt-json", scanId: "scan-1", format: "json", content: null, data: { results: [] } });

      const html = await repo.findByScanIdAndFormat("scan-1", "html");
      expect(html).not.toBeNull();
      expect(html!.format).toBe("html");

      const pdf = await repo.findByScanIdAndFormat("scan-1", "pdf");
      expect(pdf).toBeNull();
    });

    it("findByScanIdAndFormat returns latest for duplicates", async () => {
      await repo.create({ id: "rpt-1", scanId: "scan-1", format: "html", content: "v1" });
      await repo.create({ id: "rpt-2", scanId: "scan-1", format: "html", content: "v2" });

      const latest = await repo.findByScanIdAndFormat("scan-1", "html");
      expect(latest!.content).toBe("v2");
    });
  });
});
