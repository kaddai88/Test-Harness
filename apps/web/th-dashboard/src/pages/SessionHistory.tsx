import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import type { SessionStatus } from '../types';

const statusTabs: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

export const SessionHistory: React.FC = () => {
  const navigate = useNavigate();
  const { sessions, loading, totalSessions, currentPage, pageSize, statusFilter, fetchSessions, setPage, setStatusFilter } =
    useSessionStore();

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalSessions / pageSize)),
    [totalSessions, pageSize]
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Session History</h1>
          <p className="mt-1 text-sm text-slate-400">
            {totalSessions} session{totalSessions !== 1 ? 's' : ''} total
          </p>
        </div>
        <Button onClick={() => navigate('/sessions/new')}>New Session</Button>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex gap-1 rounded-lg border border-slate-700 bg-slate-800/50 p-1">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <Card padding={false}>
        {loading && sessions.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            title="No sessions found"
            description="No sessions match the current filter."
            action={
              <Button variant="secondary" onClick={() => navigate('/sessions/new')}>
                Create a session
              </Button>
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-3">URL</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Score</th>
                    <th className="px-5 py-3">Findings</th>
                    <th className="px-5 py-3">Duration</th>
                    <th className="px-5 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {sessions.map((session) => (
                    <tr
                      key={session.id}
                      className="cursor-pointer transition-colors hover:bg-slate-700/20"
                      onClick={() => navigate(`/sessions/${session.id}`)}
                    >
                      <td className="px-5 py-3">
                        <span className="block max-w-xs truncate text-sm font-medium text-slate-200">
                          {session.targetUrl}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={session.status as SessionStatus} />
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-300">
                        {session.score != null ? Math.round(session.score) : '—'}
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-300">
                        {session.findings?.length ?? 0}
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-300">
                        {session.startedAt && session.completedAt
                          ? `${Math.round((new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()) / 1000)}s`
                          : session.startedAt
                          ? '—'
                          : '—'
                        }
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-400">
                        {new Date(session.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between border-t border-slate-700 px-5 py-3">
              <span className="text-sm text-slate-400">
                Page {currentPage} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};
