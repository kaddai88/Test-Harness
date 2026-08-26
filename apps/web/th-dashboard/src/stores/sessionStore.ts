import { create } from 'zustand';
import { api } from '../api/client';
import { sessionWebSocket } from '../api/websocket';
import type { Session, Finding, AgentActivity } from '../types';

interface SessionStore {
  sessions: Session[];
  currentSession: Session | null;
  findings: Finding[];
  agentActivity: AgentActivity[];
  /** Accumulated stream text for the current turn */
  streamText: string;
  loading: boolean;
  error: string | null;
  totalSessions: number;
  currentPage: number;
  pageSize: number;
  statusFilter: string;

  fetchSessions: () => Promise<void>;
  fetchSession: (id: string) => Promise<void>;
  createSession: (
    url: string,
    instructions?: string
  ) => Promise<string>;
  cancelSession: (id: string) => Promise<void>;
  setPage: (page: number) => void;
  setStatusFilter: (status: string) => void;
  clearError: () => void;
  connectWebSocket: () => () => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  currentSession: null,
  findings: [],
  agentActivity: [],
  streamText: '',
  loading: false,
  error: null,
  totalSessions: 0,
  currentPage: 1,
  pageSize: 20,
  statusFilter: 'all',

  fetchSessions: async () => {
    set({ loading: true, error: null });
    try {
      const { currentPage, pageSize, statusFilter } = get();
      const result = await api.getSessions(currentPage, pageSize, statusFilter);
      set({
        sessions: result.sessions ?? [],
        totalSessions: result.total ?? 0,
        loading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch sessions',
        loading: false,
      });
    }
  },

  fetchSession: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const session = await api.getSession(id);
      set({
        currentSession: session,
        findings: session.findings ?? [],
        loading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch session',
        loading: false,
      });
    }
  },

  createSession: async (url, instructions?: string) => {
    set({ loading: true, error: null });
    try {
      const result = await api.createSession({
        targetUrl: url,
        instructions,
      });
      set({ loading: false });
      return result.id;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create session',
        loading: false,
      });
      throw error;
    }
  },

  cancelSession: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await api.cancelSession(id);
      const { currentSession } = get();
      if (currentSession && currentSession.id === id) {
        set({ currentSession: { ...currentSession, status: 'cancelled' } });
      }
      set({ loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to cancel session',
        loading: false,
      });
    }
  },

  setPage: (page: number) => {
    set({ currentPage: page });
    get().fetchSessions();
  },

  setStatusFilter: (status: string) => {
    set({ statusFilter: status, currentPage: 1 });
    get().fetchSessions();
  },

  clearError: () => set({ error: null }),

  connectWebSocket: () => {
    sessionWebSocket.connect();

    const unsubs = [
      // Status change → merge into currentSession
      sessionWebSocket.onSessionUpdate(({ sessionId, status }) => {
        const { currentSession, sessions } = get();
        if (currentSession && currentSession.id === sessionId) {
          set({ currentSession: { ...currentSession, status: status as Session['status'] } });
        }
        set({
          sessions: sessions.map((s) =>
            s.id === sessionId ? { ...s, status: status as Session['status'] } : s
          ),
        });
      }),

      // Batch findings from completed session
      sessionWebSocket.onFinding((findings) => {
        set({ findings });
      }),

      // Agent activity stream
      sessionWebSocket.onAgentActivity((activity) => {
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
      sessionWebSocket.onSessionStatus(({ sessionId, status, message }) => {
        const { currentSession } = get();
        if (currentSession && currentSession.id === sessionId) {
          set({
            currentSession: {
              ...currentSession,
              status: status as Session['status'],
              phase: message ?? status,
            },
          });
        }
      }),

      // Session completed → update summary
      sessionWebSocket.onSessionCompleted(({ sessionId, status, summary, findingCount }) => {
        const { currentSession } = get();
        if (currentSession && currentSession.id === sessionId) {
          set({
            currentSession: {
              ...currentSession,
              status: status as Session['status'],
              metadata: {
                ...currentSession.metadata,
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
      sessionWebSocket.disconnect();
    };
  },
}));
