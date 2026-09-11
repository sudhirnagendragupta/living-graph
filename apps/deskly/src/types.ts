export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: 'admin' | 'agent' | 'viewer';
}

export interface Comment {
  id: string;
  ticketId: string;
  author: User;
  text: string;
  createdAt: string;
  isInternal?: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  size: string;
  type: string;
  url?: string;
}

export interface Ticket {
  id: string;
  ticketNumber: number;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string;
  assignee: User;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  comments: Comment[];
  attachments: Attachment[];
}

export interface Activity {
  id: string;
  user: User;
  action: string;
  target: string;
  timestamp: string;
}

export interface ToastNotification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title?: string;
  message: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  key: string;
  createdAt: string;
  lastUsed: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Support Agent' | 'Billing Lead';
  status: 'active' | 'invited';
}
