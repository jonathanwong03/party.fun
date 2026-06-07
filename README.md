# party.fun

`party.fun` is a campus-event crowdfunding and ticketing prototype. Attendees pay when they pledge. An event becomes confirmed when its active ticket count reaches its hype threshold; if the deadline passes below that threshold, active tickets are refunded.

The current app uses a React + Vite frontend and an Express in-memory API. Supabase and real payment processing are not connected yet.

## Run locally

Run the two packages in separate terminals:

```powershell
cd "C:\smu heap\party.fun\backend"
npm install
npm run dev
```

```powershell
cd "C:\smu heap\party.fun\frontend"
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend health check: `http://localhost:8000/api/health`

Build the frontend with:

```powershell
cd "C:\smu heap\party.fun\frontend"
npm run build
```

## Demo accounts

- User: `jamie@u.nus.edu` / `user123`
- Organiser: `organiser@smu.edu.sg` / `organiser123`

Passwords are verified against bcrypt hashes in `backend/data/mockUsers.js`. Sessions are not implemented, so refreshing signs the user out.

## Current behavior

- Guests can browse events and event details.
- Users can pledge for one or more tickets.
- Payment capture is simulated immediately at pledge time.
- A user cannot buy more tickets for the same event while they still have active tickets.
- A user may give away some or all active tickets without a refund.
- Partial give-away remains in Joined Events > Upcoming.
- Full give-away moves that booking to Joined Events > Cancelled.
- After giving away all tickets, the user may buy available tickets again. The old cancelled booking remains in their history.
- Released tickets are made available at the current tier price. Once Main Crowd opens, pricing does not regress to Early Birds.
- Organisers cannot pledge for their own events.

## Event rules

- Pricing tiers: `early_bird`, `main_crowd`
- Event statuses: `pending`, `greenlit`, `cancelled`, `completed`
- `hypeThreshold`: minimum active ticket count required to confirm an event
- `maxCapacity`: maximum active ticket count allowed
- `activeTicketCount`, `hypePercentage`, and `spotsLeft` are derived values
- `hypePercentage = min(100, activeTicketCount / hypeThreshold * 100)`

## Mock relational data

The files under `backend/data` mirror the intended database tables:

- `mockUsers.js`: accounts and bcrypt password hashes
- `mockEvents.js`: event identity, schedule, lifecycle status, and current pricing tier
- `mockEventSettings.js`: hype threshold, maximum capacity, and deadline
- `mockPriceTiers.js`: Early Birds and Main Crowd prices and capacities
- `mockBookings.js`: one payment/pledge transaction
- `mockBookingItems.js`: quantity and price breakdown for each booking
- `mockTickets.js`: individual ticket lifecycle records
- `mockEventDrafts.js`: organiser draft records

The Express API derives the public event summary from these relational fixtures. It does not read `schema.sql` or `seed.sql`.

## Main API routes

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/events`
- `GET /api/events/:eventId`
- `GET /api/checkout/:eventId/quote?qty=1`
- `POST /api/checkout/:eventId/pledge`
- `GET /api/profile`
- `POST /api/profile/bookings/:bookingId/give-away`

Authenticated prototype requests use `X-Mock-Role` and `X-Mock-User-Id` headers. This is temporary and must be replaced by real server-side sessions or Supabase Auth.

## Current limitations

- No persistent database
- No real Stripe payments or refunds
- No real sessions or authorization enforcement
- Organiser create, edit, delete, and drafts remain frontend-local
- Event deadline processing and automatic refunds are not scheduled
- Mock data resets when the backend restarts
