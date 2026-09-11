import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useDeskly } from '../store/desklyStore';
import { isV2 } from '../config';
import {
  LayoutDashboard,
  Inbox,
  Settings,
  Plus,
  Compass,
  LifeBuoy,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const { tickets } = useDeskly();
  const openCount = tickets.filter((t) => t.status === 'open').length;

  const navItems = [
    {
      to: '/dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
    },
    {
      to: '/tickets',
      label: 'Tickets',
      icon: Inbox,
      badge: openCount > 0 ? openCount : undefined,
    },
    {
      to: '/settings',
      label: 'Settings',
      icon: Settings,
    },
  ];

  return (
    <aside className="w-56 border-r border-zinc-800 bg-zinc-950 flex flex-col justify-between p-3 shrink-0 select-none">
      <div className="space-y-4">
        {/* v2 Redesign Center of Gravity: "Create Request" moved to Sidebar */}
        {isV2() && (
          <div className="pb-1 border-b border-zinc-800/80">
            <button
              onClick={() => navigate('/tickets/new')}
              data-testid="sidebar-create-request-btn"
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all active:scale-98"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Create Request</span>
            </button>
          </div>
        )}

        {/* Primary Navigation Links */}
        <nav className="space-y-1">
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Workspace
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-zinc-800/90 text-white font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                  }`
                }
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 text-zinc-400" />
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Footer / System Info */}
      <div className="pt-3 border-t border-zinc-900 space-y-2">
        <div className="px-2.5 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800/60 text-[11px] text-zinc-400">
          <div className="flex items-center gap-1.5 font-medium text-zinc-300 mb-0.5">
            <Compass className="w-3.5 h-3.5 text-indigo-400" />
            <span>Living Graph Target</span>
          </div>
          <div className="text-[10px] text-zinc-500">
            Automated walkthrough & drift detection harness
          </div>
        </div>

        <a
          href="https://github.com/sudhirnagendragupta/living-graph"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <LifeBuoy className="w-3.5 h-3.5" />
          <span>Documentation Repo</span>
        </a>
      </div>
    </aside>
  );
};
