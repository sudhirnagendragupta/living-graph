import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  Ticket,
  TicketStatus,
  User,
  Activity,
  ApiKey,
  TeamMember,
  ToastNotification,
  Attachment,
} from '../types';
import {
  initialTickets,
  initialActivities,
  initialApiKeys,
  initialTeamMembers,
  currentUser,
  sampleUsers,
} from '../fixtures/initialData';

interface DesklyContextType {
  tickets: Ticket[];
  activities: Activity[];
  apiKeys: ApiKey[];
  teamMembers: TeamMember[];
  toasts: ToastNotification[];
  isAuthenticated: boolean;
  currentUser: User;
  
  // Actions
  login: (email?: string) => Promise<boolean>;
  logout: () => void;
  createTicket: (data: {
    title: string;
    description: string;
    priority: Ticket['priority'];
    category: string;
    tags?: string[];
    attachments?: Attachment[];
  }) => Promise<Ticket>;
  updateTicketStatus: (id: string, status: TicketStatus) => Promise<void>;
  bulkUpdateStatus: (ids: string[], status: TicketStatus) => Promise<void>;
  deleteTicket: (id: string) => Promise<void>;
  addComment: (ticketId: string, text: string, isInternal?: boolean) => Promise<void>;
  addTag: (ticketId: string, tag: string) => Promise<void>;
  removeTag: (ticketId: string, tag: string) => Promise<void>;
  inviteTeamMember: (name: string, email: string, role: TeamMember['role']) => Promise<void>;
  regenerateApiKey: (id: string) => Promise<string>;
  addToast: (toast: Omit<ToastNotification, 'id'>) => void;
  removeToast: (id: string) => void;
  resetStore: () => void;
}

const DesklyContext = createContext<DesklyContextType | null>(null);

// Synthetic delay helper (150ms-250ms) to ensure video recording captures real state transitions smoothly
const delay = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));

export const DesklyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tickets, setTickets] = useState<Ticket[]>(() => {
    const saved = localStorage.getItem('deskly_tickets');
    return saved ? JSON.parse(saved) : initialTickets;
  });

  const [activities, setActivities] = useState<Activity[]>(initialActivities);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(initialApiKeys);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(initialTeamMembers);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return localStorage.getItem('deskly_auth') === 'true';
  });

  // Sync tickets with localStorage
  useEffect(() => {
    localStorage.setItem('deskly_tickets', JSON.stringify(tickets));
  }, [tickets]);

  const addToast = (toast: Omit<ToastNotification, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newToast: ToastNotification = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);

    setTimeout(() => {
      removeToast(id);
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const login = async (email = 'sudhir@deskly.dev') => {
    await delay(200);
    setIsAuthenticated(true);
    localStorage.setItem('deskly_auth', 'true');
    addToast({
      type: 'success',
      title: 'Signed In',
      message: `Welcome back, ${email}`,
    });
    return true;
  };

  const logout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('deskly_auth');
    addToast({
      type: 'info',
      title: 'Signed Out',
      message: 'You have been signed out of Deskly.',
    });
  };

  const createTicket = async (data: {
    title: string;
    description: string;
    priority: Ticket['priority'];
    category: string;
    tags?: string[];
    attachments?: Attachment[];
  }): Promise<Ticket> => {
    await delay(250);
    const newNumber = tickets.length > 0 ? Math.max(...tickets.map((t) => t.ticketNumber)) + 1 : 101;
    const newTicket: Ticket = {
      id: `TCK-${newNumber}`,
      ticketNumber: newNumber,
      title: data.title,
      description: data.description,
      status: 'open',
      priority: data.priority,
      category: data.category || 'General',
      assignee: sampleUsers[Math.floor(Math.random() * sampleUsers.length)],
      tags: data.tags && data.tags.length > 0 ? data.tags : ['New'],
      createdAt: 'Just now',
      updatedAt: 'Just now',
      comments: [],
      attachments: data.attachments || [],
    };

    setTickets((prev) => [newTicket, ...prev]);

    setActivities((prev) => [
      {
        id: `act-${Date.now()}`,
        user: currentUser,
        action: 'created ticket',
        target: newTicket.id,
        timestamp: 'Just now',
      },
      ...prev,
    ]);

    addToast({
      type: 'success',
      title: 'Ticket Created',
      message: `${newTicket.id}: ${newTicket.title.substring(0, 32)}...`,
    });

    return newTicket;
  };

  const updateTicketStatus = async (id: string, status: TicketStatus) => {
    await delay(180);
    setTickets((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status, updatedAt: 'Just now' } : t))
    );

    setActivities((prev) => [
      {
        id: `act-${Date.now()}`,
        user: currentUser,
        action: `updated status to ${status} for`,
        target: id,
        timestamp: 'Just now',
      },
      ...prev,
    ]);

    addToast({
      type: 'info',
      title: 'Status Updated',
      message: `Ticket ${id} is now ${status.replace('_', ' ')}.`,
    });
  };

  const bulkUpdateStatus = async (ids: string[], status: TicketStatus) => {
    await delay(200);
    setTickets((prev) =>
      prev.map((t) => (ids.includes(t.id) ? { ...t, status, updatedAt: 'Just now' } : t))
    );

    addToast({
      type: 'success',
      title: 'Bulk Update Completed',
      message: `Updated ${ids.length} tickets to ${status.replace('_', ' ')}.`,
    });
  };

  const deleteTicket = async (id: string) => {
    await delay(200);
    setTickets((prev) => prev.filter((t) => t.id !== id));
    addToast({
      type: 'info',
      title: 'Ticket Deleted',
      message: `Ticket ${id} has been permanently removed.`,
    });
  };

  const addComment = async (ticketId: string, text: string, isInternal = false) => {
    await delay(180);
    const newComment = {
      id: `c-${Date.now()}`,
      ticketId,
      author: currentUser,
      text,
      createdAt: 'Just now',
      isInternal,
    };

    setTickets((prev) =>
      prev.map((t) =>
        t.id === ticketId
          ? { ...t, comments: [...t.comments, newComment], updatedAt: 'Just now' }
          : t
      )
    );

    addToast({
      type: 'success',
      title: isInternal ? 'Internal Note Added' : 'Reply Posted',
      message: `Added to ${ticketId}.`,
    });
  };

  const addTag = async (ticketId: string, tag: string) => {
    await delay(100);
    setTickets((prev) =>
      prev.map((t) =>
        t.id === ticketId && !t.tags.includes(tag) ? { ...t, tags: [...t.tags, tag] } : t
      )
    );
  };

  const removeTag = async (ticketId: string, tag: string) => {
    await delay(100);
    setTickets((prev) =>
      prev.map((t) =>
        t.id === ticketId ? { ...t, tags: t.tags.filter((item) => item !== tag) } : t
      )
    );
  };

  const inviteTeamMember = async (name: string, email: string, role: TeamMember['role']) => {
    await delay(200);
    const newMember: TeamMember = {
      id: `tm-${Date.now()}`,
      name,
      email,
      role,
      status: 'invited',
    };
    setTeamMembers((prev) => [...prev, newMember]);
    addToast({
      type: 'success',
      title: 'Invitation Sent',
      message: `Invite dispatched to ${email}`,
    });
  };

  const regenerateApiKey = async (id: string): Promise<string> => {
    await delay(250);
    const randomHex = Array.from({ length: 26 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
    const newKey = `dsk_live_${randomHex}`;

    setApiKeys((prev) =>
      prev.map((k) => (k.id === id ? { ...k, key: newKey, lastUsed: 'Just now' } : k))
    );

    addToast({
      type: 'success',
      title: 'API Key Regenerated',
      message: 'New key generated and active.',
    });

    return newKey;
  };

  const resetStore = () => {
    localStorage.removeItem('deskly_tickets');
    localStorage.removeItem('deskly_auth');
    setTickets(initialTickets);
    setActivities(initialActivities);
    setApiKeys(initialApiKeys);
    setTeamMembers(initialTeamMembers);
    setToasts([]);
    setIsAuthenticated(true);
    addToast({
      type: 'info',
      title: 'State Reset',
      message: 'Restored initial fixture data.',
    });
  };

  // Expose reset to window for Playwright automation tests
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as unknown as { __RESET_DESKLY_STATE__: () => void }).__RESET_DESKLY_STATE__ = resetStore;
      (window as unknown as { __DESKLY_TICKETS__: Ticket[] }).__DESKLY_TICKETS__ = tickets;
    }
  }, [tickets]);

  return (
    <DesklyContext.Provider
      value={{
        tickets,
        activities,
        apiKeys,
        teamMembers,
        toasts,
        isAuthenticated,
        currentUser,
        login,
        logout,
        createTicket,
        updateTicketStatus,
        bulkUpdateStatus,
        deleteTicket,
        addComment,
        addTag,
        removeTag,
        inviteTeamMember,
        regenerateApiKey,
        addToast,
        removeToast,
        resetStore,
      }}
    >
      {children}
    </DesklyContext.Provider>
  );
};

export const useDeskly = () => {
  const context = useContext(DesklyContext);
  if (!context) {
    throw new Error('useDeskly must be used within a DesklyProvider');
  }
  return context;
};
