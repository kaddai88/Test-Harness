# Test-Harness API Reference

The Test-Harness server exposes a REST API and a WebSocket channel for
real-time updates. This document covers the full surface area.

## 1. Base URL & Authentication

| Environment | Base URL |
|---|---|
| Local dev | `http://localhost:3000` |
| Docker | `http://localhost:3000` |
| Production | set by your deployment |

**Authentication:** not enabled in v0.1.0. All endpoints are open. The API is
intended to be fronted by a reverse proxy that handles auth in production.

**Content type:** all request/response bodies are JSON unless noted otherwise.
Set `Content-Type: application/json` on write requests.

**CORS:** all responses include permissive CORS headers so browser clients can
talk to the API directly.

## 2. Conventions

- All routes are prefixed with `/api/v1`.
- Successful responses use standard HTTP status codes (`200`, `201`, `204`).
- Errors return:
  ```json
  { "error": "Human-readable description" }
  ```
- Lists are paginated with `limit` and `offset` query params.
- Timestamps are ISO-8601 strings in UTC.

## 3. REST Endpoints

### 3.1 Health

#### `GET /api/v1/health`

Liveness probe.

**Response `200`**

```json
{
  "status": "ok",
  "timestamp": "2026-08-21T10:00:00.000Z",
  "version": "0.1.0"
}
```

**curl**

```bash
curl http://localhost:3000/api/v1/health
```

---

#### `GET /api/v1/status`

System status — scan counts and queue depth.

**Response `200`**

```json
{
  "status": "ok",
  "scans": {
    "total": 42,
    "pending": 2,
    "active": 1,
    "completed": 38,
    "failed": 1
  },
  "queue": {
    "waiting": 2,
    "active": 1
  }
}
```

**curl**

```bash
curl http://localhost:3000/api/v1/status
```

---

### 3.2 Scans

#### `POST /api/v1/scans`

Create and enqueue a new scan.

**Request body**

```ts
{
  targetUrl: string;              // required — the URL to scan
  targetConfig?: object;          // optional — per-target settings
  scanConfig?: object;            // optional — scan-level settings
  detectionIds?: string[];        // optional — limit to specific detections
}
```

**Response `201`**

```ts
{
  id: string;
  targetUrl: string;
  targetConfig: object;
  scanConfig: object;
  status: "pending";
  createdAt: string;      // ISO
  updatedAt: string;
  startedAt: null | string;
  completedAt: null | string;
}
```

**Errors**

| Status | Body |
|---|---|
| `400` | `{ "error": "targetUrl is required" }` or `{ "error": "Invalid JSON body" }` |

**curl**

```bash
curl -X POST http://localhost:3000/api/v1/scans \
  -H "Content-Type: application/json" \
  -d '{"targetUrl":"https://example.com","scanConfig":{"scope":"site"}}'
```

---

#### `GET /api/v1/scans`

List scans, paginated.

**Query parameters**

| Name | Type | Default | Notes |
|---|---|---|---|
| `limit` | int | `50` | max 200 |
| `offset` | int | `0` | |
| `status` | string | — | filter: `pending`, `analyzing`, `completed`, `failed`, `cancelled` |

**Response `200`**

```ts
{
  scans: Scan[];
  total: number;
  limit: number;
  offset: number;
}
```

**curl**

```bash
curl "http://localhost:3000/api/v1/scans?status=completed&limit=20"
```

---

#### `GET /api/v1/scans/:id`

Fetch one scan with its detection results and event log.

**Response `200`**

```ts
{
  scan: Scan;
  detectionResults: DetectionResult[];
  events: ScanEvent[];
}
```

**Errors**

| Status | Body |
|---|---|
| `400` | `{ "error": "Missing scan id" }` |
| `404` | `{ "error": "Scan not found" }` |

**curl**

```bash
curl http://localhost:3000/api/v1/scans/abc123
```

---

#### `DELETE /api/v1/scans/:id`

Delete a scan and all associated data.

**Response `200`**

```json
{ "deleted": true }
```

**Errors**

| Status | Body |
|---|---|
| `404` | `{ "error": "Scan not found" }` |

**curl**

```bash
curl -X DELETE http://localhost:3000/api/v1/scans/abc123
```

---

#### `POST /api/v1/scans/:id/cancel`

Cancel a running or pending scan.

**Response `200`**

```json
{ "cancelled": true }
```

**Errors**

| Status | Body |
|---|---|
| `404` | `{ "error": "Scan not found" }` |
| `409` | `{ "error": "Cannot cancel scan in \"completed\" status" }` |

**curl**

```bash
curl -X POST http://localhost:3000/api/v1/scans/abc123/cancel
```

---

### 3.3 Detections

#### `GET /api/v1/detections`

List all registered detection plugins.

**Response `200`**

```ts
{
  detections: Array<{
    id: string;
    name: string;
    category: "security" | "performance" | "functionality" | "seo" | "accessibility";
    description: string;
    version: string;
  }>;
  total: number;
}
```

**curl**

```bash
curl http://localhost:3000/api/v1/detections
```

---

### 3.4 Reports

#### `GET /api/v1/scans/:id/report`

Generate (or retrieve a cached) report for a completed scan.

**Query parameters**

| Name | Type | Default | Notes |
|---|---|---|---|
| `format` | string | `json` | `json`, `markdown`, or `html` |

**Response `200` (json format)**

```ts
{
  scanId: string;
  format: "json";
  content: string;           // JSON-encoded report body
  data: object;              // structured report data
}
```

**Response `200` (markdown / html)**

The body is the rendered report, with `Content-Type: text/markdown` or
`text/html`.

**Errors**

| Status | Body |
|---|---|
| `400` | `{ "error": "Unsupported format \"pdf\". Use json, markdown, or html." }` |
| `404` | `{ "error": "Scan not found" }` |

**curl**

```bash
curl "http://localhost:3000/api/v1/scans/abc123/report?format=markdown"
```

## 4. WebSocket Protocol

Upgrade at `ws://localhost:3000` (any path). The server implements RFC 6455
over raw `node:http` — no subprotocols, no extensions.

### 4.1 Connection lifecycle

1. Client opens the WebSocket.
2. Server sends a `connected` welcome frame:
   ```json
   { "type": "connected", "clientId": "ws_1", "timestamp": "..." }
   ```
3. Server pushes events as scans progress.

### 4.2 Server → Client events

| `type` | Extra fields | Description |
|---|---|---|
| `connected` | `clientId`, `timestamp` | Welcome frame after handshake |
| `scan:progress` | `scanId`, `status`, `progress?`, `message?` | Progress update during a scan |
| `agent:event` | `scanId`, `eventType`, `payload` | Agent loop telemetry |
| `scan:completed` | `scanId`, `status`, `summary?` | Scan finished (success or failure) |

### 4.3 Client → Server messages

Subscribe to a specific scan:

```json
{ "type": "subscribe", "subscribe": "scan:<scanId>" }
```

In v0.1.0 all clients receive all broadcasts; subscriptions are accepted but
not yet filtered.

### 4.4 Wire format

All frames are **text** (opcode `0x1`) containing UTF-8 JSON. Binary frames,
continuations, and extensions are not supported.

### 4.5 Example: `websocat`

```bash
websocat ws://localhost:3000
# {"type":"connected","clientId":"ws_1","timestamp":"2026-08-21T10:00:00.000Z"}
# ... create a scan via REST ...
# {"type":"scan:progress","scanId":"abc123","status":"analyzing","progress":12}
# {"type":"scan:completed","scanId":"abc123","status":"completed","summary":"..."}
```

## 5. Error Codes

| Status | Meaning |
|---|---|
| `400` | Bad request — malformed body, missing required field, invalid enum |
| `404` | Resource not found (scan, report) |
| `409` | Conflict — e.g. cancelling a scan that already completed |
| `500` | Internal server error — check server logs |

Errors always use the shape `{ "error": "..." }`. Additional context keys may
be present but clients should only rely on `error`.

## 6. Rate Limits

No rate limits in v0.1.0. Put a reverse proxy (nginx, Caddy) in front for
production.

## 7. Examples: End-to-End

```bash
# 1. Health check
curl http://localhost:3000/api/v1/health

# 2. List available detections
curl http://localhost:3000/api/v1/detections | jq

# 3. Start a scan
SCAN=$(curl -s -X POST http://localhost:3000/api/v1/scans \
  -H "Content-Type: application/json" \
  -d '{"targetUrl":"https://example.com"}')
echo "$SCAN" | jq .id
SCAN_ID=$(echo "$SCAN" | jq -r .id)

# 4. Poll status
curl -s "http://localhost:3000/api/v1/scans/$SCAN_ID" | jq .scan.status

# 5. Fetch the markdown report once the scan completes
curl "http://localhost:3000/api/v1/scans/$SCAN_ID/report?format=markdown"
```
