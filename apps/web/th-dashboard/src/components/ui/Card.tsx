import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
  onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  padding = true,
  onClick,
}) => (
  <div
    className={`rounded-lg border border-slate-700 bg-slate-800 shadow-lg ${
      padding ? 'p-5' : ''
    } ${onClick ? 'cursor-pointer transition-colors hover:border-slate-600 hover:bg-slate-800/80' : ''} ${className}`}
    onClick={onClick}
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={
      onClick
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick();
            }
          }
        : undefined
    }
  >
    {children}
  </div>
);
