import React from 'react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
}) => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    {icon && (
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-700/50 text-slate-400">
        {icon}
      </div>
    )}
    <h3 className="text-lg font-medium text-slate-200">{title}</h3>
    {description && (
      <p className="mt-1 max-w-sm text-sm text-slate-400">{description}</p>
    )}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
