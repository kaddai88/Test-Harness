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
  scanId: string;
  url: string;
  score: number;
  summary: string;
  categories: { name: string; score: number; findings: number }[];
  findings: {
    id: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    title: string;
    description: string;
    recommendation: string;
    category: string;
  }[];
  recommendations: string[];
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
      .then((data) => setReport(data as unknown as ReportData))
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
          <Button variant="secondary" onClick={() => navigate(`/scans/${id}`)}>
            Back to Scan
          </Button>
        }
      />
    );
  }

  if (!report) {
    return (
      <EmptyState
        title="No report available"
        description="Complete a scan to generate a report."
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
          <h1 className="text-2xl font-bold text-slate-100">Scan Report</h1>
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
          <Button variant="secondary" onClick={() => navigate(`/scans/${id}`)}>
            Back to Scan
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
          <p className="text-sm leading-relaxed text-slate-300">{report.summary}</p>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-slate-400">Total Findings</p>
              <p className="text-xl font-bold text-slate-100">{report.findings.length}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Categories</p>
              <p className="text-xl font-bold text-slate-100">{report.categories.length}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Recommendations</p>
              <p className="text-xl font-bold text-slate-100">
                {report.recommendations.length}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Score Breakdown */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Score by Category</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {report.categories.map((cat) => (
            <div
              key={cat.name}
              className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-4 text-center"
            >
              <p className="text-sm font-medium capitalize text-slate-300">{cat.name}</p>
              <p className="mt-1 text-2xl font-bold text-slate-100">{cat.score}</p>
              <p className="text-xs text-slate-400">{cat.findings} findings</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Findings by Severity */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Findings</h2>
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
                        <span className="shrink-0 text-xs capitalize text-slate-400">
                          {finding.category}
                        </span>
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
      </Card>

      {/* Recommendations */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Recommendations</h2>
        {report.recommendations.length === 0 ? (
          <p className="text-sm text-slate-400">No recommendations at this time.</p>
        ) : (
          <ol className="space-y-3">
            {report.recommendations.map((rec, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-xs font-medium text-blue-400">
                  {i + 1}
                </span>
                <span className="text-sm text-slate-300">{rec}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
};
