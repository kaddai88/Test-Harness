import React from 'react';
import type { ScanStatus } from '../../types';

interface StatusBadgeProps {
  status: ScanStatus;
}

const statusStyles: Record<ScanStatus, string> = {
  pending: 'bg-slate-400/20 text-slate-400 border-slate-400/30',
  running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  cancelled: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${statusStyles[status]}`}
  >
    {status === 'running' && (
      <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
    )}
    {status}
  </span>
);
