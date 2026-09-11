import { User, Ticket, Activity, ApiKey, TeamMember } from '../types';

export const currentUser: User = {
  id: 'usr-1',
  name: 'Sudhir Gupta',
  email: 'sudhir@deskly.dev',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
  role: 'admin',
};

export const sampleUsers: User[] = [
  currentUser,
  {
    id: 'usr-2',
    name: 'Elena Rostova',
    email: 'elena@deskly.dev',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80',
    role: 'agent',
  },
  {
    id: 'usr-3',
    name: 'Marcus Vance',
    email: 'marcus@deskly.dev',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80',
    role: 'agent',
  },
  {
    id: 'usr-4',
    name: 'Aisha Patel',
    email: 'aisha@deskly.dev',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&auto=format&fit=crop&q=80',
    role: 'viewer',
  },
];

export const initialTickets: Ticket[] = [
  {
    id: 'TCK-101',
    ticketNumber: 101,
    title: 'OAuth 2.0 callback fails with invalid redirect URI',
    description: 'When logging in via GitHub OAuth on production domains, the callback redirects to an unconfigured port, resulting in HTTP 400 Bad Request.',
    status: 'open',
    priority: 'urgent',
    category: 'Authentication',
    assignee: sampleUsers[1],
    tags: ['Auth', 'Bug', 'P0'],
    createdAt: '12 minutes ago',
    updatedAt: '5 minutes ago',
    comments: [
      {
        id: 'c-1',
        ticketId: 'TCK-101',
        author: sampleUsers[1],
        text: 'Reproduced in staging. Checking environment variable callback URLs in Cloud Secret Manager.',
        createdAt: '10 minutes ago',
        isInternal: true,
      },
    ],
    attachments: [
      { id: 'att-1', name: 'oauth-error-trace.png', size: '240 KB', type: 'image/png' },
    ],
  },
  {
    id: 'TCK-102',
    ticketNumber: 102,
    title: 'Billing statement displays incorrect prorated credits',
    description: 'Enterprise accounts switching from annual to monthly billing show negative prorated amounts on invoices.',
    status: 'in_progress',
    priority: 'high',
    category: 'Billing',
    assignee: sampleUsers[2],
    tags: ['Billing', 'Stripe'],
    createdAt: '2 hours ago',
    updatedAt: '45 minutes ago',
    comments: [],
    attachments: [],
  },
  {
    id: 'TCK-103',
    ticketNumber: 103,
    title: 'Add webhook signature validation for inbound webhooks',
    description: 'Security team requested HMAC-SHA256 signature headers on all outbound webhook payloads to prevent spoofing.',
    status: 'open',
    priority: 'medium',
    category: 'Security',
    assignee: sampleUsers[0],
    tags: ['Feature', 'Webhooks'],
    createdAt: 'Yesterday',
    updatedAt: 'Yesterday',
    comments: [],
    attachments: [],
  },
  {
    id: 'TCK-104',
    ticketNumber: 104,
    title: 'Dark mode contrast issue on ticket table headers',
    description: 'In dark mode, the column sort headers have insufficient contrast ratio against the zinc-900 background.',
    status: 'resolved',
    priority: 'low',
    category: 'UI/UX',
    assignee: sampleUsers[1],
    tags: ['Design', 'Accessibility'],
    createdAt: '3 days ago',
    updatedAt: '1 day ago',
    comments: [
      {
        id: 'c-2',
        ticketId: 'TCK-104',
        author: sampleUsers[1],
        text: 'Bumped header color to zinc-400 and verified a11y contrast ratio is 4.8:1.',
        createdAt: '1 day ago',
      },
    ],
    attachments: [],
  },
  {
    id: 'TCK-105',
    ticketNumber: 105,
    title: 'Rate limiter returns 500 instead of 429 during Redis timeout',
    description: 'If the Redis cache is temporarily unreachable, the gateway throws unhandled exception instead of graceful rate limit fallback.',
    status: 'in_progress',
    priority: 'high',
    category: 'Infrastructure',
    assignee: sampleUsers[0],
    tags: ['Reliability', 'Redis'],
    createdAt: '4 days ago',
    updatedAt: '2 hours ago',
    comments: [],
    attachments: [],
  },
];

export const initialActivities: Activity[] = [
  {
    id: 'act-1',
    user: sampleUsers[1],
    action: 'updated status of',
    target: 'TCK-101 to Open',
    timestamp: '5m ago',
  },
  {
    id: 'act-2',
    user: sampleUsers[2],
    action: 'assigned',
    target: 'TCK-102 to self',
    timestamp: '45m ago',
  },
  {
    id: 'act-3',
    user: currentUser,
    action: 'created new ticket',
    target: 'TCK-103 Webhooks',
    timestamp: 'Yesterday',
  },
];

export const initialApiKeys: ApiKey[] = [
  {
    id: 'key-1',
    name: 'Production Ingestion Key',
    prefix: 'dsk_live_',
    key: 'dsk_live_9f83a0e7b8c24d1a9321e0fc4a',
    createdAt: '2026-08-15',
    lastUsed: '4 minutes ago',
  },
  {
    id: 'key-2',
    name: 'Staging CI/CD Runner',
    prefix: 'dsk_test_',
    key: 'dsk_test_1c4b7890ef2345aa882310de77',
    createdAt: '2026-08-28',
    lastUsed: 'Yesterday',
  },
];

export const initialTeamMembers: TeamMember[] = [
  {
    id: 'tm-1',
    name: 'Sudhir Gupta',
    email: 'sudhir@deskly.dev',
    role: 'Admin',
    status: 'active',
  },
  {
    id: 'tm-2',
    name: 'Elena Rostova',
    email: 'elena@deskly.dev',
    role: 'Support Agent',
    status: 'active',
  },
  {
    id: 'tm-3',
    name: 'Marcus Vance',
    email: 'marcus@deskly.dev',
    role: 'Support Agent',
    status: 'active',
  },
  {
    id: 'tm-4',
    name: 'Jordan Belfort',
    email: 'jordan@deskly.dev',
    role: 'Billing Lead',
    status: 'invited',
  },
];
