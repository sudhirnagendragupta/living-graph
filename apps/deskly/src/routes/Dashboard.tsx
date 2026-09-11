import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeskly } from '../store/desklyStore';
import { isV2 } from '../config';
import {
  Inbox,
  Clock,
  CheckCircle2,
  TrendingUp,
  ArrowUpRight,
  Plus,
  AlertCircle,
} from 'lucide-react';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { tickets, activities } = useDeskly();

  const openTickets = tickets.filter((t) => t.status === 'open');
  const inProgressTickets = tickets.filter((t) => t.status === 'in_progress');
  const resolvedTickets = tickets.filter((t) => t.status === 'resolved');
  const urgentTickets = tickets.filter((t) => t.priority === 'urgent' && t.status !== 'resolved');

  const stats = [
    {
      title: 'Open Queue',
      value: openTickets.length,
      subtext: `${urgentTickets.length} marked urgent`,
      icon: Inbox,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      title: 'In Progress',
      value: inProgressTickets.length,
      subtext: 'Active investigations',
      icon: Clock,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
    },
    {
      title: 'Resolved Today',
      value: resolvedTickets.length,
      subtext: '100% SLA compliance',
      icon: CheckCircle2,
      color: 'text-indigo-400',
      bg: 'bg-indigo-500/10',
    },
    {
      title: 'Satisfaction (CSAT)',
      value: '98.4%',
      subtext: '+2.1% from last week',
      icon: TrendingUp,
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/10',
    },
  ];

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight">Support Operations</h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Real-time queue health, team velocity, and recent system interactions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/tickets')}
            data-testid="dashboard-view-tickets-btn"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-200 transition-colors"
          >
            <span>View All Tickets</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-zinc-400" />
          </button>
          <button
            onClick={() => navigate('/tickets/new')}
            data-testid="dashboard-create-ticket-btn"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm shadow-indigo-600/30 transition-all"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>{isV2() ? 'Create Request' : 'New Ticket'}</span>
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <div
              key={idx}
              className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700/80 transition-all shadow-sm"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-zinc-400">{stat.title}</span>
                <div className={`p-1.5 rounded-lg ${stat.bg} ${stat.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-bold text-zinc-100 tracking-tight">{stat.value}</div>
              <div className="text-[11px] text-zinc-500 mt-1">{stat.subtext}</div>
            </div>
          );
        })}
      </div>

      {/* Middle Grid: Volume Chart Mockup & Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Ticket Distribution & Volume */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-200">Ticket Ingestion & Resolution</h2>
              <p className="text-[11px] text-zinc-500">Hourly throughput over the past 24 hours</p>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-zinc-800 text-zinc-400">
              Auto-refreshing
            </span>
          </div>

          {/* Bar Chart Visualization */}
          <div className="h-44 flex items-end justify-between gap-2 pt-6 px-2">
            {[40, 65, 30, 85, 95, 75, 45, 60, 80, 50, 90, 70].map((height, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group">
                <div className="w-full bg-zinc-800/80 rounded-t-md relative flex items-end justify-center overflow-hidden h-36">
                  <div
                    style={{ height: `${height}%` }}
                    className="w-full bg-indigo-600 group-hover:bg-indigo-500 transition-all duration-300 rounded-t-sm"
                  />
                </div>
                <span className="text-[10px] font-mono text-zinc-500">
                  {`${(i * 2 + 8) % 24}:00`}
                </span>
              </div>
            ))}
          </div>

          {/* High Priority Warning if urgent */}
          {urgentTickets.length > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>
                Attention: <strong>{urgentTickets[0].id}</strong> ({urgentTickets[0].title}) requires immediate triage.
              </span>
            </div>
          )}
        </div>

        {/* Right 1 Col: Live Activity Stream */}
        <div className="p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-200">Audit Stream</h2>
              <span className="text-[10px] text-zinc-500">Live</span>
            </div>

            <div className="mt-3 space-y-3">
              {activities.slice(0, 5).map((act) => (
                <div key={act.id} className="flex items-start gap-3 text-xs">
                  <img
                    src={act.user.avatar}
                    alt={act.user.name}
                    className="w-6 h-6 rounded-full object-cover mt-0.5 border border-zinc-800 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-zinc-300">
                      <span className="font-semibold text-zinc-200">{act.user.name}</span>{' '}
                      <span className="text-zinc-400">{act.action}</span>{' '}
                      <span className="font-mono text-indigo-400">{act.target}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">{act.timestamp}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => navigate('/tickets')}
            className="w-full mt-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 transition-colors"
          >
            Audit Log Details
          </button>
        </div>
      </div>
    </div>
  );
};
