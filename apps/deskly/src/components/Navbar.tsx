import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeskly } from '../store/desklyStore';
import { isV2, currentVersion, setUIVersion } from '../config';
import {
  Search,
  Plus,
  Layers,
  LogOut,
  Sparkles,
  ChevronDown,
  RotateCcw,
} from 'lucide-react';

export const Navbar: React.FC<{ onOpenCommandPalette: () => void }> = ({
  onOpenCommandPalette,
}) => {
  const navigate = useNavigate();
  const { currentUser, logout, resetStore } = useDeskly();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showVersionMenu, setShowVersionMenu] = useState(false);

  return (
    <header className="h-14 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-30 px-4 flex items-center justify-between">
      {/* Left: Brand */}
      <div className="flex items-center gap-6">
        <div
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 cursor-pointer group select-none"
        >
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-indigo-600/30 group-hover:bg-indigo-500 transition-colors">
            D
          </div>
          <span className="font-semibold text-sm tracking-tight text-zinc-100 flex items-center gap-1.5">
            Deskly
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
              SaaS
            </span>
          </span>
        </div>

        {/* Global Search Bar (opens Cmd+K) */}
        <button
          onClick={onOpenCommandPalette}
          className="hidden md:flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 transition-all w-64 shadow-inner"
        >
          <Search className="w-3.5 h-3.5 text-zinc-500" />
          <span className="flex-1 text-left">Search or run command...</span>
          <kbd className="text-[10px] bg-zinc-800 border border-zinc-700 px-1 py-0.5 rounded text-zinc-400 font-mono">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right: Version pill, New Ticket (v1 only), User */}
      <div className="flex items-center gap-3">
        {/* Version Switcher Badge */}
        <div className="relative">
          <button
            onClick={() => setShowVersionMenu(!showVersionMenu)}
            data-testid="ui-version-badge"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 transition-all"
            title="Toggle between v1 and v2 UI variant"
          >
            <Layers className="w-3 h-3 text-indigo-400" />
            <span>UI: {currentVersion.toUpperCase()}</span>
            <ChevronDown className="w-3 h-3 text-indigo-400" />
          </button>

          {showVersionMenu && (
            <div className="absolute right-0 mt-2 w-44 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-1.5 z-40 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2 py-1 text-[10px] font-semibold text-zinc-500 uppercase">
                Switch UI Variant
              </div>
              <button
                onClick={() => {
                  setShowVersionMenu(false);
                  setUIVersion('v1');
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                  !isV2()
                    ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
              >
                <span>v1 Baseline</span>
                {!isV2() && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />}
              </button>
              <button
                onClick={() => {
                  setShowVersionMenu(false);
                  setUIVersion('v2');
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                  isV2()
                    ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
              >
                <span>v2 Redesign</span>
                {isV2() && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />}
              </button>
            </div>
          )}
        </div>

        {/* State Reset (Helper for Playwright walkers & demo replay) */}
        <button
          onClick={resetStore}
          data-testid="reset-state-btn"
          title="Reset sample data to initial state"
          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* v1 Redesign Center of Gravity: "New Ticket" button in Header */}
        {!isV2() && (
          <button
            onClick={() => navigate('/tickets/new')}
            data-testid="header-new-ticket-btn"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm shadow-indigo-600/30 transition-all active:scale-95"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>New Ticket</span>
          </button>
        )}

        {/* User avatar & menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 p-1 rounded-full hover:ring-2 hover:ring-zinc-700 transition-all"
          >
            <img
              src={currentUser.avatar}
              alt={currentUser.name}
              className="w-7 h-7 rounded-full object-cover border border-zinc-700"
            />
          </button>

          {showUserMenu && (
            <div className="absolute right-0 mt-2 w-52 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-2 z-40 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2 py-1.5 border-b border-zinc-800 mb-1">
                <div className="text-xs font-semibold text-zinc-100">{currentUser.name}</div>
                <div className="text-[11px] text-zinc-500 truncate">{currentUser.email}</div>
              </div>
              <button
                onClick={() => {
                  setShowUserMenu(false);
                  navigate('/settings');
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>Account Settings</span>
              </button>
              <button
                onClick={() => {
                  setShowUserMenu(false);
                  logout();
                  navigate('/login');
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
