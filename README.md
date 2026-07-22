# party.fun

`party.fun` is a campus-event crowdfunding and ticketing prototype. Attendees pay when they pledge. An event becomes confirmed (greenlit) when its active ticket count reaches its hype threshold; if the deadline passes below that threshold, active tickets are refunded.

> **This file covers installing, running and deploying the app only.**
> For what the app does and how it works — architecture, features, domain rules, the API surface and the demo runbook — see **[APP_OVERVIEW.md](APP_OVERVIEW.md)**.

## Run locally

Both packages run together, in separate terminals.

### 1. Backend

The backend needs a `backend/.env` (gitignored) — see [backend/.env.example](backend/.env.example) for the full list:

```
SUPABASE_URL=<your Supabase project URL>
SUPABASE_ANON_KEY=<your Supabase anon / publishable key>
SUPABASE_SERVICE_ROLE_KEY=<service-role key>   # admin/scheduler/payment paths; omit and those degrade
# API_PORT=8000                                # optional; defaults to 8000 (PORT also honoured)
```

Only `SUPABASE_URL` + `SUPABASE_ANON_KEY` are needed to boot. Everything else (Redis, Stripe, Resend, Gemini, weather, Twilio) is feature-gated and degrades gracefully when unset — see [Optional services](#optional-services).

```powershell
cd "C:\smu heap\party.fun\backend"
npm install
npm run dev
```

### 2. Frontend

The frontend talks to Supabase Auth directly, so it needs a `frontend/.env` (gitignored) — see [frontend/.env.example](frontend/.env.example):

```
VITE_SUPABASE_URL=<your Supabase project URL>
VITE_SUPABASE_ANON_KEY=<your Supabase anon / publishable key>
VITE_GOOGLE_MAPS_API_KEY=<browser key with Maps JavaScript API + Places API enabled>
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...   # optional; unset = wallet-only checkout
```

```powershell
cd "C:\smu heap\party.fun\frontend"
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend health check: `http://localhost:8000/api/health`

The Vite dev server proxies `/api/*` to the backend on port `8000`.

**Two env gotchas that fail quietly:**

- Vite only exposes `VITE_`-prefixed variables, embeds them into the client bundle (so never put a secret there), and only reads `.env` at startup — (re)start the dev server after creating or changing it, otherwise login fails with `supabaseUrl is required`.
- `VITE_GOOGLE_MAPS_API_KEY` is easy to miss and its absence is silent: it powers the **AddressPicker** on Create/Edit Event (which captures the venue's latitude/longitude) and "How to get there" on Event Details. Without it the picker can't load, new events store no coordinates, and weather checks fall back to Singapore-wide instead of the venue's.

### Build

```powershell
cd "C:\smu heap\party.fun\frontend"
npm run build
```

## Optional services

Every service below is feature-gated: leave its keys unset and the app still runs, with that feature degraded or off. All go in `backend/.env` unless marked otherwise. For what each one actually does, follow the links into [APP_OVERVIEW.md](APP_OVERVIEW.md).

### Redis — [what it does](APP_OVERVIEW.md#redis-caching-rate-limiting-otp-storage)

Caching, cross-instance rate limiting, and short-lived OTP storage. Unset ⇒ per-process in-memory fallback (fine for a single dev instance).

```
REDIS_URL=rediss://default:<password>@<host>:<port>
```

> Use the TLS scheme `rediss://` (Upstash requires it). The URL itself is the credential — set it as a secret env var in production, never in a committed file.

### Stripe — [what it does](APP_OVERVIEW.md#payments--wallet-stripe-test-mode)

Wallet top-ups, card payments and refunds, in **Test mode** (no real money moves). Unset ⇒ card features disabled; wallet pledges still work.

```
# backend/.env
STRIPE_SECRET_KEY=sk_test_...
# frontend/.env  (restart Vite after adding)
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

Test card: `4242 4242 4242 4242`, any future expiry, any CVC. Decline: `4000 0000 0000 0002`.

### Resend — [what it does](APP_OVERVIEW.md#email-notifications-resend)

Transactional email. Unset ⇒ console "mock" mode (each email is printed instead of sent).

```
RESEND_API_KEY=re_...                         # from resend.com → API Keys
NOTIFICATION_FROM_EMAIL=onboarding@resend.dev # or an address on your verified Resend domain
NOTIFICATION_OVERRIDE_EMAIL=you@example.com   # dev: redirect ALL emails here (one address or a comma-separated list)
APP_BASE_URL=http://localhost:5173            # where email buttons link (set to your deployed URL in prod)
```

In development, set `NOTIFICATION_OVERRIDE_EMAIL` so every email — including those addressed to mock user addresses — lands in a real inbox you control. On Resend's free tier without a verified domain you can only send from `onboarding@resend.dev` to your own Resend account email, so the override should be (or include) that address.

### Twilio — [what it does](APP_OVERVIEW.md#phone-login-sms-otp-via-twilio)

SMS one-time codes for phone login. Unset ⇒ mock mode (the code is printed to the backend console).

```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SERVICE_SID=MG...
SMS_OVERRIDE_NUMBER=+65...   # dev: send every SMS here instead of the real number
```

### Google AI services — [what they do](APP_OVERVIEW.md#ai-event-planning-agent)

`GEMINI_API_KEY` enables the whole assistant; the other two are independent.

```
GEMINI_API_KEY=...          # Google AI Studio (may start with AQ. or AIza) — powers the whole assistant
# AI_GEMINI_MODEL=gemini-2.5-flash   # optional model override (default gemini-2.5-flash)
GOOGLE_WEATHER_API_KEY=...  # Google Maps Platform Weather API (enable "Weather API" in the same GCP project as Maps)
GOOGLE_SPEECH_API_KEY=...   # Google Cloud Speech-to-Text (enable "Cloud Speech-to-Text API") — the assistant's mic button
# GOOGLE_SPEECH_LANGUAGE=en-SG       # optional; defaults to en-SG
```

### Scheduler — [what it does](APP_OVERVIEW.md#deadline-processing-scheduler)

Runs automatically when `SUPABASE_SERVICE_ROLE_KEY` is set; otherwise it logs a warning and stays off.

```
DEADLINE_CHECK_INTERVAL_MS=300000   # how often to check (default 5 min)
```

## Tests

```powershell
cd "C:\smu heap\party.fun\backend"
npm test                   # unit tests (node:test, ~30 files) — no DB or API keys needed
npm run test:integration   # payment RPCs against a REAL Postgres
```

`npm test` uses Node's built-in runner and stubs every external service, so it runs offline and fast. The integration suite exercises the real `create_pledge` / `wallet_topup` RPCs (unique indexes, row locks, concurrency) which mocks can't cover; it **skips itself with a reason** unless all three keys below are set, so `npm test` stays green without them:

```
TEST_SUPABASE_URL=...
TEST_SUPABASE_SERVICE_ROLE_KEY=...   # creates/deletes auth users — see the warning
TEST_SUPABASE_ANON_KEY=...           # defaults to SUPABASE_ANON_KEY
```

> ⚠️ Point these at a **disposable Supabase branch** or a local `supabase start` database — never the production project. The suite creates and deletes auth users and rows.

## Deploying to the cloud

The reference deployment is **frontend on Vercel**, **backend on Render**, one **Supabase** project — all three have free tiers. Deploy in this order (the app is two packages in one repo, so each host points at a **subdirectory**).

### Step 1 — Supabase (database + auth)

1. Create a project at [supabase.com](https://supabase.com). From **Project Settings → API**, copy the **Project URL**, the **anon/publishable** key, and the **service-role** key (secret).
2. Apply **every** file in [backend/migrations/](backend/migrations/) **in filename order**, via the Supabase **SQL editor** (paste and run each in turn). Order matters and it is non-negotiable: several migrations `DROP`/recreate RPCs and *change their signatures*, and the backend calls them by name — a database that is behind (or ahead of) the code fails at runtime with **"Could not find the function public.<name>(…) in the schema cache"**. Always migrate Supabase *before* deploying the matching backend.

### Step 2 — Render (backend)

Create a new **Web Service** from this repo ([render.com](https://render.com) → New → Web Service) and set:

| Setting | Value |
|---|---|
| **Root Directory** | `backend` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` (runs `node server.js`) |

Render injects `PORT` automatically and the server honours it — no port config needed. Add the environment variables, mirroring [backend/.env.example](backend/.env.example):

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and **`SUPABASE_SERVICE_ROLE_KEY` (required in prod)** — card payments (`create_pledge_card`), wallet top-ups (`wallet_topup`), admin moderation, the deadline scheduler and Stripe refunds all run through the service-role client; without it wallet pledges work but **card/top-up throw**.
- `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_WEATHER_API_KEY`, and `APP_BASE_URL` (your deployed **frontend** URL, used for links in emails).

Deploy, then copy the service URL Render gives you (e.g. `https://your-backend.onrender.com`) — you need it in Step 3.

### Step 3 — Vercel (frontend)

Import the repo at [vercel.com](https://vercel.com) → New Project, and set:

| Setting | Value |
|---|---|
| **Root Directory** | `frontend` |
| **Framework Preset** | Vite (Build `vite build`, Output `dist`) |

**Point the frontend at your backend.** [frontend/vercel.json](frontend/vercel.json) proxies `/api/*` to a backend URL that is **hardcoded to this project's own Render service**. Edit it and replace that origin with your Step-2 Render URL — otherwise your deployed frontend silently calls the wrong backend:

```json
{ "source": "/api/:path*", "destination": "https://your-backend.onrender.com/api/:path*" }
```

Then add the four `VITE_` keys from [frontend/.env.example](frontend/.env.example): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_MAPS_API_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`. Deploy.

### Step 4 — Two dashboards outside the repo

These aren't code — miss them and auth/maps break only in production:

- **Supabase → Authentication → URL Configuration** (or Google/Facebook OAuth silently bounces users to `localhost`). Set **Site URL** to the deployed origin (e.g. `https://your-app.vercel.app`) and add `<origin>/auth/callback` to the **Redirect URLs** allow-list (keep `http://localhost:5173/auth/callback` for dev; `https://your-app-*.vercel.app/**` covers preview deploys). Supabase falls back to the Site URL whenever `redirectTo` isn't allow-listed — a localhost Site URL is what makes production OAuth land on localhost even though [frontend/src/app/api.ts](frontend/src/app/api.ts) already sends the correct `window.location.origin/auth/callback`.
- **Google Cloud → the Maps API key** (or address autocomplete returns *"not authorized … referer: …"*). Add the deployed origin to the key's **HTTP-referrer** allow-list (`https://your-app.vercel.app/*`, plus `https://your-app-*.vercel.app/*` for previews, keep localhost), and enable both **Maps JavaScript API** and **Places API**.

## Demo

Demo accounts, the seed/cleanup scripts and a 14-step walkthrough live in
[APP_OVERVIEW.md → Full demo runbook](APP_OVERVIEW.md#full-demo-runbook).
