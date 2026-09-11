import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDeskly } from '../store/desklyStore';
import { TicketStatus } from '../types';
import { PriorityBadge } from '../components/StatusBadge';
import { isV2 } from '../config';
import {
  ArrowLeft,
  Trash2,
  Paperclip,
  Send,
  Lock,
  Plus,
  X,
  Clock,
  UserCheck,
  CheckCircle2,
} from 'lucide-react';

export const TicketDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tickets, updateTicketStatus, deleteTicket, addComment, addTag, removeTag } = useDeskly();

  const ticket = tickets.find((t) => t.id === id);

  const [newCommentText, setNewCommentText] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [newTagText, setNewTagText] = useState('');
  const [showAddTag, setShowAddTag] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  if (!ticket) {
    return (
      <div className="p-8 text-center space-y-4">
        <h2 className="text-lg font-bold text-zinc-100">Ticket Not Found</h2>
        <p className="text-xs text-zinc-400">The requested ticket {id} does not exist.</p>
        <button
          onClick={() => navigate('/tickets')}
          className="px-4 py-2 rounded-lg bg-zinc-800 text-xs text-zinc-200"
        >
          Return to Tickets
        </button>
      </div>
    );
  }

  const handleStatusChange = async (newStatus: TicketStatus) => {
    await updateTicketStatus(ticket.id, newStatus);
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim()) return;

    setIsSubmittingComment(true);
    await addComment(ticket.id, newCommentText.trim(), isInternal);
    setNewCommentText('');
    setIsSubmittingComment(false);
  };

  const handleAddTagSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagText.trim()) return;
    await addTag(ticket.id, newTagText.trim());
    setNewTagText('');
    setShowAddTag(false);
  };

  const handleDelete = async () => {
    await deleteTicket(ticket.id);
    setShowDeleteModal(false);
    navigate('/tickets');
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Top Navigation / Breadcrumbs */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/tickets')}
            data-testid="ticket-detail-back-btn"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-indigo-400">{ticket.id}</span>
            <span className="text-zinc-600">/</span>
            <span className="text-xs text-zinc-400">{ticket.category}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowDeleteModal(true)}
            data-testid="delete-ticket-btn"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 text-xs font-medium transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {/* Main Layout: 2 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Content & Comments */}
        <div className="lg:col-span-2 space-y-6">
          {/* Ticket Body */}
          <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-4 shadow-sm">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <PriorityBadge priority={ticket.priority} />
                <span className="text-[11px] text-zinc-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Created {ticket.createdAt}
                </span>
              </div>
              <h1 className="text-xl font-bold text-zinc-100 leading-snug">{ticket.title}</h1>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {ticket.description}
            </p>

            {/* Attachments Section */}
            {ticket.attachments && ticket.attachments.length > 0 && (
              <div className="pt-4 border-t border-zinc-800">
                <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5" />
                  <span>Attachments ({ticket.attachments.length})</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {ticket.attachments.map((att) => (
                    <div
                      key={att.id}
                      className="flex items-center gap-2 p-2 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-300"
                    >
                      <Paperclip className="w-3 h-3 text-indigo-400" />
                      <span className="font-medium">{att.name}</span>
                      <span className="text-[10px] text-zinc-500">{att.size}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Comments Section */}
          <div className="p-6 rounded-2xl bg-zinc-900/30 border border-zinc-800 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-200">
              Activity & Comments ({ticket.comments.length})
            </h2>

            {/* Existing Comments */}
            <div className="space-y-3">
              {ticket.comments.map((comment) => (
                <div
                  key={comment.id}
                  className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                    comment.isInternal
                      ? 'bg-amber-950/20 border-amber-500/30 text-amber-200'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-300'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <img
                        src={comment.author.avatar}
                        alt={comment.author.name}
                        className="w-4 h-4 rounded-full object-cover"
                      />
                      <span className="font-semibold text-zinc-200">{comment.author.name}</span>
                      {comment.isInternal && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          Internal Note
                        </span>
                      )}
                    </div>
                    <span className="text-zinc-500">{comment.createdAt}</span>
                  </div>
                  <p className="leading-relaxed whitespace-pre-wrap">{comment.text}</p>
                </div>
              ))}

              {ticket.comments.length === 0 && (
                <div className="text-center py-6 text-xs text-zinc-500">
                  No comments yet. Post the first update below.
                </div>
              )}
            </div>

            {/* New Comment Box */}
            <form onSubmit={handleCommentSubmit} className="pt-3 border-t border-zinc-800 space-y-3">
              <div className="relative">
                <textarea
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  placeholder={
                    isInternal
                      ? 'Write a private internal note (visible only to agents)...'
                      : 'Reply to customer or post a public update...'
                  }
                  rows={3}
                  data-testid="ticket-comment-input"
                  className={`w-full rounded-xl p-3 text-xs focus:outline-none transition-colors ${
                    isInternal
                      ? 'bg-amber-950/10 border border-amber-500/30 text-amber-200 placeholder-amber-500/40 focus:border-amber-500'
                      : 'bg-zinc-950 border border-zinc-800 text-zinc-200 placeholder-zinc-500 focus:border-indigo-500'
                  }`}
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none text-zinc-400 hover:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={(e) => setIsInternal(e.target.checked)}
                    className="rounded bg-zinc-900 border-zinc-700 text-amber-500 focus:ring-amber-500"
                  />
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Internal Note</span>
                </label>

                <button
                  type="submit"
                  disabled={isSubmittingComment || !newCommentText.trim()}
                  data-testid="ticket-comment-submit-btn"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                >
                  <Send className="w-3 h-3" />
                  <span>Post Update</span>
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right 1 Col: Metadata & Controls */}
        <div className="space-y-4">
          {/* Status Control Card (Redesign Center of Gravity) */}
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-3">
            <label className="block text-xs font-semibold text-zinc-300">Ticket Status</label>

            {!isV2() ? (
              /* v1 Baseline: Standard <select> Dropdown */
              <div>
                <select
                  value={ticket.status}
                  onChange={(e) => handleStatusChange(e.target.value as TicketStatus)}
                  data-testid="ticket-status-dropdown"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-2 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
                <div className="text-[10px] text-zinc-500 mt-1">v1 control: standard dropdown</div>
              </div>
            ) : (
              /* v2 Redesign: Segmented Button Control */
              <div>
                <div
                  data-testid="ticket-status-segmented-control"
                  className="grid grid-cols-2 gap-1.5 p-1 bg-zinc-950 rounded-xl border border-zinc-800"
                >
                  {(['open', 'in_progress', 'resolved', 'closed'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => handleStatusChange(st)}
                      data-testid={`segmented-status-${st}`}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
                        ticket.status === st
                          ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                      }`}
                    >
                      {st.replace('_', ' ')}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-indigo-400 mt-1.5 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>v2 redesign: segmented button bar</span>
                </div>
              </div>
            )}
          </div>

          {/* Assignee & Properties Card */}
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-3 text-xs">
            <div className="text-xs font-semibold text-zinc-300 pb-2 border-b border-zinc-800">
              Properties
            </div>

            <div>
              <span className="text-zinc-500 block mb-1">Assignee</span>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-950 border border-zinc-800/80">
                <img
                  src={ticket.assignee.avatar}
                  alt={ticket.assignee.name}
                  className="w-5 h-5 rounded-full object-cover"
                />
                <span className="text-zinc-200 font-medium">{ticket.assignee.name}</span>
                <UserCheck className="w-3.5 h-3.5 text-emerald-400 ml-auto" />
              </div>
            </div>

            <div>
              <span className="text-zinc-500 block mb-1">Tags</span>
              <div className="flex flex-wrap gap-1.5">
                {ticket.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-zinc-800 text-zinc-300 border border-zinc-700/60"
                  >
                    #{tag}
                    <button
                      onClick={() => removeTag(ticket.id, tag)}
                      className="hover:text-rose-400 transition-colors"
                      aria-label={`Remove tag ${tag}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}

                {showAddTag ? (
                  <form onSubmit={handleAddTagSubmit} className="inline-flex items-center gap-1">
                    <input
                      type="text"
                      value={newTagText}
                      onChange={(e) => setNewTagText(e.target.value)}
                      placeholder="tag"
                      autoFocus
                      className="w-16 bg-zinc-950 border border-indigo-500 rounded px-1.5 py-0.5 text-[11px] text-zinc-100 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAddTag(false)}
                      className="text-zinc-500 hover:text-zinc-300"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => setShowAddTag(true)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-zinc-900 border border-dashed border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
                  >
                    <Plus className="w-3 h-3" /> Add Tag
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-zinc-100">Permanently Delete Ticket?</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              This action cannot be undone. Ticket <strong className="text-zinc-200">{ticket.id}</strong>{' '}
              and all associated activity, files, and comments will be permanently erased.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                data-testid="confirm-delete-btn"
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white shadow-sm"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
