export const DEFAULT_MOCK_USER_ID = 'mock-user-jamie';

export const initialPledges = [
  {
    id: 'p1',
    userId: DEFAULT_MOCK_USER_ID,
    eventId: 'e1',
    qty: 1,
    amount: 18,
    tab: 'upcoming',
    ticketStatus: 'Pledged',
    active: true,
  },
  {
    id: 'p2',
    userId: DEFAULT_MOCK_USER_ID,
    eventId: 'e2',
    qty: 2,
    amount: 20,
    tab: 'upcoming',
    ticketStatus: 'Pledged',
    active: true,
  },
  {
    id: 'p3',
    userId: DEFAULT_MOCK_USER_ID,
    eventId: 'e3',
    qty: 1,
    amount: 28,
    tab: 'past',
    ticketStatus: 'Attended',
    active: true,
  },
  {
    id: 'p4',
    userId: DEFAULT_MOCK_USER_ID,
    eventId: 'e6',
    qty: 1,
    amount: 8,
    tab: 'cancelled',
    ticketStatus: 'Refunded',
    active: false,
  },
];
