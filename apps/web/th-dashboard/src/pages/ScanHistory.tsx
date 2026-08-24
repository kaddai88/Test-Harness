import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScanStore } from '../stores/scanStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import type { ScanStatus } from '../types';

const statusTabs: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

export const ScanHistory: React.FC = () => {
  const navigate = useNavigate();
  const { scans, loading, totalScans, currentPage, pageSize, statusFilter, fetchScans, setPage, setStatusFilter } =
    useScanStore();

  useEffect(() => {
    void fetchScans();
  }, [fetchScans]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalScans / pageSize)),
    [totalScans, pageSize]
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Scan History</h1>
          <p className="mt-1 text-sm text-slate-400">
            {totalScans} scan{totalScans !== 1 ? 's' : ''} total
          </p>
        </div>
        <Button onClick={() => navigate('/scans/new')}>New Scan</Button>
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
        {loading && scans.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : scans.length === 0 ? (
          <EmptyState
            title="No scans found"
            description="No scans match the current filter."
            action={
              <Button variant="secondary" onClick={() => navigate('/scans/new')}>
                Create a scan
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
                  {scans.map((scan) => (
                    <tr
                      key={scan.id}
                      className="cursor-pointer transition-colors hover:bg-slate-700/20"
                      onClick={() => navigate(`/scans/${scan.id}`)}
                    >
                      <td className="px-5 py-3">
                        <span className="block max-w-xs truncate text-sm font-medium text-slate-200">
                          {scan.targetUrl}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={scan.status as ScanStatus} />
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-300">
                        {scan.score != null ? Math.round(scan.score) : '—'}
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-300">
                        {scan.findings?.length ?? 0}
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-300">
                        {scan.startedAt && scan.completedAt
                          ? `${Math.round((new Date(scan.completedAt).getTime() - new Date(scan.startedAt).getTime()) / 1000)}s`
                          : scan.startedAt
                          ? '—'
                          : '—'
                        }
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-400">
                        {new Date(scan.createdAt).toLocaleDateString()}
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
