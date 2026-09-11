import React from 'react';
import { TicketStatus, TicketPriority } from '../types';

export const StatusBadge: React.FC<{ status: TicketStatus; className?: string }> = ({
  status,
  className = '',
}) => {
  const config = {
    open: {
      label: 'Open',
      bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      dot: 'bg-emerald-400',
    },
    in_progress: {
      label: 'In Progress',
      bg: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      dot: 'bg-amber-400',
    },
    resolved: {
      label: 'Resolved',
      bg: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
      dot: 'bg-indigo-400',
    },
    closed: {
      label: 'Closed',
      bg: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
      dot: 'bg-zinc-400',
    },
  }[status] || {
    label: status,
    bg: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    dot: 'bg-zinc-400',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.bg} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
};

export const PriorityBadge: React.FC<{ priority: TicketPriority; className?: string }> = ({
  priority,
  className = '',
}) => {
  const config = {
    urgent: {
      label: 'Urgent',
      bg: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
    },
    high: {
      label: 'High',
      bg: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
    },
    medium: {
      label: 'Medium',
      bg: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
    },
    low: {
      label: 'Low',
      bg: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
    },
  }[priority];

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border uppercase tracking-wider ${config.bg} ${className}`}
    >
      {config.label}
    </span>
  );
};
