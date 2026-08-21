import React from 'react';
import type { Severity } from '../../types';

interface SeverityBadgeProps {
  severity: Severity;
}

const severityStyles: Record<Severity, string> = {
  critical: 'bg-red-600/20 text-red-400 border-red-600/30',
  high: 'bg-red-500/20 text-red-400 border-red-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  info: 'bg-slate-400/20 text-slate-400 border-slate-400/30',
};

export const SeverityBadge: React.FC<SeverityBadgeProps> = ({ severity }) => (
  <span
    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${severityStyles[severity]}`}
  >
    {severity}
  </span>
);
