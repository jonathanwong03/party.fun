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

### Email notifications (Resend)

Transactional emails (account created, pledge confirmed, tickets given away, event cancelled / missed-threshold, organiser event created) are sent via [Resend](https://resend.com). Add to `backend/.env`:

```
RESEND_API_KEY=re_...                         # from resend.com → API Keys
NOTIFICATION_FROM_EMAIL=onboarding@resend.dev # or an address on your verified Resend domain
NOTIFICATION_OVERRIDE_EMAIL=you@example.com   # dev: redirect ALL emails here (see below)
APP_BASE_URL=http://localhost:5173            # where the email buttons link (set to your deployed URL in prod)
```

With the key set, **real emails are sent**. During development, set `NOTIFICATION_OVERRIDE_EMAIL` so every email — even those addressed to mock/fake user addresses — is redirected to a real inbox you control. It accepts **one address or a comma-separated list**, e.g. `NOTIFICATION_OVERRIDE_EMAIL=alice@example.com,bob@example.com`.

Notes:
- On Resend's free tier **without a verified domain**, you can only send from `onboarding@resend.dev` **to your own Resend account email** — so the override should be (or include) that address. To send to arbitrary recipients or multiple real inboxes, verify a domain in Resend and set `NOTIFICATION_FROM_EMAIL` to an address on it.
- If `RESEND_API_KEY` is left unset, the backend automatically falls back to a console "mock" mode (prints each email instead of sending) so the app still runs without credentials.

#### When emails are sent

Each email greets the recipient as `Hi <username> (User|Organiser),` so you can tell whose account received it in a shared demo inbox.

| Action that triggers it | Who receives the email |
|---|---|
| A new account is created (user or organiser) | the new account holder |
| You pledge / buy tickets for an event | you (the buyer) |
| You give away tickets (some or all) | you (different wording when you give away **all** — you can no longer attend) |
| An organiser **creates** an event | the organiser |
| An organiser **cancels** an event | every backer (full-refund notice) **and** the organiser |
| An event **misses its hype threshold by the deadline** | every backer (full-refund notice) **and** the organiser — sent automatically by the scheduler |
| You request a password reset | the account's email — the 6-digit code |

In development, with `NOTIFICATION_OVERRIDE_EMAIL` set, **all** of these are redirected to that one inbox regardless of who they're addressed to (so you'll receive every email yourself). Without a `RESEND_API_KEY`, they're printed to the backend console instead. Note: the "deadline missed" email only fires while the backend is running (the scheduler checks on an interval).

### Password reset (custom OTP via Resend)

"Forgot password" uses a custom one-time code, **not** Supabase's built-in recovery, so the code is emailed through Resend (and therefore honours `NOTIFICATION_OVERRIDE_EMAIL` in dev) and works for any email stored in the app's `USER` table — including test domains. The backend (`/api/password-reset/*`) generates a 6-digit code, emails it, verifies it, and then updates the password using the Supabase **service-role** key.

Add the service-role key to `backend/.env` (server-only — never sent to the browser; the file is gitignored):

```
SUPABASE_SERVICE_ROLE_KEY=...   # Supabase dashboard → Project Settings → API → service_role (secret)
```

In dev, the reset code is redirected to your `NOTIFICATION_OVERRIDE_EMAIL` inbox (or printed to the backend console if no Resend key is set), so you can reset accounts that use fake email addresses.

### Deadline processing (scheduler)

Events that pass their deadline below the hype threshold are auto-cancelled and refunded by a **backend scheduler** ([services/deadlineScheduler.js](backend/services/deadlineScheduler.js)). On an interval it calls the `expire_overdue_events()` RPC (using the service-role key) and emails affected backers + the organiser via the same Resend pipeline (so the dev override inbox applies). It's enabled automatically when `SUPABASE_SERVICE_ROLE_KEY` is set; otherwise it logs a warning and stays off. Optional:

```
DEADLINE_CHECK_INTERVAL_MS=300000   # how often to check (default 5 min)
```

### Payments & wallet (Stripe, Test mode)

Payments run through **Stripe in Test mode** — no real money moves. Each user has an **in‑app wallet** and can **link one card**; at checkout they pay from the **wallet** or the **linked card**.

Keys (Stripe Dashboard → Developers → API keys, in **Test mode**):
```
# backend/.env
STRIPE_SECRET_KEY=sk_test_...
# frontend/.env  (restart Vite after adding)
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```
Test card: `4242 4242 4242 4242`, any future expiry, any CVC. Decline: `4000 0000 0000 0002`.

How it works:
- **Link a card** (Wallet page) via Stripe SetupIntent; the saved card is reused for both direct card payments and wallet top‑ups.
- **Top up** charges the linked card and credits the wallet.
- **Pledge** deducts instantly — from the wallet (atomic balance debit) or by charging the card (Stripe PaymentIntent).
- **Refunds** follow the source: wallet‑paid → credited back to the wallet **instantly**; card‑paid → refunded to the card via Stripe (shown as ~3–5 business days; instant in Test mode).
- Confirmation is **synchronous** (no webhooks). If `STRIPE_SECRET_KEY` is unset, card features are disabled and the app still runs (wallet pledges only require a balance).

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
