import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { SeverityBadge } from '../components/ui/SeverityBadge';
import { ScoreGauge } from '../components/ui/ScoreGauge';
import { Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';

const formatOptions = [
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'html', label: 'HTML' },
];

interface ReportData {
  sessionId: string;
  url: string;
  score: number;
  summary: string;
  findings: {
    id: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    title: string;
    description: string;
    recommendation?: string;
  }[];
  /** Raw content for markdown/html formats */
  rawContent?: string;
}

export const ReportView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportData | null>(null);
  const [format, setFormat] = useState('json');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);

    api
      .getReport(id, format)
      .then((resp) => {
        // Markdown / HTML — raw text already in resp.content
        if (resp.raw !== undefined) {
          setReport({
            sessionId: id,
            url: '',
            score: 0,
            summary: '',
            findings: [],
            rawContent: resp.content,
          });
          return;
        }

        // JSON format — parse nested content string
        try {
          const inner = JSON.parse(resp.content) as {
            targetUrl: string;
            summary: { totalFindings: number; bySeverity: Record<string, number>; overallScore: number };
            findings: Array<{ id: string; severity: string; title: string; description: string; recommendation?: string; evidence?: { url?: string } }>;
            aiSummary: string;
          };
          const mapped: ReportData = {
            sessionId: id,
            url: inner.targetUrl,
            score: inner.summary?.overallScore ?? 0,
            summary: inner.aiSummary ?? '',
            findings: inner.findings.map((f) => ({
              id: f.id,
              severity: f.severity as ReportData['findings'][number]['severity'],
              title: f.title,
              description: f.description,
              recommendation: f.recommendation,
            })),
          };
          setReport(mapped);
        } catch {
          setReport(null);
          setError('Failed to parse report content');
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load report');
      })
      .finally(() => setLoading(false));
  }, [id, format]);

  const handleExport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${id}-${format}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const findingsBySeverity = report?.findings.reduce(
    (acc, finding) => {
      (acc[finding.severity] ??= []).push(finding);
      return acc;
    },
    {} as Record<string, typeof report.findings>
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        title="Failed to load report"
        description={error}
        action={
          <Button variant="secondary" onClick={() => navigate(`/sessions/${id}`)}>
            Back to Session
          </Button>
        }
      />
    );
  }

  if (!report) {
    return (
      <EmptyState
        title="No report available"
        description="Complete a session to generate a report."
        action={
          <Button variant="secondary" onClick={() => navigate('/')}>
            Go to Dashboard
          </Button>
        }
      />
    );
  }

  const severityOrder: ('critical' | 'high' | 'medium' | 'low' | 'info')[] = [
    'critical',
    'high',
    'medium',
    'low',
    'info',
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Session Report</h1>
          <p className="mt-1 text-sm text-slate-400">{report.url}</p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            options={formatOptions}
          />
          <Button variant="secondary" onClick={handleExport}>
            Export
          </Button>
          <Button variant="secondary" onClick={() => navigate(`/sessions/${id}`)}>
            Back to Session
          </Button>
        </div>
      </div>

      {/* Executive Summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card className="flex items-center justify-center">
          <ScoreGauge score={report.score} label="Overall Score" size={140} />
        </Card>
        <Card className="lg:col-span-3">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Executive Summary
          </h2>
          <p className="text-sm leading-relaxed text-slate-300 whitespace-pre-wrap">{report.summary}</p>
          <div className="mt-4 grid grid-cols-1 gap-4">
            <div>
              <p className="text-xs text-slate-400">Total Findings</p>
              <p className="text-xl font-bold text-slate-100">{report.findings.length}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Findings by Severity */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Findings</h2>
        {report.findings.length === 0 ? (
          <p className="text-sm text-slate-400">No findings for this session.</p>
        ) : (
          <div className="space-y-6">
            {severityOrder.map((severity) => {
              const items = findingsBySeverity?.[severity];
              if (!items || items.length === 0) return null;
              return (
                <div key={severity}>
                  <div className="mb-2 flex items-center gap-2">
                    <SeverityBadge severity={severity} />
                    <span className="text-sm text-slate-400">
                      {items.length} finding{items.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {items.map((finding) => (
                      <div
                        key={finding.id}
                        className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-4"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-medium text-slate-200">
                            {finding.title}
                          </h3>
                        </div>
                        <p className="mt-1 text-sm text-slate-400">{finding.description}</p>
                        {finding.recommendation && (
                          <p className="mt-2 rounded bg-slate-700/30 p-2 text-xs text-slate-300">
                            <span className="font-medium text-slate-200">Fix: </span>
                            {finding.recommendation}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};
