import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeskly } from '../store/desklyStore';
import { TicketStatus, TicketPriority } from '../types';
import { StatusBadge, PriorityBadge } from '../components/StatusBadge';
import { isV2 } from '../config';
import {
  Search,
  ArrowUpDown,
  Plus,
  CheckSquare,
  Square,
  ChevronRight,
} from 'lucide-react';

export const TicketList: React.FC = () => {
  const navigate = useNavigate();
  const { tickets, bulkUpdateStatus } = useDeskly();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TicketStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | TicketPriority>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortField, setSortField] = useState<'ticketNumber' | 'updatedAt'>('ticketNumber');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Filter logic
  const filteredTickets = tickets
    .filter((t) => {
      const matchesSearch =
        t.title.toLowerCase().includes(search.toLowerCase()) ||
        t.id.toLowerCase().includes(search.toLowerCase()) ||
        t.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()));

      const matchesStatus = statusFilter === 'all' ? true : t.status === statusFilter;
      const matchesPriority = priorityFilter === 'all' ? true : t.priority === priorityFilter;

      return matchesSearch && matchesStatus && matchesPriority;
    })
    .sort((a, b) => {
      if (sortField === 'ticketNumber') {
        return sortOrder === 'asc'
          ? a.ticketNumber - b.ticketNumber
          : b.ticketNumber - a.ticketNumber;
      }
      return 0;
    });

  const handleSelectAll = () => {
    if (selectedIds.length === filteredTickets.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredTickets.map((t) => t.id));
    }
  };

  const handleToggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleBulkStatus = async (status: TicketStatus) => {
    if (selectedIds.length === 0) return;
    await bulkUpdateStatus(selectedIds, status);
    setSelectedIds([]);
  };

  return (
    <div className="space-y-4 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight">Tickets</h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Manage, triage, and resolve incoming user support requests
          </p>
        </div>
        <button
          onClick={() => navigate('/tickets/new')}
          data-testid="ticket-list-new-ticket-btn"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm shadow-indigo-600/30 transition-all self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>{isV2() ? 'Create Request' : 'New Ticket'}</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-1">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800 self-start">
          {(['all', 'open', 'in_progress', 'resolved'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              data-testid={`filter-tab-${tab}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                statusFilter === tab
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="capitalize">{tab.replace('_', ' ')}</span>
              <span className="ml-1.5 font-mono text-[10px] text-zinc-500">
                {tab === 'all'
                  ? tickets.length
                  : tickets.filter((t) => t.status === tab).length}
              </span>
            </button>
          ))}
        </div>

        {/* Search & Priority Filter */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5" />
            <input
              type="text"
              data-testid="ticket-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by title, ID, tag..."
              className="w-full bg-zinc-900 border border-zinc-800 focus:border-indigo-500 rounded-lg pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none transition-colors"
            />
          </div>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as any)}
            className="bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {/* Bulk Action Bar (when rows are selected) */}
      {selectedIds.length > 0 && (
        <div
          data-testid="bulk-actions-bar"
          className="flex items-center justify-between p-2.5 px-4 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-xs text-indigo-200 animate-in fade-in duration-150"
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold">{selectedIds.length}</span> tickets selected
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-400">Set Status:</span>
            <button
              onClick={() => handleBulkStatus('in_progress')}
              data-testid="bulk-status-in-progress-btn"
              className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-200"
            >
              In Progress
            </button>
            <button
              onClick={() => handleBulkStatus('resolved')}
              data-testid="bulk-status-resolved-btn"
              className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white"
            >
              Resolved
            </button>
            <button
              onClick={() => setSelectedIds([])}
              className="px-2 py-1 text-zinc-400 hover:text-zinc-200 text-xs ml-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Ticket Table */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/80 text-zinc-400 font-medium select-none">
              <th className="p-3 pl-4 w-10">
                <button
                  onClick={handleSelectAll}
                  className="text-zinc-500 hover:text-zinc-300 transition-colors"
                  aria-label="Select all tickets"
                >
                  {selectedIds.length === filteredTickets.length && filteredTickets.length > 0 ? (
                    <CheckSquare className="w-4 h-4 text-indigo-400" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                </button>
              </th>
              <th
                onClick={() => {
                  setSortField('ticketNumber');
                  setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                }}
                className="p-3 w-28 cursor-pointer hover:text-zinc-200 transition-colors"
              >
                <div className="flex items-center gap-1">
                  <span>ID</span>
                  <ArrowUpDown className="w-3 h-3 text-zinc-500" />
                </div>
              </th>
              <th className="p-3">Title & Tags</th>
              <th className="p-3 w-32">Status</th>
              <th className="p-3 w-28">Priority</th>
              <th className="p-3 w-40">Assignee</th>
              <th className="p-3 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {filteredTickets.map((ticket) => {
              const isSelected = selectedIds.includes(ticket.id);
              return (
                <tr
                  key={ticket.id}
                  onClick={() => navigate(`/tickets/${ticket.id}`)}
                  data-testid={`ticket-row-${ticket.id}`}
                  className={`group cursor-pointer transition-colors ${
                    isSelected ? 'bg-indigo-950/20' : 'hover:bg-zinc-800/50'
                  }`}
                >
                  <td className="p-3 pl-4" onClick={(e) => handleToggleSelect(ticket.id, e)}>
                    <button
                      className="text-zinc-500 hover:text-zinc-300"
                      aria-label={`Select ticket ${ticket.id}`}
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-indigo-400" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </td>
                  <td className="p-3 font-mono font-semibold text-zinc-400 group-hover:text-indigo-400 transition-colors">
                    {ticket.id}
                  </td>
                  <td className="p-3">
                    <div className="font-medium text-zinc-200 group-hover:text-white transition-colors line-clamp-1">
                      {ticket.title}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[10px] text-zinc-500 font-medium">
                        {ticket.category}
                      </span>
                      {ticket.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.2 rounded text-[10px] bg-zinc-800/80 text-zinc-400 border border-zinc-700/50"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={ticket.status} />
                  </td>
                  <td className="p-3">
                    <PriorityBadge priority={ticket.priority} />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <img
                        src={ticket.assignee.avatar}
                        alt={ticket.assignee.name}
                        className="w-5 h-5 rounded-full object-cover border border-zinc-700"
                      />
                      <span className="text-zinc-300 truncate">{ticket.assignee.name}</span>
                    </div>
                  </td>
                  <td className="p-3 pr-4 text-right">
                    <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors inline" />
                  </td>
                </tr>
              );
            })}

            {filteredTickets.length === 0 && (
              <tr>
                <td colSpan={7} className="p-12 text-center">
                  <div className="max-w-sm mx-auto space-y-2">
                    <div className="text-sm font-semibold text-zinc-300">No tickets found</div>
                    <p className="text-xs text-zinc-500">
                      No support tickets matched your current search filters.
                    </p>
                    <button
                      onClick={() => {
                        setSearch('');
                        setStatusFilter('all');
                        setPriorityFilter('all');
                      }}
                      className="mt-3 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200"
                    >
                      Clear Filters
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
