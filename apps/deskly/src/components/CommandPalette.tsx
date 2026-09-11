import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeskly } from '../store/desklyStore';
import { Search, PlusCircle, LayoutDashboard, Ticket as TicketIcon, Settings, X } from 'lucide-react';
import { isV2 } from '../config';

export const CommandPalette: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { tickets } = useDeskly();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!isOpen) return null;

  const filteredTickets = tickets.filter(
    (t) =>
      t.title.toLowerCase().includes(query.toLowerCase()) ||
      t.id.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = (action: () => void) => {
    action();
    onClose();
    setQuery('');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-24 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-4 py-3 border-b border-zinc-800">
          <Search className="w-4 h-4 text-zinc-400 mr-3" />
          <input
            type="text"
            placeholder="Type a command or search tickets..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2 text-xs space-y-1">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
            Quick Actions
          </div>
          <button
            onClick={() => handleSelect(() => navigate('/tickets/new'))}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <PlusCircle className="w-4 h-4 text-indigo-400" />
            <span>{isV2() ? 'Create Request' : 'New Ticket'}</span>
            <kbd className="ml-auto text-[10px] bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded text-zinc-400">
              N
            </kbd>
          </button>
          <button
            onClick={() => handleSelect(() => navigate('/dashboard'))}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <LayoutDashboard className="w-4 h-4 text-emerald-400" />
            <span>Go to Dashboard</span>
          </button>
          <button
            onClick={() => handleSelect(() => navigate('/tickets'))}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <TicketIcon className="w-4 h-4 text-amber-400" />
            <span>View All Tickets</span>
          </button>
          <button
            onClick={() => handleSelect(() => navigate('/settings'))}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <Settings className="w-4 h-4 text-cyan-400" />
            <span>Open Settings</span>
          </button>

          {filteredTickets.length > 0 && (
            <>
              <div className="px-3 pt-3 pb-1 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                Matching Tickets ({filteredTickets.length})
              </div>
              {filteredTickets.slice(0, 5).map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleSelect(() => navigate(`/tickets/${t.id}`))}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
                >
                  <span className="font-mono text-zinc-500 shrink-0">{t.id}</span>
                  <span className="truncate flex-1">{t.title}</span>
                  <span className="text-[10px] text-zinc-400 uppercase">{t.status}</span>
                </button>
              ))}
            </>
          )}
        </div>

        <div className="px-4 py-2 border-t border-zinc-800/80 bg-zinc-950/40 flex items-center justify-between text-[11px] text-zinc-500">
          <span>Navigation</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
};
