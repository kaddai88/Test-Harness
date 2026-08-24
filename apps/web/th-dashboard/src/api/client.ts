import type {
  Scan,
  ScanCreateRequest,
  ScanCreateResponse,
  Finding,
  HealthStatus,
  DetectionProgress,
  DashboardStats,
  PaginatedResponse,
} from '../types';

const API_BASE = '/api/v1';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${body || response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  getScans: (page = 1, pageSize = 20, status?: string): Promise<PaginatedResponse<Scan>> => {
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String((page - 1) * pageSize),
    });
    if (status && status !== 'all') {
      params.set('status', status);
    }
    return fetch(`${API_BASE}/scans?${params}`).then(handleResponse<PaginatedResponse<Scan>>);
  },

  getScan: (id: string): Promise<Scan> =>
    fetch(`${API_BASE}/scans/${id}`).then(handleResponse<Scan>),

  createScan: (data: ScanCreateRequest): Promise<ScanCreateResponse> =>
    fetch(`${API_BASE}/scans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrl: data.targetUrl ?? data.url,
        targetConfig: { scope: data.scope },
        scanConfig: {
          strategy: data.strategy,
          detections: data.categories ?? [],
          instructions: data.instructions,
        },
      }),
    }).then(handleResponse<ScanCreateResponse>),

  cancelScan: (id: string): Promise<void> =>
    fetch(`${API_BASE}/scans/${id}/cancel`, { method: 'POST' }).then((r) => {
      if (!r.ok) throw new Error(`Failed to cancel scan: ${r.statusText}`);
    }),

  getReport: (id: string, format: string): Promise<Record<string, unknown>> =>
    fetch(`${API_BASE}/scans/${id}/report?format=${format}`).then(
      handleResponse<Record<string, unknown>>
    ),

  getHealth: (): Promise<HealthStatus> =>
    fetch(`${API_BASE}/health`).then(handleResponse<HealthStatus>),

  getDetections: (scanId: string): Promise<DetectionProgress[]> =>
    fetch(`${API_BASE}/scans/${scanId}/detections`).then(handleResponse<DetectionProgress[]>),

  getFindings: (scanId: string): Promise<Finding[]> =>
    fetch(`${API_BASE}/scans/${scanId}/findings`).then(handleResponse<Finding[]>),

  getStats: (): Promise<DashboardStats> =>
    fetch(`${API_BASE}/stats`).then(handleResponse<DashboardStats>),
};
