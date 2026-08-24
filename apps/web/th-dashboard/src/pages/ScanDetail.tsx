import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useScanStore } from '../stores/scanStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ProgressBar } from '../components/ui/ProgressBar';
import { ScoreGauge } from '../components/ui/ScoreGauge';
import { StatusBadge } from '../components/ui/StatusBadge';
import { SeverityBadge } from '../components/ui/SeverityBadge';
import { Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';

const statusColors: Record<string, 'blue' | 'emerald' | 'amber' | 'red'> = {
  pending: 'blue',
  running: 'blue',
  completed: 'emerald',
  failed: 'red',
  cancelled: 'amber',
};

const detectionStatusIcon: Record<string, string> = {
  pending: '○',
  running: '◉',
  completed: '✓',
  failed: '✗',
  skipped: '—',
};

const detectionStatusColor: Record<string, string> = {
  pending: 'text-slate-400',
  running: 'text-blue-400',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  skipped: 'text-slate-500',
};

export const ScanDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    currentScan,
    findings,
    detections,
    agentActivity,
    loading,
    fetchScan,
    cancelScan,
    connectWebSocket,
  } = useScanStore();

  useEffect(() => {
    if (id) {
      void fetchScan(id);
    }
  }, [id, fetchScan]);

  useEffect(() => {
    if (!currentScan || currentScan.status === 'completed' || currentScan.status === 'failed' || currentScan.status === 'cancelled') {
      return;
    }
    const disconnect = connectWebSocket();
    return disconnect;
  }, [currentScan?.status, connectWebSocket]);

  if (loading && !currentScan) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!currentScan) {
    return (
      <EmptyState
        title="Scan not found"
        description="The scan you're looking for doesn't exist."
        action={
          <Button variant="secondary" onClick={() => navigate('/')}>
            Back to Dashboard
          </Button>
        }
      />
    );
  }

  const sortedFindings = [...findings].sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return (order[a.severity] ?? 5) - (order[b.severity] ?? 5);
  });

  const isActive = currentScan.status === 'running' || currentScan.status === 'pending';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-100">Scan Detail</h1>
            <StatusBadge status={currentScan.status} />
          </div>
          <p className="mt-1 text-sm text-slate-400">{currentScan.targetUrl}</p>
        </div>
        {isActive && (
          <Button variant="danger" onClick={() => id && cancelScan(id)}>
            Cancel Scan
          </Button>
        )}
        {!isActive && currentScan.status === 'completed' && id && (
          <Button variant="secondary" onClick={() => navigate(`/scans/${id}/report`)}>
            View Report
          </Button>
        )}
      </div>

      {/* Progress + Score */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Progress
          </h2>
          <ProgressBar
            progress={currentScan.progress ?? 0}
            label={currentScan.phase || currentScan.status}
            color={statusColors[currentScan.status] ?? 'blue'}
          />
          <div className="mt-4 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-slate-400">Started</p>
              <p className="text-sm font-medium text-slate-200">
                {currentScan.startedAt ? new Date(currentScan.startedAt).toLocaleTimeString() : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Duration</p>
              <p className="text-sm font-medium text-slate-200">
                {currentScan.startedAt && currentScan.completedAt
                  ? `${Math.round((new Date(currentScan.completedAt).getTime() - new Date(currentScan.startedAt).getTime()) / 1000)}s`
                  : currentScan.startedAt
                  ? `${Math.round((Date.now() - new Date(currentScan.startedAt).getTime()) / 1000)}s`
                  : '—'
                }
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Findings</p>
              <p className="text-sm font-medium text-slate-200">{findings.length}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Turns</p>
              <p className="text-sm font-medium text-slate-200">
                {(currentScan.metadata?.turns as number) ?? '—'}
              </p>
            </div>
          </div>
        </Card>

        <Card className="flex items-center justify-center">
          <ScoreGauge
            score={currentScan.score ?? 0}
            label="Overall Score"
            size={140}
          />
        </Card>
      </div>

      {/* AI Summary */}
      {typeof currentScan.metadata?.summary === 'string' && currentScan.metadata.summary && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-slate-100">AI Analysis Summary</h2>
          <pre className="whitespace-pre-wrap text-sm text-slate-300 font-sans leading-relaxed">
            {currentScan.metadata.summary}
          </pre>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Detection Progress */}
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Detections</h2>
          {detections.length === 0 ? (
            <EmptyState title="No detections" description="Detections will appear here." />
          ) : (
            <div className="space-y-3">
              {detections.map((det) => (
                <div
                  key={det.id}
                  className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-200">{det.name}</span>
                    <span className={`text-sm ${detectionStatusColor[det.status] ?? ''}`}>
                      <span className="mr-1">{detectionStatusIcon[det.status] ?? '?'}</span>
                      <span className="capitalize">{det.status}</span>
                    </span>
                  </div>
                  <ProgressBar
                    progress={det.progress}
                    showPercentage
                    color={
                      det.status === 'completed'
                        ? 'emerald'
                        : det.status === 'failed'
                          ? 'red'
                          : 'blue'
                    }
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    {det.findingsCount} finding{det.findingsCount !== 1 ? 's' : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Live Findings Feed */}
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Findings</h2>
          {sortedFindings.length === 0 ? (
            <EmptyState
              title="No findings yet"
              description="Findings will appear as detections complete."
            />
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin">
              {sortedFindings.map((finding) => (
                <div
                  key={finding.id}
                  className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-3"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <SeverityBadge severity={finding.severity} />
                    <span className="text-xs capitalize text-slate-400">
                      {finding.category}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-slate-200">{finding.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                    {finding.description}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Agent Activity Log */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Agent Activity</h2>
        {agentActivity.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Agent turns and tool calls will appear here."
          />
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto scrollbar-thin">
            {agentActivity.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-3 rounded border border-slate-700/30 bg-slate-800/30 px-3 py-2"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-700 text-xs text-slate-300">
                  {activity.turn}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-200">{activity.action}</span>
                    {activity.tool && (
                      <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400">
                        {activity.tool}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    {new Date(activity.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
