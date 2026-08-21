import React from 'react';

interface ScoreGaugeProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}

function getScoreColor(score: number): string {
  if (score >= 90) return 'text-emerald-400';
  if (score >= 70) return 'text-blue-400';
  if (score >= 50) return 'text-amber-400';
  if (score >= 30) return 'text-red-400';
  return 'text-red-600';
}

function getScoreStroke(score: number): string {
  if (score >= 90) return 'stroke-emerald-400';
  if (score >= 70) return 'stroke-blue-400';
  if (score >= 50) return 'stroke-amber-400';
  if (score >= 30) return 'stroke-red-400';
  return 'stroke-red-600';
}

export const ScoreGauge: React.FC<ScoreGaugeProps> = ({
  score,
  size = 120,
  strokeWidth = 8,
  label,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const center = size / 2;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            className="stroke-slate-700"
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
            strokeLinecap="round"
            className={`${getScoreStroke(score)} transition-all duration-700 ease-out`}
          />
        </svg>
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
        >
          <span className={`text-2xl font-bold ${getScoreColor(score)}`}>
            {Math.round(score)}
          </span>
          <span className="text-xs text-slate-400">/ 100</span>
        </div>
      </div>
      {label && <span className="text-sm text-slate-300">{label}</span>}
    </div>
  );
};
