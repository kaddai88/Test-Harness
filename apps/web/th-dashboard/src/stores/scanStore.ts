import { create } from 'zustand';
import { api } from '../api/client';
import { scanWebSocket } from '../api/websocket';
import type { Scan, Finding, AgentActivity } from '../types';

interface ScanStore {
  scans: Scan[];
  currentScan: Scan | null;
  findings: Finding[];
  agentActivity: AgentActivity[];
  /** Accumulated stream text for the current turn */
  streamText: string;
  loading: boolean;
  error: string | null;
  totalScans: number;
  currentPage: number;
  pageSize: number;
  statusFilter: string;

  fetchScans: () => Promise<void>;
  fetchScan: (id: string) => Promise<void>;
  createScan: (
    url: string,
    scope: string,
    strategy: string,
    instructions?: string
  ) => Promise<string>;
  cancelScan: (id: string) => Promise<void>;
  setPage: (page: number) => void;
  setStatusFilter: (status: string) => void;
  clearError: () => void;
  connectWebSocket: () => () => void;
}

export const useScanStore = create<ScanStore>((set, get) => ({
  scans: [],
  currentScan: null,
  findings: [],
  agentActivity: [],
  streamText: '',
  loading: false,
  error: null,
  totalScans: 0,
  currentPage: 1,
  pageSize: 20,
  statusFilter: 'all',

  fetchScans: async () => {
    set({ loading: true, error: null });
    try {
      const { currentPage, pageSize, statusFilter } = get();
      const result = await api.getScans(currentPage, pageSize, statusFilter);
      set({
        scans: result.scans ?? result.items ?? [],
        totalScans: result.total ?? 0,
        loading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch scans',
        loading: false,
      });
    }
  },

  fetchScan: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const scan = await api.getScan(id);
      set({
        currentScan: scan,
        findings: scan.findings ?? [],
        loading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch scan',
        loading: false,
      });
    }
  },

  createScan: async (url, scope, strategy, instructions?: string) => {
    set({ loading: true, error: null });
    try {
      const result = await api.createScan({
        targetUrl: url,
        scope: scope as 'page' | 'site' | 'domain',
        strategy: strategy as 'sequential' | 'parallel' | 'adaptive',
        instructions,
      });
      set({ loading: false });
      return result.id;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create scan',
        loading: false,
      });
      throw error;
    }
  },

  cancelScan: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await api.cancelScan(id);
      const { currentScan } = get();
      if (currentScan && currentScan.id === id) {
        set({ currentScan: { ...currentScan, status: 'cancelled' } });
      }
      set({ loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to cancel scan',
        loading: false,
      });
    }
  },

  setPage: (page: number) => {
    set({ currentPage: page });
    get().fetchScans();
  },

  setStatusFilter: (status: string) => {
    set({ statusFilter: status, currentPage: 1 });
    get().fetchScans();
  },

  clearError: () => set({ error: null }),

  connectWebSocket: () => {
    scanWebSocket.connect();

    const unsubs = [
      // Status change → merge into currentScan
      scanWebSocket.onScanUpdate(({ sessionId, status }) => {
        const { currentScan, scans } = get();
        if (currentScan && currentScan.id === sessionId) {
          set({ currentScan: { ...currentScan, status: status as Scan['status'] } });
        }
        set({
          scans: scans.map((s) =>
            s.id === sessionId ? { ...s, status: status as Scan['status'] } : s
          ),
        });
      }),

      // Batch findings from completed session
      scanWebSocket.onFinding((findings) => {
        set({ findings });
      }),

      // Agent activity stream
      scanWebSocket.onAgentActivity((activity) => {
        const { streamText } = get();

        // Accumulate stream text
        if (activity.kind === 'stream' && activity.partial) {
          set({
            streamText: streamText + activity.partial,
            agentActivity: [...get().agentActivity, activity],
          });
          return;
        }

        // Clear stream text on new turn or tool call
        if (activity.kind === 'turn_started' || activity.kind === 'tool_call') {
          set({
            streamText: '',
            agentActivity: [...get().agentActivity, activity],
          });
          return;
        }

        // Default: just append
        set((state) => ({
          agentActivity: [...state.agentActivity, activity],
        }));
      }),

      // Session phase transition (planning → executing)
      scanWebSocket.onSessionStatus(({ sessionId, status, message }) => {
        const { currentScan } = get();
        if (currentScan && currentScan.id === sessionId) {
          set({
            currentScan: {
              ...currentScan,
              status: status as Scan['status'],
              phase: message ?? status,
            },
          });
        }
      }),

      // Session completed → update summary
      scanWebSocket.onSessionCompleted(({ sessionId, status, summary, findingCount }) => {
        const { currentScan } = get();
        if (currentScan && currentScan.id === sessionId) {
          set({
            currentScan: {
              ...currentScan,
              status: status as Scan['status'],
              metadata: {
                ...currentScan.metadata,
                summary: summary ?? '',
                findingCount: findingCount ?? 0,
              },
            },
          });
        }
      }),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
      scanWebSocket.disconnect();
    };
  },
}));
