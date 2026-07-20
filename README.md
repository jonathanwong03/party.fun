# party.fun

`party.fun` is a campus-event crowdfunding and ticketing prototype. Attendees pay when they pledge. An event becomes confirmed (greenlit) when its active ticket count reaches its hype threshold; if the deadline passes below that threshold, active tickets are refunded.

The app uses a React + Vite frontend and an Express API, both backed by **Supabase** (Postgres + Auth):

- **Auth** (login, registration, session) runs directly against **Supabase Auth** from the frontend.
- **Data** (events, profiles, checkout, organiser CRUD) goes through the **Express backend**, which forwards each request's Supabase access token to Supabase. Every *user* query therefore runs as the signed-in user, so **Row Level Security (RLS)** and the database's `SECURITY DEFINER` RPC functions enforce access.
- **The service-role key is used only where there is no signed-in user to act as, or where the user must not be trusted** — admin moderation, the deadline scheduler, Stripe payments/refunds and reconciliation, ticket PDFs, and the phone/password-reset OTP flows. It is obtained through [backend/services/supabaseAdmin.js](backend/services/supabaseAdmin.js) and never used to serve an ordinary authenticated request. Everything else stays on the anon key + RLS.
- **Forecasting** runs inside the same Express backend. There is no separate Python forecasting service to start.

Payments are **live** (Stripe, test mode): pledging creates a real off-session `PaymentIntent`, with an idempotency key and a compensating refund if the booking fails to commit ([backend/services/checkoutService.js](backend/services/checkoutService.js)). See [Payments & wallet](#payments--wallet-stripe-test-mode).

## Run locally

Both packages run together, in separate terminals.

### 1. Backend

The backend needs a `backend/.env` (gitignored) — see [backend/.env.example](backend/.env.example) for the full list. It forwards the user's JWT to Supabase, so ordinary requests use the **anon/publishable** key; the service-role key is additionally required for admin moderation, the scheduler, Stripe refunds/reconciliation and the OTP flows (see above):

```
SUPABASE_URL=<your Supabase project URL>
SUPABASE_ANON_KEY=<your Supabase anon / publishable key>
SUPABASE_SERVICE_ROLE_KEY=<service-role key>   # admin/scheduler/payment paths; omit and those degrade
# API_PORT=8000                                # optional; defaults to 8000 (PORT also honoured)
```

Only `SUPABASE_URL` + `SUPABASE_ANON_KEY` are needed to boot. Everything else (Redis, Stripe, Resend, Gemini, weather, Twilio) is feature-gated and degrades gracefully when unset — see the sections below and `.env.example`.

```powershell
cd "C:\smu heap\party.fun\backend"
npm install
npm run dev
```

#### Redis (optional)

The backend can use a **managed Redis** (Upstash / Redis Cloud) as a shared, fast in-memory store. It is **entirely optional** — leave `REDIS_URL` unset and everything falls back to per-process in-memory behaviour (fine for a single dev instance). Set it, and the backend uses Redis for three jobs: **caching** slow reads, **storing short-lived login/reset codes** so they survive restarts, and **rate limiting** across instances.

```
REDIS_URL=rediss://default:<password>@<host>:<port>   # optional; unset = in-memory fallback
```

> Use the TLS scheme `rediss://` (Upstash requires it). The URL itself is the credential — there is no separate API key. Set it as a secret env var in production, not in a committed file.

**What exactly it does** — the data Redis holds:

| Purpose | Key(s) | TTL | What it saves / why |
|---|---|---|---|
| **Cache event lists** | `events:list:anon`, `events:list:u:<userId>`, and the raw-RPC shape the AI tools read: `events:raw:anon`, `events:raw:u:<userId>` | **60s fresh + 600s stale** (see SWR below) | Avoids re-running the `get_events` Supabase RPC (~3s uncached) on every landing/events page load. Guests share one key; signed-in users get their own (results are per-user via RLS). **Invalidated immediately** on any event write (create/edit/cancel/hide, and every pledge) so it's never stale. |
| **Cache derived reads** | `data:profile:*`, `data:attendees:*` (30s) · `data:hostsummary:*`, `data:analytics:*`, `data:allattendees:*` (45s) · `data:hostrev:*`, `data:drafts:*`, `data:invites:*`, `data:calculator:*` (60s) · `data:umeta:*` (10 min) | 30s–10 min | Short-lived caches for the reads that reflect event/hype/attendee/revenue changes. Cleared by the same invalidation as the event lists, so a write is visible immediately. |
| **Cache weather forecasts** | `wx:<lat>,<lon>` | 30 min | Caches the Google Weather API response per venue location, so repeat checks (event detail page, create/edit form, AI `get_weather` tool) don't re-hit the paid API. |
| **Cache AI embeddings** | `emb:<model>:<taskType>:<hash>` | 24h | Caches the Gemini embedding vector for a given text. Semantic search re-uses the same query embedding instead of paying for a fresh Gemini call each time. |
| **Store phone-login OTP** | `otp:phone:<number>` | ~11 min | The 6-digit SMS login code + attempt counter. In Redis it survives a backend restart and works across multiple instances (unset ⇒ in-memory `Map`, lost on restart). |
| **Store password-reset OTP** | `otp:reset:<email>` | ~11 min | Same as above, for the emailed/SMS password-reset code. |
| **Rate limiting** | `rl:<window>:<limit>:<id>` | window length | Throttles the OTP/reset **send** endpoints per identifier+IP (**1 / 30s** and **5 / hour**) using `INCR`+`EXPIRE`, enforced across all instances. Protects the paid SMS/email senders from spam. |

**Stale-while-revalidate (the event lists):** `get_events` is the app's slowest read (~3s uncached), so it uses SWR rather than a plain TTL ([backend/services/cache.js](backend/services/cache.js) `withSwrCache`, [backend/services/eventService.js](backend/services/eventService.js)). The value is stored as an envelope under a physical TTL of **fresh + stale** (60s + 600s):

- **miss** → run the loader (blocking), cache, return;
- **hit, within 60s** → return immediately (fresh);
- **hit, 60s–660s** → return the cached value **immediately** and refresh in the background (one in-flight refresh per key), so nobody waits on the slow path.

Only after ~11 minutes of zero traffic does a request pay the full loader cost again. Writes invalidate the key outright, so SWR never serves stale data across an edit.

**Fail-open by design:** if Redis is unreachable (or still connecting at startup), every path degrades gracefully — cache reads count as a miss and fall back to Supabase/the live API, rate limiting is skipped, and OTP codes fall back to the in-memory map. Requests still succeed and the process never crashes. Implemented in [backend/services/redisClient.js](backend/services/redisClient.js) (connection) and [backend/services/cache.js](backend/services/cache.js) (helpers); the client is only used once its connection status is `ready`.

### 2. Frontend

The frontend talks to Supabase Auth directly, so it needs a `frontend/.env` (gitignored) — see [frontend/.env.example](frontend/.env.example):

```
VITE_SUPABASE_URL=<your Supabase project URL>
VITE_SUPABASE_ANON_KEY=<your Supabase anon / publishable key>
VITE_GOOGLE_MAPS_API_KEY=<browser key with Maps JavaScript API + Places API enabled>
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...   # optional; unset = wallet-only checkout
```

`VITE_GOOGLE_MAPS_API_KEY` is easy to miss and its absence is quiet: it powers the **AddressPicker** on Create/Edit Event (which captures the venue's latitude/longitude) and "How to get there" on Event Details. Without it the picker can't load, new events store no coordinates, and weather checks silently fall back to Singapore-wide instead of the venue's.

Vite only exposes `VITE_`-prefixed variables, embeds them into the client bundle (so never put a secret there), and only reads `.env` at startup — (re)start the dev server after creating or changing it, otherwise login fails with `supabaseUrl is required`.

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
| Your booking is confirmed | you — **your ticket(s) as a PDF with a QR code** attached (this is what gets scanned at check-in) |
| You give away tickets (some or all) | you (different wording when you give away **all** — you can no longer attend) |
| Your pledge is cancelled | you (refund notice) |
| An organiser **creates** an event | the organiser |
| An organiser **edits** a live event | every backer (what changed) |
| An event **reaches its hype threshold** (greenlit) | every backer **and** the organiser — tickets are now confirmed |
| An organiser **cancels** an event | every backer (full-refund notice) **and** the organiser |
| An event **misses its hype threshold by the deadline** | every backer (full-refund notice) **and** the organiser — sent automatically by the scheduler |
| An event **completes** (its end time passes while greenlit) | the organiser — the ticket-revenue payout summary, sent automatically by the scheduler |
| You are invited as a **co-organiser** | the invitee |
| You request a password reset | the account's email — the 6-digit code |

In development, with `NOTIFICATION_OVERRIDE_EMAIL` set, **all** of these are redirected to that one inbox regardless of who they're addressed to (so you'll receive every email yourself). Without a `RESEND_API_KEY`, they're printed to the backend console instead. Note: the "deadline missed" email only fires while the backend is running (the scheduler checks on an interval).

### Password reset (custom OTP via Resend)

"Forgot password" uses a custom one-time code, **not** Supabase's built-in recovery, so the code is emailed through Resend (and therefore honours `NOTIFICATION_OVERRIDE_EMAIL` in dev) and works for any email stored in the app's `USER` table — including test domains. The backend (`/api/password-reset/*`) generates a 6-digit code, emails it, verifies it, and then updates the password using the Supabase **service-role** key.

Add the service-role key to `backend/.env` (server-only — never sent to the browser; the file is gitignored):

```
SUPABASE_SERVICE_ROLE_KEY=...   # Supabase dashboard → Project Settings → API → service_role (secret)
```

In dev, the reset code is redirected to your `NOTIFICATION_OVERRIDE_EMAIL` inbox (or printed to the backend console if no Resend key is set), so you can reset accounts that use fake email addresses.

### Phone login (SMS OTP via Twilio)

As well as email/password and Google OAuth, an account can sign in with a **phone number + 6-digit SMS code** (`/api/phone-login/*` → the `Verify code` page). The backend sends the code via **Twilio**, stores it with an attempt counter (Redis when available, in-memory otherwise, ~11 min TTL), and rate-limits the send endpoint (1 / 30s and 5 / hour per identifier+IP) to protect the paid sender. Optional in `backend/.env`:

```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SERVICE_SID=MG...
SMS_OVERRIDE_NUMBER=+65...   # dev: send every SMS here instead of the real number
```

Leave the Twilio keys unset and it runs in **mock mode** — the code is printed to the backend console instead of sent, so the flow is fully testable without credentials (the same shape as the Resend fallback).

### Deadline processing (scheduler)

A **backend scheduler** ([services/deadlineScheduler.js](backend/services/deadlineScheduler.js)) runs three jobs on each tick (service-role key; first run ~10s after boot, then on the interval below). It's enabled automatically when `SUPABASE_SERVICE_ROLE_KEY` is set; otherwise it logs a warning and stays off.

1. **Expire overdue events** — `expire_overdue_events()` auto-cancels and refunds events that passed their deadline below the hype threshold, then emails affected backers + the organiser via the same Resend pipeline (so the dev override inbox applies).
2. **Complete due events** — `complete_due_events()` marks greenlit events whose end time has passed as `completed` and emails the organiser their ticket-revenue payout summary.
3. **Reconcile payments** — `reconcilePayments()` scans recent Stripe charges for **orphans** (money captured but no booking committed, e.g. a crash mid-checkout) and refunds them. Looks back `RECONCILE_LOOKBACK_DAYS` (default 7).

Optional:

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
- **Signup bonus** — every first‑time account (user or organiser) is credited **$20** in the wallet on creation. Email/password signups get it inline from the `handle_new_user` trigger; Google‑OAuth signups get it when they complete onboarding (`complete_oauth_signup` → `grant_signup_wallet_credit`). It is one‑time and idempotent (guarded on an existing `signup_bonus` transaction), and appears in the wallet ledger as "Signup bonus".
- **Link a card** (Wallet page) via Stripe SetupIntent; the saved card is reused for both direct card payments and wallet top‑ups.
- **Top up** charges the linked card and credits the wallet.
- **Pledge** deducts instantly — from the wallet (atomic balance debit) or by charging the card (Stripe PaymentIntent).
- **Refunds** follow the source: wallet‑paid → credited back to the wallet **instantly**; card‑paid → refunded to the card via Stripe (shown as ~3–5 business days; instant in Test mode). Beyond `REFUND_WINDOW_DAYS` (default **180**) Stripe will not refund the original charge, so [services/refundPolicy.js](backend/services/refundPolicy.js) flags those for manual handling instead of failing the cancellation.
- **Idempotent, with a compensating refund** — each pledge sends an idempotency key (`pledge:<attemptId>`), so a retry can never double‑charge; if the charge succeeds but the booking fails to commit, the charge is refunded immediately rather than left orphaned. Anything that still slips through is swept by the scheduler's reconcile job ([services/paymentReconciler.js](backend/services/paymentReconciler.js)).
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

### Tests

```powershell
cd "C:\smu heap\party.fun\backend"
npm test                  # unit tests (node:test, ~30 files) — no DB or API keys needed
npm run test:integration   # payment RPCs against a REAL Postgres
```

`npm test` uses Node's built-in runner and stubs every external service, so it runs offline and fast. The integration suite exercises the real `create_pledge` / `wallet_topup` RPCs (unique indexes, row locks, concurrency) which mocks can't cover; it **skips itself with a reason** unless all three keys below are set, so `npm test` stays green without them:

```
TEST_SUPABASE_URL=...
TEST_SUPABASE_SERVICE_ROLE_KEY=...   # creates/deletes auth users — see the warning
TEST_SUPABASE_ANON_KEY=...           # defaults to SUPABASE_ANON_KEY
```

> ⚠️ Point these at a **disposable Supabase branch** or a local `supabase start` database — never the production project. The suite creates and deletes auth users and rows.

## Deploying

The reference deployment is **frontend on Vercel**, **backend on Render**, one **Supabase** project. Getting the app working end-to-end means four things beyond pushing code — each has bitten this project:

**1. Apply migrations BEFORE deploying the backend that calls them.** Several `backend/migrations/*` files `DROP`/recreate RPCs and *change their signatures*. If the database is applied but the backend is still the old code (or vice-versa), calls fail with **"Could not find the function public.<name>(…) in the schema cache"**. Order: migrate Supabase first, then deploy the matching backend. Never leave the DB ahead of the code.

**2. Backend env (Render)** — mirror [backend/.env.example](backend/.env.example). Beyond the Supabase URL/anon key, **`SUPABASE_SERVICE_ROLE_KEY` is required** — card payments (`create_pledge_card`), wallet top-ups (`wallet_topup`), admin moderation, the deadline scheduler and Stripe refunds all run through the service-role client. Without it, wallet pledges work but **card/top-up throw**. Also set `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_WEATHER_API_KEY`, and `APP_BASE_URL` (the deployed frontend URL, for email links).

**3. Frontend env (Vercel)** — all four `VITE_` keys from [frontend/.env.example](frontend/.env.example): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_MAPS_API_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`.

**4. Two dashboards outside the repo:**

- **Supabase → Authentication → URL Configuration** (or Google/Facebook OAuth silently bounces users to `localhost`). Set **Site URL** to the deployed origin (e.g. `https://your-app.vercel.app`) and add `<origin>/auth/callback` to the **Redirect URLs** allow-list (keep `http://localhost:5173/auth/callback` for dev; `https://your-app-*.vercel.app/**` covers preview deploys). Supabase falls back to the Site URL whenever `redirectTo` isn't allow-listed — a localhost Site URL is what makes production OAuth land on localhost even though [frontend/src/app/api.ts](frontend/src/app/api.ts) already sends the correct `window.location.origin/auth/callback`.
- **Google Cloud → the Maps API key** (or address autocomplete returns *"not authorized … referer: …"*). Add the deployed origin to the key's **HTTP-referrer** allow-list (`https://your-app.vercel.app/*`, plus `https://your-app-*.vercel.app/*` for previews, keep localhost), and enable both **Maps JavaScript API** and **Places API**.

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

This section is the recommended end-to-end walkthrough for a live demo. It assumes **every** migration in `backend/migrations/` has been applied, in filename order — several steps below depend on ones later than `20260623_coorganisers.sql` (e.g. §13 needs `20260625_university_gating_and_capacity.sql`, and the Analytics calculator needs `20260707_event_calculator.sql`).

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
- Payment is captured for real at pledge time — a Stripe off-session charge against the linked card, or a deduction from the in-app wallet. Refunded automatically if the event fails to greenlight by its deadline.
- A user cannot buy more tickets for the same event while they still have active tickets.
- A user may give away some or all active tickets without a refund.
- Partial give-away remains in Joined Events > Upcoming.
- Full give-away moves that booking to Joined Events > Cancelled.
- After giving away all tickets, the user may buy available tickets again. The old cancelled booking remains in their history.
- Released tickets are made available at the current tier price. Once Greenlit pricing opens, pricing does not regress to Early Birds.
- Organisers cannot pledge for their own events.
- Pricing model choice (`Tiered` or `Hype curve`) is locked after event creation.
- Analytics gives organisers a **profit calculator** (not a predictor): pick an event, set ticket prices/quantities (respecting its hype or tiered model) and an editable list of operational-cost line items, and read off **profit = total revenue − total cost** — a guide for how many tickets to sell. Ticket prices in the calculator are hypothetical (they never change the live event); the state is saved per event (`EVENT_CALCULATOR`). Operational costs are paid outside party.fun. An on-demand **AI tips** panel suggests ways to sell more tickets.
- Completed greenlit events record a simulated ticket revenue payout to the organiser; operational costs are not deducted by the app.

## Event rules

- Pricing tiers (`PRICE_STATUSES.statusName`): `early_bird`, `greenlit`
- Event statuses (`EVENT.status`): `early_bird`, `greenlit`, `completed`, `cancelled`
- `hypeThreshold`: minimum active ticket count required to greenlight an event
- `maxCapacity`: maximum active ticket count allowed
- `activeTicketCount`, `hypePercentage`, and `spotsLeft` are derived values
- `hypePercentage = min(100, activeTicketCount / hypeThreshold * 100)`
- Pricing model (`EVENT_SETTINGS.hypeDrivenPricing`) is immutable once the event has been created.

### Roles

`USER.role` is one of three, and the split matters throughout the app (and is enforced in the DB, the API and the AI agent's `role_gate`, not just the UI):

| Role | Can | Cannot |
|---|---|---|
| **user** (attendee) | browse, pledge/buy, give away tickets, top up | create, edit or cancel any event |
| **organiser** | everything a user can, **plus** create/edit/cancel **their own** events, invite co-organisers, check people in, see analytics | pledge for their own events; touch another organiser's event (unless invited as a co-organiser, who may edit and view attendees but not cancel, delete or invite) |
| **admin** | **moderate**: edit and cancel/delete **any** event (a reason is mandatory), via `/manage-events` + `admin_cancel_event` | **create or host events**, and buy tickets |

Admin accounts are seeded with `node backend/scripts/seedAdmins.js`.

## Database (Supabase)

Data lives in Supabase Postgres, with RLS enabled on every table. The **core** tables:

- `USER`: profile rows, keyed to `auth.users.id` (role `user`, `organiser` or `admin`)
- `EVENT`: event identity, schedule, venue + coordinates, and lifecycle status
- `EVENT_SETTINGS`: hype threshold, maximum capacity, deadline, and the pricing model
- `PRICE_STATUSES`: Early Birds and Greenlit prices and capacities
- `BOOKINGS`: one payment/pledge transaction
- `BOOKING_ITEMS`: quantity and price breakdown for each booking (SQL-side only)
- `TICKETS`: individual ticket lifecycle records (`active` / `given_away` / `refunded` / `used`)

Plus, by feature: `WALLET_TRANSACTIONS` (the wallet ledger), `EVENT_DRAFTS` (unpublished events), `EVENT_CALCULATOR` (the per-event profit calculator state), `NOTIFICATION_LOGS` (email audit), the AI tables (`AI_CHAT_CONVERSATIONS`, `AI_CHAT_MESSAGES`, `AI_USER_MEMORY`) and the pgvector tables (`EVENT_EMBEDDINGS`, `EVENT_DRAFT_EMBEDDINGS`). `EVENT` also carries a generated `searchVector` (`tsvector`) column for the keyword half of hybrid search.

The business logic (pledge allocation across tiers, hype recalculation, give-away, soft delete, event CRUD, expiry, ticket revenue payout) lives in Postgres **RPC functions**, all `SECURITY DEFINER` and using `auth.uid()` where user context is required — so they run safely whether called by the frontend or by the backend on the user's behalf. The ones you'll meet first: `get_events`, `get_profile`, `get_quote`, `create_pledge`, `give_away_tickets`, `soft_delete_booking`, `create_event`, `update_event`, `delete_event`, `cancel_event`, `expire_overdue_events`, `complete_due_events`, `wallet_topup`. There are ~34 in total — also co-organiser invites (`invite_coorganiser`, `respond_coorganiser_invite`), check-in (`check_in_ticket`, `check_in_booking`), admin moderation (`admin_cancel_event`), analytics/attendee reads, and the `match_*` pgvector search functions. Grep `\.rpc\('` under `backend/` for the current list.

> **Migrations** live in [backend/migrations/](backend/migrations/) and must be applied **in filename order** — several `CREATE OR REPLACE` an earlier definition. Note that `CREATE OR REPLACE FUNCTION` never drops *other* signatures, so a migration that changes a function's parameters must `DROP` the old overloads explicitly or PostgREST (which resolves by named argument) may bind the wrong one.

## Main API routes

The backend exposes the data layer. Each request must include the Supabase access token as `Authorization: Bearer <token>`; the backend validates it and forwards it to Supabase (so RLS applies).

This is a **representative** selection, not the full surface (~50 routes). The mounted routers are in [backend/server.js](backend/server.js) and each one's routes in [backend/routes/](backend/routes/) — read those for the authoritative list.

| Router | Representative routes |
|---|---|
| `/api/events` | `GET /` and `GET /:eventId` (both public, guests allowed) · `GET /search?q=` (semantic) · `GET /:eventId/attendees` |
| `/api/checkout` | `GET /:eventId/quote?qty=1` · `POST /:eventId/pledge` |
| `/api/profile` | `GET /` · `POST /bookings/:bookingId/give-away` · `DELETE /bookings/:bookingId` |
| `/api/hosted-events` | organiser CRUD (`POST /events`, `PATCH /events/:eventId`, `DELETE /events/:eventId`), drafts, co-organiser invites, check-in, hide (~17 routes) |
| `/api/wallet` | `POST /setup-intent` (link a card) · `GET`/`DELETE /card` · `POST /topup` |
| `/api/tickets` | ticket + QR PDF, incl. `GET /by-token/:qrToken/pdf` — **unauthenticated by design** (the QR in the emailed ticket is the credential, so a scanner can fetch it without a session) |
| `/api/ai` | the assistant: `POST /chat`, `POST /chat/resume` (confirm/reject a proposal), conversation history, inline helpers (~15 routes) |
| `/api/analytics` | organiser analytics + the profit calculator state |
| `/api/admin` | admin-only moderation (`/license`, `/license/pdf`) |
| `/api/weather` | `GET /?eventId=…` or `?lat=&lon=&start=&end=` — rain assessment for an event window |
| `/api/notifications`, `/api/confirmation`, `/api/password-reset`, `/api/phone-login` | email audit, post-checkout confirmation, and the two OTP flows |

Login and registration are **not** backend routes — they go straight to Supabase Auth from the frontend. A request with no/invalid token to a protected route returns `401`.

## App structure (pages)

The concepts that matter most (there are ~27 pages in [frontend/src/app/pages/](frontend/src/app/pages/); routes are wired in `App.tsx`):

- **All Events (discovery)** — the public browse page listing events a user can **pledge for**: events they do **not** host that are still open (`early_bird` or `greenlit`; not `cancelled`/`completed`). "The cheapest / most expensive ticket I can buy" is computed over **this** list, **excluding** events the user has already purchased.
- **Hosted Events (organiser dashboard)** — an organiser's **own** events (created + co-organised), each with status, early-bird & greenlit prices, tickets sold, and hype threshold. Distinct from All Events, which is what everyone browses to buy.
- **Joined events** — events the user has pledged for (holds active tickets in).
- **Draft event** — an unpublished event saved in the organiser's Drafts tab, resumed and published later via the Create Event form. The AI assistant creates new events as drafts.
- **Event status** — `early_bird` (open, collecting pledges) → `greenlit` (hit its hype threshold; confirmed) → `completed` (finished, paid out); or `cancelled` (organiser cancelled, or missed threshold by deadline — all pledges refunded).

Other pages worth knowing: **Wallet** (`/wallet` — balance, linked card, top-ups, ledger), **Analytics** (`/analytics` — forecast + profit calculator + AI tips), **Check-in** (`/tickets` — scan a ticket QR), **All Attendees** (`/attendees`), **Pending Invites** (`/pending-invites` — co-organiser invitations), **Manage Events** (`/manage-events` — admin moderation), **Settings** (incl. changing your university), **Profile**, **Checkout**, **Confirmation**, **FAQ**, and the auth set (Google OAuth callback + onboarding, phone-OTP verify, forgot/reset password).

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

- **LangGraph workflow** — chat runs as one explicit `StateGraph` ([backend/services/ai/agent/eventGraph.js](backend/services/ai/agent/eventGraph.js)) that mirrors the whole workflow diagram: `scope → classify → role_gate → {answer | discover | bestfit | manage | transact | auto_draft} → (proposals?) confirm → execute → END`, with three refusal exits (`refuse` off-topic, `role_refuse`, `admin_create_refuse`).
  - **`scope`** guard runs first and strictly refuses off-topic questions (general knowledge, maths, coding, trivia) with a canned reply before any tool runs — greetings/thanks and anything event/ticket/wallet/hosting/weather/date related pass through.
  - **`classify`** node (an LLM call, regex fallback) tags the request's intent (read-only question · event discovery · cheapest/best-fit · event management · transaction) and routes to the matching branch.
  - **`role_gate`** sits on the mandatory path after `classify` and enforces the role rules deterministically rather than trusting the model: a regular **user** asking to create/edit/cancel gets `role_refuse`; an **admin** asking to create gets `admin_create_refuse` (admins moderate — they edit and cancel any event, but never host one).
  - Each **branch is its own canonical agent** — `createAgent(...)` from LangChain v1 (built on LangGraph), with a **scoped toolset** so a discovery branch can't move money, etc.
  - The **confirm step is a real human-in-the-loop `interrupt()`** persisted by an in-memory `MemorySaver` checkpointer: every write pauses the graph, returns the proposal + a `threadId`, and resumes via `POST /api/ai/chat/resume` when the user confirms/rejects.
  - The **`execute` node** applies confirmed proposals through the existing `executeAction` ([backend/services/ai/agent/actions.js](backend/services/ai/agent/actions.js)), which re-validates ownership/balances via RLS — so "execute in the graph" never trusts graph state for money.
- **Deterministic short-circuits (before the graph)** — a few high-frequency asks are answered in code rather than by the model, which mis-routed or mis-numbered them ([backend/services/ai/agent/listReplies.js](backend/services/ai/agent/listReplies.js), called from `aiController.chat`): the four plain list questions (events I can join / I've joined / **I've hosted** / live across organisers), linking a card (card details must never enter the chat), and a **named purchase**, where the event name is resolved server-side so a typo can't become an invented event ("game nigjt" → _Did you mean "Game night and escape rooms"?_).
  - **A short-circuit must only fire on the question it can actually answer.** These renderers can only dump every row in creation order, so anything *qualified* falls through to the LLM instead: a price cap, a quoted event name, a **superlative** ("which event did I host earliest?") or a request for **one fact** ("…and when?", "where did I host it?"). Getting this boundary wrong is the recurring bug in this file — twice now a short-circuit has answered a different question than the one asked.
  - **Asking about buying is not buying.** "Can I buy tickets for X after 1 August?" is a *question* — it falls through to the graph, which answers it from `get_event_details` (`isOpen` / `deadline` / `deadlinePassed` / `alreadyPurchased`) rather than starting a purchase. Only an actual request ("buy 2 tickets for X", "can you help me buy…") enters the buy flow. Both layers that decide this share one word-list ([buyIntent.js](backend/services/ai/agent/buyIntent.js)) — they previously kept private copies and drifted, so a question was parsed as a purchase for an event literally named "X after 1 August".
  - **"I can't find that" is only said when it's true.** A named event that exists but isn't buyable gets the real reason (you already hold tickets · it's your own event · it's cancelled/ended/started) instead of being denied — the buy check resolves against the wider *visible* pool when the narrower *attendable* one misses. "Did you mean …?" suggestions are deliberately strict (embedding floor 0.6, string-similarity 0.45): offering nothing beats offering a nonsense guess.
- **Chat assistant** (floating panel — draggable by its header, Shift+Enter for a newline, plain-text replies with no markdown, no emojis and no model caption) — it stays **strictly on events** (the scope guard declines unrelated questions, still greets), knows the current user's **role** and **today's date** (Singapore, injected each turn). Conversations are saved per user with a history list. Each branch gets a **scoped** subset of the tools below (`BRANCH_TOOLS`), plus a set of personal reads bound in *every* branch so an answer never depends on `classify` routing perfectly.

  **Read tools.** Every event-listing tool returns **full detail for every event it lists** — start **and end** date-time (so duration is derivable), venue, address, deadline, description, price, status and hype — so the agent can answer "where/when/how long/what's it about" without a second call:
  - `list_available_events` — the events you can **attend/buy**: hosted by someone else, open, **starting in the future**, **not already purchased**. Matches the All Events page exactly.
  - `search_events` — general lookup of one specific event by name (includes your own and already-purchased events).
  - `get_my_hosted_events` — your own events, plus **revenue so far**, tickets sold, hype and both tier prices.
  - `get_my_joined_events` — upcoming/past/cancelled with **tickets held per event**.
  - `list_live_events` — every live event across **all** organisers (works for admins, who have no "attendable" set).
  - `get_event_details` — the full record for one event, including the eligibility facts (`isOpen`, `deadlinePassed`, `soldOut`, `alreadyPurchased`, `canEdit`, …) that ground yes/no answers.
  - `get_event_forecast` (revenue + **profit**), `get_event_attendees` (who's coming + count), `get_wallet`, `list_my_drafts`, `get_current_date`.
  - `get_weather` — per-day rain forecast across the event's duration, at the venue's coordinates.
  - `research_event_ideas` — web research on student interests → name/description/rationale + a location suggestion.
  - `get_similar_past_events` — RAG over **completed** events, as historical benchmarks for pricing/capacity/revenue advice (never as current availability).

  **Write tools** — each creates a confirm-gated proposal:
  - `propose_update_event` — edit a **published** event in place (co-organisers and admins may too).
  - `propose_create_event` — save a **draft** with a tiered **or** hype pricing model; `propose_edit_draft` — change a still-unpublished draft (found via `list_my_drafts`); `propose_delete_draft` — delete one.
  - `propose_invite_coorganiser`.
  - `propose_cancel_event` — cancel/refund every backer. The reason is **optional for organisers** cancelling their own event (any informal reason is accepted, and none is fine) but **mandatory for admins** cancelling someone else's, for moderation accountability.
  - `propose_topup` — charge the linked card into the wallet.
  - `propose_pledge` — buy tickets paid by the **in-app wallet OR the linked card**; the agent confirms the event, then asks which payment method, then how many. On wallet it shows the total vs. balance and offers a card top-up for any shortfall.
  - `propose_give_away_tickets` — release N of your own tickets back to the pool.
- **Always confirm (no auto mode)** — every write pauses at the graph's `interrupt()`; the user confirms by button or by typing "confirm", or dismisses to reject. Execution re-validates server-side against ownership + balances; created events are saved as **drafts**; money moves reuse the same RLS/RPC-enforced paths as the wallet, give-away & cancellation UIs (`topupWallet` / `giveAwayTickets` / `cancelEventWithRefunds` services). "Delete this event" = cancel it with a reason (refunding backers) for a published event, or delete the draft for an unpublished one.
  - **Create flow:** for a new event the agent asks for a theme (or researches one), suggests a name/description/location from web research, recommends a tiered-vs-hype pricing model, and only drafts after the organiser confirms.
  - _Checkpointer note:_ `MemorySaver` is in-process, so pending confirmations are lost on a backend restart / don't span multiple instances — a lost pending confirm just means the user re-asks (nothing unsafe executes because `execute` re-validates).
- **Inline helpers** — "Suggest names/description" on Create Event, "Get AI revenue tips" on the analytics forecast card, and "Recommended for you" on the events page.
- **Memory (learns & adapts)** — a per-user store the agent reads to personalise and writes to via a `remember` tool (interests/budget for attendees; venue/theme/pricing preferences for organisers). It works silently in the background — injected into the agent's context each turn — with no user-facing panel.
- **Weather warnings** — the agent (and three UI surfaces) warn when an event's day has a **> 70% chance of rain** (unsuitable for outdoor events), using the Google Maps Platform **Weather API** (`GOOGLE_WEATHER_API_KEY`, called server-side; ~10-day horizon). Events store their **venue coordinates** (`EVENT.latitude`/`longitude`, captured from the AddressPicker on create/edit — so `VITE_GOOGLE_MAPS_API_KEY` is required for new events to get any — and returned by `get_events`), so the **Create/Edit Event** form, the **Event Details** page and the agent's `get_weather` tool all check the forecast at the exact venue. Events with no stored coordinates fall back to Singapore-wide weather. The columns, the `create_event`/`update_event` parameters and the `get_events` projection are defined in [backend/migrations/20260716_event_coordinates.sql](backend/migrations/20260716_event_coordinates.sql) — apply it, or every create/update fails and coordinates are always null. Exposed via `GET /api/weather` ([backend/controllers/weatherController.js](backend/controllers/weatherController.js), [backend/services/weatherService.js](backend/services/weatherService.js)). Degrades silently when the key is unset.
- **Hybrid RAG (full-text + vector)** — event retrieval fuses two rankings so both meaning *and* exact names work. The semantic half is Gemini text embeddings (`gemini-embedding-001`, 768-dim) in **Supabase pgvector** (`EVENT_EMBEDDINGS`); the keyword half is a Postgres **full-text `tsvector`** generated column on `EVENT` (weighted title > description > venue, GIN-indexed). `match_events_hybrid` combines them with **Reciprocal Rank Fusion** (k=60) — fixing pure-vector search's blind spot for proper nouns like a venue or exact title, which previously relied on substring fallbacks. Powers `recommend_events` (rank by the user's interests — "gaming" surfaces an arcade/esports night), `semantic_search_events` + the All Events search bar (`GET /api/events/search`), and `find_similar_events` ("more like this"), all via [eventSearch.js](backend/services/ai/eventSearch.js). Two-way graceful degradation: **no embedding → keyword-only** (so search still works when embeddings are off or an event isn't backfilled), and **RPC missing → vector-only** `match_events` (safe to deploy before [20260720_event_hybrid_search.sql](backend/migrations/20260720_event_hybrid_search.sql) is applied). The tsvector is a generated column, so it backfills itself and can never drift. Note the fused `score` only orders results — `similarity` stays the true cosine value that confidence gates read. The **For You** feed stays deliberately vector-only (its "query" is a long taste profile, where keyword fusion would just match common words). Event embeddings are refreshed on create/edit ([eventEmbeddings.js](backend/services/ai/eventEmbeddings.js)); backfill with `node scripts/backfillEmbeddings.js`. The assistant's help answers no longer use a chunk table — `app-knowledge.md` is read live as the single source of truth.
- **Web research** — `research_event_ideas` uses Gemini's built-in **Google Search grounding** ([backend/services/ai/agent/research.js](backend/services/ai/agent/research.js)) to find current university-student interests and suggest an event name, description, rationale and a location near the organiser's university; falls back to Gemini's built-in knowledge when grounding is unavailable.

Env keys (in `backend/.env`; `GEMINI_API_KEY` enables all AI features):

```
GEMINI_API_KEY=...        # Google Gemini (AI Studio, may start with AQ. or AIza) — powers the whole assistant
# AI_GEMINI_MODEL=gemini-2.5-flash   # optional model override (default gemini-2.5-flash)
GOOGLE_WEATHER_API_KEY=...# Google Maps Platform Weather API (server-side; enable "Weather API" in the same GCP project as Maps)
```

AI-owned tables (all RLS owner-only): `AI_CHAT_CONVERSATIONS`, `AI_CHAT_MESSAGES`, `AI_USER_MEMORY`, and `NOTIFICATION_LOGS` (email audit). The agent's internal knowledge base — how it should answer questions about the app — lives in [backend/services/ai/app-knowledge.md](backend/services/ai/app-knowledge.md); **keep that file updated alongside this README when the agent's behaviour or the app changes.**



