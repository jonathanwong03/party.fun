# party.fun

`party.fun` is a campus-event crowdfunding and ticketing prototype. Attendees pay when they pledge. An event becomes confirmed (greenlit) when its active ticket count reaches its hype threshold; if the deadline passes below that threshold, active tickets are refunded.

The app uses a React + Vite frontend and an Express API, both backed by **Supabase** (Postgres + Auth):

- **Auth** (login, registration, session) runs directly against **Supabase Auth** from the frontend.
- **Data** (events, profiles, checkout, organiser CRUD) goes through the **Express backend**, which forwards each request's Supabase access token to Supabase. Every query therefore runs as the signed-in user, so **Row Level Security (RLS)** and the database's `SECURITY DEFINER` RPC functions enforce access. The backend never uses the service-role key.
- **Forecasting** runs inside the same Express backend. There is no separate Python forecasting service to start.

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

Use these accounts for the scripted demo:

| Purpose | Email | Password |
|---|---|---|
| Primary organiser | `partyfundemo@gmail.com` | use the password set in Supabase Auth |
| Secondary organiser / co-organiser | `organiser@smu.edu.sg` | `organiser123` |
| Primary user | `user@smu.edu.sg` | `user123` |
| Secondary user | `user2@smu.edu.sg` | use the password set in Supabase Auth |

These are real Supabase Auth accounts. Sessions persist, so refreshing keeps the user signed in. New signups create an `auth.users` row, and a Postgres trigger (`handle_new_user`) inserts the matching `USER` profile row.

## Full demo runbook

This section is the recommended end-to-end walkthrough for a live demo. It assumes the Supabase migration in `backend/migrations/20260623_coorganisers.sql` has already been applied.

### 0. Reset the demo data

Before the demo, paste and run the full SQL script in `backend/scripts/demo_seed.sql` in the Supabase SQL editor.

The script is rerunnable. It removes the previous demo data (identified by a fixed set of demo IDs, plus any legacy `[DEMO]`-titled rows) and recreates it, so non-demo data is left alone. When you have finished testing, run `backend/scripts/demo_cleanup.sql` in the Supabase SQL editor to remove every demo event and its data.

All demo events use student-themed display names (for example, **Inter-Uni Welcome Bash**). The table below maps each event to what it's for.

| Event | Host | Use it to demo |
|---|---|---|
| Inter-Uni Welcome Bash | partyfundemo | Co-host invite (pending → accept as organiser@smu) |
| Founders & VC Networking Night | partyfundemo | **Editing** an owned event |
| Resume & LinkedIn Clinic | partyfundemo | **Deleting/cancelling** an owned event |
| Neon Rave: Semester Send-Off | partyfundemo | Ticket **check-in** (success) |
| Retro Arcade & Esports Night | partyfundemo | **Buying** tickets (as user@smu) |
| Rooftop Silent Disco | partyfundemo | **Giving away all** tickets, no refund (user@smu) |
| Late-Night Supper Crawl | partyfundemo | Pre-seeded "all given away" in user@smu's Cancelled tab |
| Wine Appreciation & Wind-Down | partyfundemo | **Refund on cancellation** |
| Exam Study Break Social | organiser@smu | partyfundemo is already an accepted **co-organiser** |
| Open Mic & Live Band Jam | organiser@smu | **Editing** an owned event |
| Investment Club Info Session | organiser@smu | **Deleting/cancelling** an owned event |
| Global Exposure: Exchange Fair | organiser@smu | Check-in (already-used error) |
| Sunset Picnic & Chill Beats | organiser@smu | **Buying** tickets (as user2) |
| Hackathon Makers Night | organiser@smu | **Giving away all** tickets, no refund (user2) |
| Yoga & Mindfulness Sunset | organiser@smu | Pre-seeded "all given away" in user2's Cancelled tab |
| Grad Ball: Black-Tie Gala | organiser@smu | **Failed purchase** (full capacity) |
| SMU Founders' Circle (SMU only) | organiser@smu | **University-restricted**: user@smu (SMU) can join, user2 (NTU) is blocked |
| SMU Alumni Mixer (SMU only) | organiser@smu | **University-restricted** (alumni): user@smu (SMU) can join, user2 (NTU) is blocked |

> Demo attendee universities are seeded as `user@smu.edu.sg` → **SMU** and `user2@smu.edu.sg` → **NTU**, and both organisers are **SMU**.

After seeding, start both servers:

```powershell
cd "C:\smu heap\party.fun\backend"
npm run dev
```

```powershell
cd "C:\smu heap\party.fun\frontend"
npm run dev
```

Open `http://localhost:5173`.

### 1. Guest browsing

1. Log out or open the site in a fresh browser session.
2. Go to All Events.
3. Open any demo event (for example, `Founders & VC Networking Night`).
4. Point out that guests can view events and the hype meter, but must log in before buying tickets.

### 2. User purchase flow

Use `user@smu.edu.sg`.

1. Log in as `user@smu.edu.sg`.
2. Go to All Events.
3. Open `Retro Arcade & Esports Night`.
4. Buy or pledge 1 ticket.
5. Confirm that the event now appears in Joined Events.
6. Return to All Events and open the same event again.
7. Confirm the UI blocks another purchase while the user still has active tickets for that event.

Use `user2@smu.edu.sg` for the second purchase scenario:

1. Log in as `user2@smu.edu.sg`.
2. Open `Sunset Picnic & Chill Beats`.
3. Buy or pledge 1 ticket.
4. Confirm it appears in Joined Events.

### 3. Give away all tickets, no refund

Use `user@smu.edu.sg`.

1. Go to Joined Events.
2. Open `Rooftop Silent Disco`.
3. Use the give-away control to give away every active ticket.
4. Confirm the app warns that giving away tickets is final and not refunded.
5. Return to Joined Events.
6. Confirm the event moved from Upcoming to Cancelled.

Use `user2@smu.edu.sg` for the second give-away scenario:

1. Go to Joined Events.
2. Open `Hackathon Makers Night`.
3. Give away every active ticket.
4. Confirm it moves to Cancelled.

You can also show pre-seeded cancelled history:

- `user@smu.edu.sg`: `Late-Night Supper Crawl`
- `user2@smu.edu.sg`: `Yoga & Mindfulness Sunset`

### 4. Organiser creates a new event

Use `partyfundemo@gmail.com` or `organiser@smu.edu.sg`.

1. Log in as an organiser.
2. Open Hosted Events.
3. Click Create New Event.
4. Fill in title, organiser name, description, schedule, location, Early Birds price/quantity, Greenlit price/quantity, and deadline.
5. Publish the event.
6. Confirm the event appears in Hosted Events and All Events.

Recommended title for the demo-created event:

```text
My Pop-up Event
```

### 5. Organiser edits an owned event

Use `partyfundemo@gmail.com`.

1. Open Hosted Events.
2. Edit `Founders & VC Networking Night`.
3. Change the title, location, description, or prices.
4. Save changes.
5. Open the event detail page and confirm the changes are visible.

Use `organiser@smu.edu.sg` for the second edit example:

- `Open Mic & Live Band Jam`

### 6. Organiser deletes or cancels an owned event

Use `partyfundemo@gmail.com`.

1. Open Hosted Events.
2. Find `Resume & LinkedIn Clinic`.
3. Use the destructive action shown by the app.
4. Confirm the modal and complete the action.

Use `organiser@smu.edu.sg` for the second example:

- `Investment Club Info Session`

These events are intentionally empty so the demo does not disrupt seeded ticket scenarios.

### 7. Co-organiser invitation flow

Co-organisers are not a separate role. They are normal organiser accounts that have been invited to manage one event they did not create.

Use `organiser@smu.edu.sg`.

1. Log in as `organiser@smu.edu.sg`.
2. Open Pending Invites.
3. Accept the invite for `Inter-Uni Welcome Bash`.
4. Go to Hosted Events.
5. Confirm `Inter-Uni Welcome Bash` appears with a Co-organiser label.
6. Edit the event details and save.
7. Confirm Cancel/Delete/Remove controls are not shown for this co-organised event.

Use `partyfundemo@gmail.com` to show an already accepted co-organiser event:

1. Log in as `partyfundemo@gmail.com`.
2. Go to Hosted Events.
3. Confirm `Exam Study Break Social` appears with a Co-organiser label.
4. Confirm it can be edited, but cannot be cancelled or deleted by the co-organiser.

Declined invite example:

- `Wine Appreciation & Wind-Down` has a declined invite seeded for `organiser@smu.edu.sg`.
- It should not appear as a manageable co-organised event for that account.

### 8. Owner invites another organiser

Use `partyfundemo@gmail.com`.

1. Open Hosted Events.
2. Edit any owned event, for example `Founders & VC Networking Night`.
3. In the Co-organisers section, enter `organiser@smu.edu.sg`.
4. Send the invite.
5. Log in as `organiser@smu.edu.sg`.
6. Open Pending Invites and accept or decline the new invite.

Only organiser accounts can be invited. User accounts such as `user@smu.edu.sg` and `user2@smu.edu.sg` should be rejected.

### 9. Ticket check-in

Use `partyfundemo@gmail.com`.

1. Go to Tickets.
2. Select `Neon Rave: Semester Send-Off`.
3. Manually enter this ticket code:

```text
PF-DEMO-PFD-04-01
```

4. Confirm the ticket changes to checked in.
5. Enter the same code again.
6. Confirm the app shows an already checked-in style error.

Use `organiser@smu.edu.sg` for an already-used ticket example:

1. Go to Tickets.
2. Select `Global Exposure: Exchange Fair`.
3. Manually enter:

```text
PF-DEMO-SMU-04-01
```

4. Confirm the app shows that the ticket was already checked in.

After `organiser@smu.edu.sg` accepts the co-organiser invite for `Inter-Uni Welcome Bash`, they can also check in tickets for that event.

**Check in by scanning a QR code** (instead of typing the code):

- For this step, you will need to be in the backend directory and run the command:
`node scripts/sendDemoTickets.js` 
in order to generate the 10 tickets used for testing

1. Still on Tickets, select the event (e.g. `Neon Rave: Semester Send-Off`).
2. Click **Scan with camera** and allow camera access.
3. Point the camera at the attendee's ticket QR — each ticket in the emailed ticket PDF carries one,
   and the booking QR checks in all of that booking's remaining tickets. The app checks in
   automatically on a successful read.
4. For a quick self-contained demo without the PDF, generate a QR image from a seeded code such as
   `PF-DEMO-PFD-04-01` (any online QR generator) and scan that. Manual code entry remains as a fallback.


### 10. Attendee/contact visibility

Use an organiser account.

1. Open Attendees from the sidebar.
2. Confirm the list includes attendees from owned events.
3. After accepting a co-organiser invite, confirm attendees from the co-organised event also appear.
4. Open a co-organised event detail page and view Who's Going / attendees.
5. Confirm organiser-level attendee details are available to accepted co-organisers.

### 11. Failed purchase due to full capacity

Use `user@smu.edu.sg`.

1. Go to All Events.
2. Open `Grad Ball: Black-Tie Gala`.
3. Try to buy a ticket.
4. Confirm the app blocks the purchase because there are not enough tickets available.

### 12. Refund on organiser cancellation

Use `partyfundemo@gmail.com`.

1. Open Hosted Events.
2. Find `Wine Appreciation & Wind-Down`.
3. Cancel the event with a reason.
4. Explain that wallet-paid active tickets are refunded to the buyer's wallet by the database RPC.
5. Log in as `user@smu.edu.sg`.
6. Check Wallet / Joined Events to confirm the cancellation/refund behavior.

### 13. University-restricted events

Eligibility is the university each account picked at registration (seeded: `user@smu.edu.sg` → SMU,
`user2@smu.edu.sg` → NTU). An event restricted to a university only admits its members.

1. Log in as `user@smu.edu.sg` (SMU).
2. Open `SMU Founders' Circle (SMU only)` and `SMU Alumni Mixer (SMU only)` and confirm you **can** pledge/buy both.
3. Log in as `user2@smu.edu.sg` (NTU).
4. Open either SMU-restricted event and confirm the buy card is **blocked** (red "SMU members only").
5. (Organiser side) As an organiser, Create/Edit an event and tick **"Only allow {your university}
   members to attend"** in the Location section — it restricts the event to your own university.
6. (Optional) In Settings, a user can change their university **once**; after that the control locks.

### 14. Admin moderation, if showing admin mode

Use an admin account if one has been seeded with `backend/scripts/seedAdmins.js`.

1. Log in as admin.
2. Go to Manage Events.
3. Cancel any demo event with a moderation reason.
4. Confirm the event records the cancellation as admin-driven and backers are refunded.

### Recommended demo order

For the cleanest presentation, use this sequence:

1. Guest browsing
2. User purchase
3. Give away all tickets
4. Organiser create event
5. Organiser edit event
6. Organiser delete/cancel empty event
7. Co-organiser accept invite
8. Co-organiser edit/check-in but cannot cancel/delete
9. Ticket check-in and already-used ticket (manual code + QR camera scan)
10. Failed purchase due to full capacity
11. Refund on organiser cancellation
12. University-restricted events (member can join, non-member blocked)

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
- Pricing model choice (`Tiered` or `Hype curve`) is locked after event creation.
- Analytics forecasts expected ticket revenue. Operational costs are shown only as typical categories outside party.fun.
- Completed greenlit events record a simulated ticket revenue payout to the organiser; operational costs are not deducted by the app.

## Event rules

- Pricing tiers (`PRICE_STATUSES.statusName`): `early_bird`, `greenlit`
- Event statuses (`EVENT.status`): `early_bird`, `greenlit`, `completed`, `cancelled`
- `hypeThreshold`: minimum active ticket count required to greenlight an event
- `maxCapacity`: maximum active ticket count allowed
- `activeTicketCount`, `hypePercentage`, and `spotsLeft` are derived values
- `hypePercentage = min(100, activeTicketCount / hypeThreshold * 100)`
- Pricing model (`EVENT_SETTINGS.hypeDrivenPricing`) is immutable once the event has been created.

## Database (Supabase)

Data lives in Supabase Postgres. The tables (RLS enabled):

- `USER`: profile rows, keyed to `auth.users.id` (role `user` or `organiser`)
- `EVENT`: event identity, schedule, and lifecycle status
- `EVENT_SETTINGS`: hype threshold, maximum capacity, and deadline
- `PRICE_STATUSES`: Early Birds and Greenlit prices and capacities
- `BOOKINGS`: one payment/pledge transaction
- `BOOKING_ITEMS`: quantity and price breakdown for each booking
- `TICKETS`: individual ticket lifecycle records

The business logic (pledge allocation across tiers, hype recalculation, give-away, soft delete, event CRUD, expiry, and ticket revenue payout) lives in Postgres **RPC functions** — `get_events`, `get_profile`, `get_quote`, `create_pledge`, `give_away_tickets`, `soft_delete_booking`, `create_event`, `update_event`, `delete_event`, `expire_overdue_events`, `complete_due_events`. These are `SECURITY DEFINER` and use `auth.uid()` where user context is required, so they run safely whether called by the frontend or the backend on the user's behalf.

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
- `GET /api/weather?eventId=…` or `?lat=&lon=&start=&end=` — rain assessment for an event window

Login and registration are **not** backend routes — they go straight to Supabase Auth from the frontend. A request with no/invalid token to a protected route returns `401`.

## App structure (pages)

- **All Events (discovery)** — the public browse page listing events a user can **pledge for**: events they do **not** host that are still open (`early_bird` or `greenlit`; not `cancelled`/`completed`). "The cheapest / most expensive ticket I can buy" is computed over **this** list, **excluding** events the user has already purchased.
- **Hosted Events (organiser dashboard)** — an organiser's **own** events (created + co-organised), each with status, early-bird & greenlit prices, tickets sold, and hype threshold. Distinct from All Events, which is what everyone browses to buy.
- **Joined events** — events the user has pledged for (holds active tickets in).
- **Draft event** — an unpublished event saved in the organiser's Drafts tab, resumed and published later via the Create Event form. The AI assistant creates new events as drafts.
- **Event status** — `early_bird` (open, collecting pledges) → `greenlit` (hit its hype threshold; confirmed) → `completed` (finished, paid out); or `cancelled` (organiser cancelled, or missed threshold by deadline — all pledges refunded).

## Concepts & glossary

Domain language used throughout the app and code (prefer these terms; avoid the noted alternatives):

- **Pledge** — a user's commitment to buy tickets for an event, recorded as a `BOOKINGS` row. Payment is captured at pledge time. _Avoid_: purchase/checkout/order/reservation (implies unpaid hold).
- **Payment capture** — money is taken at the moment of pledging; refunded if the event fails to greenlight by the deadline. _Avoid_: charge-on-greenlight, authorization hold, pay later.
- **Booking** — the persisted record of a pledge (one payment transaction per user per event). _Avoid_: "pledge" when meaning the DB entity; transaction.
- **Ticket** — an individual seat within a booking, with its own lifecycle (`active`, `given_away`, `refunded`, `used`). _Avoid_: spot, seat allocation.
- **Give-away** — a voluntary release of some or all active tickets back to the event pool. **No money is returned.** _Avoid_: cancellation, refund, release.
- **Cancellation** — when an event fails to reach its hype threshold by the deadline, or an organiser cancels it. Active tickets are refunded. _Avoid_: give-away, delete.
- **Refund** — money returned when tickets are cancelled at the **event** level (deadline miss or organiser cancellation). Not applicable to give-aways.
- **Greenlit** — an event that has reached its hype threshold (`activeTicketCount ≥ hypeThreshold`); confirmed, tickets locked in. Measured in **tickets pledged**, not unique backers (one user pledging 5 counts as 5). _Avoid_: confirmed, funded, backer count.
- **Active ticket count** — tickets currently pledged and not given away or refunded across all users for an event. Drives hype percentage and greenlighting. _Avoid_: backers, ticket sales.
- **Hype threshold** — the minimum active ticket count required to greenlight. _Avoid_: funding goal, target backers.

Notification language:

- **Notification recipient** — a user who should receive a transactional email about an event they're involved in (pledged, gave away tickets, or affected by greenlight/cancellation).
- **Greenlit notification** — an email sent to every user with at least one active ticket when an event transitions to greenlit; recipient emails are resolved server-side via a Postgres RPC (not by reading other users' rows through RLS).
- **Notification log** — a durable record of each email send attempt (`NOTIFICATION_LOGS`): recipient, event, type, outcome. For audit/debug, not retry orchestration.
- **Notification delivery status** — `sent` (Resend accepted), `mock_sent` (dev/console only, no real delivery), or `failed` (retries exhausted). _Avoid_: delivered/read/opened.
- **Transactional notification** — an email triggered by a domain event (pledge, give-away, greenlit). Delivery is a side effect: the underlying action succeeds even if the email fails.

## Hype-driven pricing

An alternative to tiered pricing where a ticket's price rises with demand instead of stepping between two fixed tiers.

- **Base ticket price (P_base)** — the price of the first ticket when the active ticket count is zero (`EVENT_SETTINGS.basePrice`).
- **Max ticket price (P_max)** — the price at full capacity (`EVENT_SETTINGS.maxPrice`).
- **Bonding curve** — the dynamic price for the current active ticket count `x` (with `C = maxCapacity`):

  `P(x) = P_base · (P_max / P_base) ^ (x / C)`

- **Price elasticity** — the price fluctuates symmetrically (up **and** down) with the live active ticket count.
- Tiered events instead store fixed `early_bird` then `greenlit` prices in `PRICE_STATUSES`; the pricing **model** (`EVENT_SETTINGS.hypeDrivenPricing`) is locked after event creation.

## AI event-planning agent

A Google **Gemini**-only event-planning **agent** (model `gemini-2.5-flash`), built into the Express backend (`backend/services/ai/`) — no separate service. It's off gracefully when `GEMINI_API_KEY` is not set.

- **LangGraph workflow** — chat runs as one explicit `StateGraph` ([backend/services/ai/agent/eventGraph.js](backend/services/ai/agent/eventGraph.js)) that mirrors the whole workflow diagram: `scope → classify → {answer | discover | bestfit | manage | transact} → (proposals?) confirm → execute → END`.
  - **`scope`** guard runs first and strictly refuses off-topic questions (general knowledge, maths, coding, trivia) with a canned reply before any tool runs — greetings/thanks and anything event/ticket/wallet/hosting/weather/date related pass through.
  - **`classify`** node (an LLM call, regex fallback) tags the request's intent (read-only question · event discovery · cheapest/best-fit · event management · transaction) and routes to the matching branch.
  - Each **branch is its own canonical agent** — `createAgent(...)` from LangChain v1 (built on LangGraph), with a **scoped toolset** so a discovery branch can't move money, etc.
  - The **confirm step is a real human-in-the-loop `interrupt()`** persisted by an in-memory `MemorySaver` checkpointer: every write pauses the graph, returns the proposal + a `threadId`, and resumes via `POST /api/ai/chat/resume` when the user confirms/rejects.
  - The **`execute` node** applies confirmed proposals through the existing `executeAction` ([backend/services/ai/agent/actions.js](backend/services/ai/agent/actions.js)), which re-validates ownership/balances via RLS — so "execute in the graph" never trusts graph state for money.
- **Chat assistant** (floating panel — draggable by its header, Shift+Enter for a newline, plain-text replies with no markdown, no emojis and no model caption) — it stays **strictly on events** (the scope guard declines unrelated questions, still greets), knows the current user's **role** and **today's date** (Singapore, injected each turn); branches call backend **read** tools (`search_events` & `list_available_events` — both return full detail: price, status, hype, start/end date-time, venue, address, deadline, description; `list_available_events` is the events you can **attend/buy** = hosted by someone else, open, **starting in the future**, and **not already purchased**, matching the All Events page exactly — `get_my_hosted_events` & `get_event_details` — live **status**, **current price**, for your own events **revenue so far** — `get_my_joined_events` (upcoming/past/cancelled with **tickets held per event**), `get_event_forecast` (revenue + **profit**), `get_event_attendees` (who's coming + count), `get_wallet`, `list_my_drafts`, `get_current_date`, `get_weather` — per-day rain forecast across the event's duration — `research_event_ideas` — web research on student interests → name/description/rationale + a location suggestion) and **write** tools that each create a confirm-gated proposal: events (`propose_update_event` = edit in place, allowed for co-organisers too, `propose_create_event` = draft with a tiered **or** hype pricing model, `propose_invite_coorganiser`, `propose_cancel_event` = cancel/refund with a **required reason**, `propose_delete_draft`) and **money/tickets** (`propose_topup` = charge card into wallet, `propose_pledge` = buy tickets from wallet balance (asks qty + shows total/balance; tops up by card when short), `propose_give_away_tickets` = release N of your own tickets to the pool, and refunds via `propose_cancel_event`). Conversations are saved per user with a history list.
- **Always confirm (no auto mode)** — every write pauses at the graph's `interrupt()`; the user confirms by button or by typing "confirm", or dismisses to reject. Execution re-validates server-side against ownership + balances; created events are saved as **drafts**; money moves reuse the same RLS/RPC-enforced paths as the wallet, give-away & cancellation UIs (`topupWallet` / `giveAwayTickets` / `cancelEventWithRefunds` services). "Delete this event" = cancel it with a reason (refunding backers) for a published event, or delete the draft for an unpublished one.
  - **Create flow:** for a new event the agent asks for a theme (or researches one), suggests a name/description/location from web research, recommends a tiered-vs-hype pricing model, and only drafts after the organiser confirms.
  - _Checkpointer note:_ `MemorySaver` is in-process, so pending confirmations are lost on a backend restart / don't span multiple instances — a lost pending confirm just means the user re-asks (nothing unsafe executes because `execute` re-validates).
- **Inline helpers** — "Suggest names/description" on Create Event, "Get AI revenue tips" on the analytics forecast card, and "Recommended for you" on the events page.
- **Proactive advisor** — an opt-in background agent that periodically finds at-risk events (early-bird, near deadline, below threshold) and emails the organiser tailored suggestions. It only advises (never mutates). Enable with `AGENT_ADVISOR_ENABLED=true` (interval via `AGENT_ADVISOR_INTERVAL_MS`).
- **Memory (learns & adapts)** — a per-user store the agent reads to personalise and writes to via a `remember` tool (interests/budget for attendees; venue/theme/pricing preferences for organisers). It works silently in the background — injected into the agent's context each turn — with no user-facing panel.
- **Weather warnings** — the agent (and three UI surfaces) warn when an event's day has a **> 70% chance of rain** (unsuitable for outdoor events), using the Google Maps Platform **Weather API** (`GOOGLE_WEATHER_API_KEY`, called server-side; ~10-day horizon). Events store their **venue coordinates** (`EVENT.latitude`/`longitude`, captured from the AddressPicker on create/edit and returned by `get_events`), so the **Create/Edit Event** form, the **Event Details** page and the agent's `get_weather` tool all check the forecast at the exact venue (Singapore fallback for events with no stored coordinates). Exposed via `GET /api/weather` ([backend/controllers/weatherController.js](backend/controllers/weatherController.js), [backend/services/weatherService.js](backend/services/weatherService.js)). Degrades silently when the key is unset.
- **Semantic (vector) RAG** — Gemini text embeddings (`gemini-embedding-001`, 768-dim) stored in **Supabase pgvector** (`EVENT_EMBEDDINGS`, `DOC_CHUNKS`) power meaning-based features: `recommend_events` (rank events by the user's interests — "gaming" surfaces an arcade/esports night, not a literal keyword match), `semantic_search_events` + the All Events search bar (`GET /api/events/search`), `find_similar_events` ("more like this"), and help-doc retrieval in `answerAppQuestion` (fetch only the relevant knowledge chunks). Event embeddings are refreshed on create/edit ([eventEmbeddings.js](backend/services/ai/eventEmbeddings.js)); backfill existing rows with `node scripts/backfillEmbeddings.js`. All of it degrades gracefully to the old LLM/substring behaviour when embeddings are unavailable.
- **Web research** — `research_event_ideas` uses Gemini's built-in **Google Search grounding** ([backend/services/ai/agent/research.js](backend/services/ai/agent/research.js)) to find current university-student interests and suggest an event name, description, rationale and a location near the organiser's university; falls back to Gemini's built-in knowledge when grounding is unavailable.

Env keys (in `backend/.env`; `GEMINI_API_KEY` enables all AI features):

```
GEMINI_API_KEY=...        # Google Gemini (AI Studio, may start with AQ. or AIza) — powers the whole assistant
# AI_GEMINI_MODEL=gemini-2.5-flash   # optional model override (default gemini-2.5-flash)
GOOGLE_WEATHER_API_KEY=...# Google Maps Platform Weather API (server-side; enable "Weather API" in the same GCP project as Maps)
# AGENT_ADVISOR_ENABLED=true         # opt-in proactive advisor (off by default)
# AGENT_ADVISOR_INTERVAL_MS=60000    # advisor scan cadence (default 1 hour)
```

AI-owned tables (all RLS owner-only): `AI_CHAT_CONVERSATIONS`, `AI_CHAT_MESSAGES`, `AI_USER_MEMORY`, and `NOTIFICATION_LOGS` (email audit + advisor de-dupe). The agent's internal knowledge base — how it should answer questions about the app — lives in [backend/services/ai/app-knowledge.md](backend/services/ai/app-knowledge.md); **keep that file updated alongside this README when the agent's behaviour or the app changes.**



