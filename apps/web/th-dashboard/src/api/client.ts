import type {
  Session,
  SessionCreateRequest,
  SessionCreateResponse,
  HealthStatus,
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
  getSessions: (page = 1, pageSize = 20, status?: string): Promise<PaginatedResponse<Session>> => {
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String((page - 1) * pageSize),
    });
    if (status && status !== 'all') {
      params.set('status', status);
    }
    return fetch(`${API_BASE}/sessions?${params}`).then(handleResponse<PaginatedResponse<Session>>);
  },

  getSession: (id: string): Promise<Session> =>
    fetch(`${API_BASE}/sessions/${id}`).then(handleResponse<Session>),

  createSession: (data: SessionCreateRequest): Promise<SessionCreateResponse> =>
    fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrl: data.targetUrl ?? data.url,
        scanConfig: {
          instructions: data.instructions,
          maxTurns: data.maxTurns,
          maxRetriesPerAction: data.maxRetriesPerAction,
        },
      }),
    }).then(handleResponse<SessionCreateResponse>),

  cancelSession: (id: string): Promise<void> =>
    fetch(`${API_BASE}/sessions/${id}/cancel`, { method: 'POST' }).then((r) => {
      if (!r.ok) throw new Error(`Failed to cancel session: ${r.statusText}`);
    }),

  getReport: (id: string, format: string): Promise<{ content: string; raw?: string }> =>
    fetch(`${API_BASE}/sessions/${id}/report?format=${format}`).then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`API error ${r.status}: ${text || r.statusText}`);
      }
      const contentType = r.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        return r.json() as Promise<{ content: string }>;
      }
      // Markdown or HTML — return raw text
      const text = await r.text();
      return { content: text, raw: text };
    }),

  getHealth: (): Promise<HealthStatus> =>
    fetch(`${API_BASE}/health`).then(handleResponse<HealthStatus>),
};
