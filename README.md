# party.fun

`party.fun` is a campus-event crowdfunding and ticketing prototype. Attendees pay when they pledge. An event becomes confirmed (greenlit) when its active ticket count reaches its hype threshold; if the deadline passes below that threshold, active tickets are refunded.

The app uses a React + Vite frontend and an Express API, both backed by **Supabase** (Postgres + Auth):

- **Auth** (login, registration, session) runs directly against **Supabase Auth** from the frontend.
- **Data** (events, profiles, checkout, organiser CRUD) goes through the **Express backend**, which forwards each request's Supabase access token to Supabase. Every query therefore runs as the signed-in user, so **Row Level Security (RLS)** and the database's `SECURITY DEFINER` RPC functions enforce access. The backend never uses the service-role key.

Real payment processing is not connected yet (payment capture is simulated at pledge time).

## Run locally

Both packages run together, in separate terminals.

### 1. Backend

The backend needs a `backend/.env` (gitignored). It forwards the user's JWT to Supabase, so it uses the **anon/publishable** key — *not* the service-role key:

```
SUPABASE_URL=<your Supabase project URL>
SUPABASE_ANON_KEY=<your Supabase anon / publishable key>
```

```powershell
cd "C:\smu heap\party.fun\backend"
npm install
npm run dev
```

### 2. Frontend

The frontend talks to Supabase Auth directly, so it needs a `frontend/.env` (gitignored):

```
VITE_SUPABASE_URL=<your Supabase project URL>
VITE_SUPABASE_ANON_KEY=<your Supabase anon / publishable key>
```

Vite only reads `.env` at startup, so (re)start the dev server after creating or changing it — otherwise login fails with `supabaseUrl is required`.

```powershell
cd "C:\smu heap\party.fun\frontend"
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend health check: `http://localhost:8000/api/health`

The Vite dev server proxies `/api/*` to the backend on port `8000`. Build the frontend with:

```powershell
cd "C:\smu heap\party.fun\frontend"
npm run build
```

## Demo accounts

- User: `user@smu.edu.sg` / `user123`
- Organiser: `organiser@smu.edu.sg` / `organiser123`

These are real Supabase Auth accounts. Sessions persist, so refreshing keeps the user signed in. New signups create an `auth.users` row, and a Postgres trigger (`handle_new_user`) inserts the matching `USER` profile row.

## Current behavior

- Guests can browse events and event details.
- Users can pledge for one or more tickets.
- Payment capture is simulated immediately at pledge time.
- A user cannot buy more tickets for the same event while they still have active tickets.
- A user may give away some or all active tickets without a refund.
- Partial give-away remains in Joined Events > Upcoming.
- Full give-away moves that booking to Joined Events > Cancelled.
- After giving away all tickets, the user may buy available tickets again. The old cancelled booking remains in their history.
- Released tickets are made available at the current tier price. Once Greenlit pricing opens, pricing does not regress to Early Birds.
- Organisers cannot pledge for their own events.

## Event rules

- Pricing tiers (`PRICE_STATUSES.statusName`): `early_bird`, `greenlit`
- Event statuses (`EVENT.status`): `early_bird`, `greenlit`, `completed`, `cancelled`
- `hypeThreshold`: minimum active ticket count required to greenlight an event
- `maxCapacity`: maximum active ticket count allowed
- `activeTicketCount`, `hypePercentage`, and `spotsLeft` are derived values
- `hypePercentage = min(100, activeTicketCount / hypeThreshold * 100)`

## Database (Supabase)

Data lives in Supabase Postgres. The tables (RLS enabled):

- `USER`: profile rows, keyed to `auth.users.id` (role `user` or `organiser`)
- `EVENT`: event identity, schedule, and lifecycle status
- `EVENT_SETTINGS`: hype threshold, maximum capacity, and deadline
- `PRICE_STATUSES`: Early Birds and Greenlit prices and capacities
- `BOOKINGS`: one payment/pledge transaction
- `BOOKING_ITEMS`: quantity and price breakdown for each booking
- `TICKETS`: individual ticket lifecycle records

The business logic (pledge allocation across tiers, hype recalculation, give-away, soft delete, event CRUD) lives in Postgres **RPC functions** — `get_events`, `get_profile`, `get_quote`, `create_pledge`, `give_away_tickets`, `soft_delete_booking`, `create_event`, `update_event`, `delete_event`. These are `SECURITY DEFINER` and use `auth.uid()`, so they run safely whether called by the frontend or the backend on the user's behalf.

## Main API routes

The backend exposes the data layer. Each request must include the Supabase access token as `Authorization: Bearer <token>`; the backend validates it and forwards it to Supabase (so RLS applies).

- `GET /api/events` — public (guests allowed)
- `GET /api/events/:eventId` — public
- `GET /api/checkout/:eventId/quote?qty=1`
- `POST /api/checkout/:eventId/pledge`
- `GET /api/profile`
- `POST /api/profile/bookings/:bookingId/give-away`
- `DELETE /api/profile/bookings/:bookingId`
- `POST /api/hosted-events/events` — organiser create
- `PATCH /api/hosted-events/events/:eventId` — organiser update
- `DELETE /api/hosted-events/events/:eventId` — organiser delete

Login and registration are **not** backend routes — they go straight to Supabase Auth from the frontend. A request with no/invalid token to a protected route returns `401`.

## Current limitations

- No real Stripe payments or refunds (capture is simulated at pledge time)
- Event deadline processing and automatic refunds are not scheduled
- Authorization depends on the Supabase RLS policies; they should be audited to confirm coverage of every table
- Organiser drafts are still frontend-local (not persisted)
