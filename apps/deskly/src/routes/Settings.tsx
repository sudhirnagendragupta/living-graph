import React, { useState } from 'react';
import { useDeskly } from '../store/desklyStore';
import { isV2 } from '../config';
import { TeamMember } from '../types';
import {
  User,
  Bell,
  Users,
  Key,
  Copy,
  RotateCw,
  Plus,
  Check,
  X,
} from 'lucide-react';

export const Settings: React.FC = () => {
  const {
    currentUser,
    teamMembers,
    apiKeys,
    inviteTeamMember,
    regenerateApiKey,
    addToast,
  } = useDeskly();

  // v1 tab order: Profile -> Notifications -> Team -> API Keys
  // v2 tab order: Profile -> Team -> API Keys -> Notifications
  const tabs = isV2()
    ? [
        { id: 'profile', label: 'Profile', icon: User },
        { id: 'team', label: 'Team Members', icon: Users },
        { id: 'api_keys', label: 'API Keys', icon: Key },
        { id: 'notifications', label: 'Notifications', icon: Bell },
      ]
    : [
        { id: 'profile', label: 'Profile', icon: User },
        { id: 'notifications', label: 'Notifications', icon: Bell },
        { id: 'team', label: 'Team Members', icon: Users },
        { id: 'api_keys', label: 'API Keys', icon: Key },
      ];

  const [activeTab, setActiveTab] = useState<string>('profile');

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamMember['role']>('Support Agent');

  // Notification toggles
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [slackAlerts, setSlackAlerts] = useState(false);
  const [p0Escalation, setP0Escalation] = useState(true);

  // Copied state
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  const handleCopyKey = (key: string, id: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKeyId(id);
    addToast({
      type: 'success',
      title: 'Copied to Clipboard',
      message: 'API token copied.',
    });
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName.trim() || !inviteEmail.trim()) {
      addToast({ type: 'warning', message: 'Name and email are required.' });
      return;
    }
    await inviteTeamMember(inviteName.trim(), inviteEmail.trim(), inviteRole);
    setInviteName('');
    setInviteEmail('');
    setShowInviteModal(false);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="pb-2 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100 tracking-tight">Workspace Settings</h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          Configure security, team access, webhook tokens, and alert preferences
        </p>
      </div>

      {/* Tabs (Order differs based on v1 vs v2) */}
      <div className="flex items-center gap-1 border-b border-zinc-800 pb-px overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`settings-tab-${tab.id}`}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${
                isActive
                  ? 'border-indigo-500 text-indigo-400 font-semibold bg-indigo-500/5'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 shadow-sm">
        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div className="space-y-6 max-w-xl animate-in fade-in duration-150 text-xs">
            <h2 className="text-sm font-semibold text-zinc-100">Personal Profile</h2>

            <div className="flex items-center gap-4">
              <img
                src={currentUser.avatar}
                alt={currentUser.name}
                className="w-14 h-14 rounded-full object-cover border border-zinc-700"
              />
              <div>
                <div className="font-semibold text-sm text-zinc-200">{currentUser.name}</div>
                <div className="text-zinc-500">{currentUser.email}</div>
                <span className="inline-block mt-1 px-2 py-0.2 rounded text-[10px] uppercase font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {currentUser.role}
                </span>
              </div>
            </div>

            <div className="space-y-3 pt-4 border-t border-zinc-800">
              <div>
                <label className="block font-medium text-zinc-400 mb-1">Display Name</label>
                <input
                  type="text"
                  defaultValue={currentUser.name}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block font-medium text-zinc-400 mb-1">Email Address</label>
                <input
                  type="email"
                  defaultValue={currentUser.email}
                  disabled
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-500 cursor-not-allowed"
                />
              </div>
            </div>
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <div className="space-y-6 max-w-xl animate-in fade-in duration-150 text-xs">
            <h2 className="text-sm font-semibold text-zinc-100">Notification Preferences</h2>

            <div className="space-y-4">
              <label className="flex items-start gap-3 p-3 rounded-xl bg-zinc-950 border border-zinc-800/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={emailAlerts}
                  onChange={(e) => setEmailAlerts(e.target.checked)}
                  data-testid="toggle-email-alerts"
                  className="mt-0.5 rounded bg-zinc-900 border-zinc-700 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <div className="font-semibold text-zinc-200">Email Digest & Ticket Assigns</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    Receive immediate notifications when a ticket is assigned to you.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-xl bg-zinc-950 border border-zinc-800/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={p0Escalation}
                  onChange={(e) => setP0Escalation(e.target.checked)}
                  data-testid="toggle-p0-alerts"
                  className="mt-0.5 rounded bg-zinc-900 border-zinc-700 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <div className="font-semibold text-zinc-200">Urgent P0 Escalation Pager</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    Broadcast critical SLA threats to incident responder channels.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-xl bg-zinc-950 border border-zinc-800/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={slackAlerts}
                  onChange={(e) => setSlackAlerts(e.target.checked)}
                  className="mt-0.5 rounded bg-zinc-900 border-zinc-700 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <div className="font-semibold text-zinc-200">Slack Webhook Sync</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    Mirror support replies to internal channel #support-desk.
                  </div>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Team Members Tab */}
        {activeTab === 'team' && (
          <div className="space-y-4 animate-in fade-in duration-150 text-xs">
            <div className="flex items-center justify-between pb-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Team Roster</h2>
                <p className="text-[11px] text-zinc-500">Authorized support agents and managers</p>
              </div>
              <button
                onClick={() => setShowInviteModal(true)}
                data-testid="invite-member-btn"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-all"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Invite Teammate</span>
              </button>
            </div>

            <div className="rounded-xl border border-zinc-800 overflow-hidden bg-zinc-950/60">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/60 text-zinc-400 font-medium">
                    <th className="p-3 pl-4">Member</th>
                    <th className="p-3">Role</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {teamMembers.map((member) => (
                    <tr key={member.id} className="hover:bg-zinc-900/40">
                      <td className="p-3 pl-4">
                        <div className="font-medium text-zinc-200">{member.name}</div>
                        <div className="text-[11px] text-zinc-500">{member.email}</div>
                      </td>
                      <td className="p-3 text-zinc-300 font-mono text-[11px]">{member.role}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${
                            member.status === 'active'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}
                        >
                          {member.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* API Keys Tab */}
        {activeTab === 'api_keys' && (
          <div className="space-y-4 animate-in fade-in duration-150 text-xs">
            <div className="flex items-center justify-between pb-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">API Access Tokens</h2>
                <p className="text-[11px] text-zinc-500">
                  Tokens used for webhook ingestion, SDK clients, and CLI runners
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {apiKeys.map((k) => (
                <div
                  key={k.id}
                  className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Key className="w-4 h-4 text-indigo-400" />
                      <span className="font-semibold text-zinc-200">{k.name}</span>
                    </div>
                    <span className="text-[10px] text-zinc-500">Last used {k.lastUsed}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-zinc-900 border border-zinc-800/80 rounded-lg px-3 py-1.5 font-mono text-[11px] text-zinc-300 select-all overflow-hidden text-ellipsis">
                      {k.key}
                    </code>
                    <button
                      onClick={() => handleCopyKey(k.key, k.id)}
                      data-testid={`copy-key-btn-${k.id}`}
                      className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                      title="Copy Key"
                    >
                      {copiedKeyId === k.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => regenerateApiKey(k.id)}
                      data-testid={`regenerate-key-btn-${k.id}`}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                      title="Regenerate Key"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>Regenerate</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Invite Team Member Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-zinc-100">Invite New Teammate</h3>
              <button
                onClick={() => setShowInviteModal(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleInviteSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-zinc-400 mb-1">Full Name</label>
                <input
                  type="text"
                  data-testid="invite-name-input"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="e.g. Rachel Green"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block font-medium text-zinc-400 mb-1">Email Address</label>
                <input
                  type="email"
                  data-testid="invite-email-input"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="rachel@deskly.dev"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block font-medium text-zinc-400 mb-1">Role Permission</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as any)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="Support Agent">Support Agent</option>
                  <option value="Admin">Admin</option>
                  <option value="Billing Lead">Billing Lead</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="invite-submit-btn"
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-sm"
                >
                  Send Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
