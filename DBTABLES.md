# party.fun — Database Tables & Schema

This document describes the **authoritative data model** for party.fun, the lifecycle/cancellation fields that drive the "cancelled event is unavailable + delete from Joined Events" feature, the **exact schema change-list** to bring the (empty, divergent) Supabase project in line with it (§3), and the **full migration plan for when Supabase takes over user authentication and data** (§4).

> The live app currently runs on the in-memory Express mock backend (`backend/data/*.js` + `backend/services/eventMemoryService.js`). The mock model below is the richer, correct model, and it already **simulates the Supabase-auth split**: credentials live in `AUTH_USERS` (`mockAuthUsers.js`) and the `USER` profile has no `passwordHash`. The Supabase project exists but is empty and its schema diverges. (This file supersedes the old `DBV2TABLES.md`.)

---

## 1. Authoritative data model

### `AUTH_USERS` (simulates Supabase `auth.users`)
Credentials only — mirrors how Supabase Auth stores identities separately from the profile. The mock backend reads this on login (`mockAuthUsers.js`). In real Supabase this is the managed `auth.users` table and `id` is a UUID.
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | matches `USER.id` 1:1 |
| email | text | unique |
| passwordHash | text | bcrypt (managed by Supabase Auth in production) |

### `USER` (profile)
Profile of `AUTH_USERS` — **no `passwordHash`** (credentials live in `AUTH_USERS`). `id` equals the auth id.
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | = `AUTH_USERS.id` (FK 1:1) |
| name | text | Full name |
| username | text | Unique login handle |
| email | text | Unique (mirror of `AUTH_USERS.email`) |
| role | text enum | `user` \| `organiser` |
| contact | text \| null | e.g. `@jamiet` |
| socialLink | text \| null | |
| createdAt | timestamptz | |

### `EVENT`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| hostId | uuid (FK → USER.id) | Organiser |
| title | text | |
| description | text | |
| location | text | |
| startDate | timestamptz | |
| endDate | timestamptz | |
| imageUrl | text | |
| status | text enum | **`early_bird` \| `greenlit` \| `completed` \| `cancelled`** — status and pricing status are one concept. Derived: `cancelled` if cancelled; else `completed` if the end date has passed (grey); else `greenlit` when active tickets ≥ hypeThreshold (100%); else `early_bird`. There is **no `currentTierName`** — the active price status is derived from `status`/hype. |
| greenlitAt | timestamptz \| null | |
| **cancelledAt** | timestamptz \| null | set when status → cancelled |
| **cancellationReason** | text \| null | e.g. `organiser_cancelled` |
| createdAt / updatedAt | timestamptz | |

### `EVENT_SETTINGS` (1–1 with EVENT)
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| eventId | uuid (FK → EVENT.id) | |
| hypeThreshold | int | min active tickets to confirm |
| maxCapacity | int | hard ticket cap ($C$ in the bonding curve) |
| deadline | timestamptz | hype deadline |
| **hypeDrivenPricing** | boolean | default `false`; when true, quotes use the bonding curve instead of static `PRICE_STATUSES` |
| **basePrice** | numeric \| null | $P_{base}$ — starting ticket price at active count zero; required when `hypeDrivenPricing = true` |
| **maxPrice** | numeric \| null | $P_{max}$ — peak ticket price at full capacity; required when `hypeDrivenPricing = true` |
| createdAt / updatedAt | timestamptz | |

**Constraint (when `hypeDrivenPricing = true`):** `basePrice < maxPrice` and both must be `> 0`. Enforced in Postgres and in `backend/utils/pricingCalculator.js` (`validateHypePricingConfig`).

```sql
alter table public."EVENT_SETTINGS"
  add column if not exists "hypeDrivenPricing" boolean not null default false,
  add column if not exists "basePrice" numeric,
  add column if not exists "maxPrice" numeric;

alter table public."EVENT_SETTINGS"
  add constraint event_settings_hype_pricing_bounds
  check (
    "hypeDrivenPricing" = false
    or (
      "basePrice" is not null
      and "maxPrice" is not null
      and "basePrice" > 0
      and "maxPrice" > 0
      and "basePrice" < "maxPrice"
    )
  );
```

### `PRICE_STATUSES` (many per EVENT — was `PRICE_TIERS`)
The two price points an event sells through. One-to-many child of EVENT (can't be columns on EVENT).
| Column | Type | Notes |
|---|---|---|
| id | bigint (PK) | |
| eventId | uuid (FK → EVENT.id) | |
| statusName | text enum | `early_bird` \| `greenlit` (was `tierName` / `main_crowd`) |
| price | numeric | |
| ticketCapacity | int | tickets available at this status |
| createdAt | timestamptz | |

### `BOOKINGS` (a pledge/checkout)
| Column | Type | Notes |
|---|---|---|
| id | bigint (PK) | |
| userId | uuid (FK → USER.id) | |
| eventId | uuid (FK → EVENT.id) | |
| amountPaid | numeric | |
| refundedAmount | numeric | default 0 |
| status | text enum | `captured` \| `given_away` \| `partially_given_away` |
| capturedAt | timestamptz | |
| refundedAt | timestamptz \| null | |
| **deletedAt** | timestamptz \| null | **soft-delete marker: NULL = live, a timestamp = deleted (hidden from the user, kept for audit/recovery)** |
| createdAt / updatedAt | timestamptz | |

### `BOOKING_ITEMS` (per-tier line items of a booking)
| Column | Type | Notes |
|---|---|---|
| id | bigint (PK) | |
| bookingId | bigint (FK → BOOKINGS.id) | cascade no longer required — see soft-delete note below |
| priceStatusId | bigint (FK → PRICE_STATUSES.id) | was `priceTierId` |
| quantity | int | |
| unitPrice | numeric | |
| subtotal | numeric | |
| createdAt | timestamptz | |

### `TICKETS` (one row per individual ticket)
| Column | Type | Notes |
|---|---|---|
| id | bigint (PK) | |
| bookingId | bigint (FK → BOOKINGS.id) | cascade no longer required — see soft-delete note below |
| bookingItemId | bigint (FK → BOOKING_ITEMS.id) | |
| qrCode | text | |
| status | text enum | **`active` \| `used` \| `given_away` \| `refunded`** |
| givenAwayAt | timestamptz \| null | |
| refundedAt | timestamptz \| null | |
| usedAt | timestamptz \| null | |
| createdAt | timestamptz | |

### `notification_logs` (transactional email audit)
| Column | Type | Notes |
|---|---|---|
| id | bigint (PK) | identity |
| user_id | uuid \| null | FK → `USER.id` (recipient, when known) |
| recipient_email | text | intended recipient (not staging override address) |
| event_id | uuid \| null | FK → `EVENT.id` |
| notification_type | text enum | `pledge_confirmed` \| `tickets_given_away` \| `event_greenlit` |
| subject | text | email subject line |
| status | text enum | `sent` \| `mock_sent` \| `failed` |
| error_message | text \| null | set when `status = failed` |
| sent_at | timestamptz \| null | set when `status` is `sent` or `mock_sent` |
| created_at | timestamptz | default `now()` |

### Relations
```
AUTH_USERS 1──1 USER       (USER.id = AUTH_USERS.id)
USER 1──* EVENT            (EVENT.hostId)
USER 1──* BOOKINGS         (BOOKINGS.userId)
EVENT 1──1 EVENT_SETTINGS  (EVENT_SETTINGS.eventId)
EVENT 1──* PRICE_STATUSES  (PRICE_STATUSES.eventId)
EVENT 1──* BOOKINGS        (BOOKINGS.eventId)
BOOKINGS 1──* BOOKING_ITEMS (soft delete — booking is marked deletedAt, not removed)
BOOKINGS 1──* TICKETS       (soft delete — booking is marked deletedAt, not removed)
PRICE_STATUSES 1──* BOOKING_ITEMS (BOOKING_ITEMS.priceStatusId)
BOOKING_ITEMS 1──* TICKETS  (TICKETS.bookingItemId)
```

---

## 2. Fields that drive the cancellation / delete feature

- **`EVENT.status = 'cancelled'`** (+ `cancelledAt`, `cancellationReason`) — event-level cancellation. Such an event is **unavailable for everyone**: hidden from All Events, no pledge button (replaced with red "Event unavailable"), no re-pledge.
- **Buyer give-away** — when all of a user's tickets for an event have `TICKETS.status = 'given_away'` (booking `activeTicketCount = 0`), that event is treated as cancelled **for that user** (same unavailable behaviour).
- A booking is classified into a Joined Events tab as: `cancelled` if `EVENT.status='cancelled'` OR the booking has no active tickets; else `past` if the event's **end date is in the past** (i.e. `status='completed'`); else `upcoming`. Bookings with `deletedAt` set are excluded from all tabs. `completed` is the derived status for events whose end date has passed (shown grey).
- **Delete from Cancelled/Past tab** = **soft delete**. `ON DELETE CASCADE` is a *hard*-delete mechanism (deleting a parent row auto-deletes its child `TICKETS`/`BOOKING_ITEMS` in the same statement); we no longer use it. Instead the delete is an `UPDATE "BOOKINGS" SET "deletedAt" = now() WHERE id = $1 AND "userId" = $2;` and every read filters `deletedAt IS NULL`. The row (and its tickets/items) stays for audit/recovery; the soft-deleted booking is also excluded from hype/spot counts.

---

## 3. Exact Supabase change-list

**Verified against the live project** (all tables empty / 0 rows, RLS enabled, **no policies**). Current columns:
- `USER(id uuid pk [default gen_random_uuid()], created_at, name, email unique, passwordHash, walletBalance)`
- `EVENT(id uuid pk, created_at, hostId uuid [default gen_random_uuid()], title, description, date, location, status)`
- `EVENT_SETTINGS(id uuid pk, created_at, hypeThreshold, deadline, hardCapacity, eventId)`
- `PRICE_TIERS(id bigint, created_at, eventId, tierNumber, price, minBookingsRequired)` — composite PK `(id, tierNumber)`
- `BOOKINGS(id bigint pk, created_at, userId, eventId, amountPaid, status)`
- `TICKETS(id bigint pk, created_at, bookingId, userId, qrCode)`
- **No `BOOKING_ITEMS` table.**

### Rename a table
- **`PRICE_TIERS` → `PRICE_STATUSES`**. It has **no `tierName` column today**; instead drop `tierNumber` + `minBookingsRequired` and add `statusName` + `ticketCapacity` (below). Change the **PK from composite `(id, tierNumber)` → `(id)`** first (so `tierNumber` can be dropped).

### Add a new table
- **`BOOKING_ITEMS`** — `id bigint identity PK`, `bookingId bigint`, `priceStatusId bigint`, `quantity int`, `unitPrice numeric`, `subtotal numeric`, `created_at timestamptz default now()` (foreign keys listed below).

### Add columns
- **`USER`**: add `username text unique`, `role text` (`user`/`organiser`, default `user`), `contact text null`, `socialLink text null`. **Drop the `gen_random_uuid()` default on `id`** — it must equal `auth.users.id` (set by the signup trigger, §4.1).
- **`EVENT`**: add `startDate timestamptz`, `endDate timestamptz`, `imageUrl text`, `greenlitAt timestamptz null`, **`cancelledAt timestamptz null`**, **`cancellationReason text null`**, `updatedAt timestamptz`. **Do not add `currentTierName`** — status is derived. `status` is `early_bird|greenlit|completed|cancelled`. Also **drop the stray `gen_random_uuid()` default on `hostId`** (it's the organiser's id).
- **`EVENT_SETTINGS`**: add `maxCapacity int` (replaces `hardCapacity`), `updatedAt timestamptz`.
- **`PRICE_STATUSES`**: add `statusName text`, `ticketCapacity int`.
- **`BOOKINGS`**: add `refundedAmount numeric default 0`, `capturedAt timestamptz`, `refundedAt timestamptz null`, **`deletedAt timestamptz null`** (soft-delete marker), `updatedAt timestamptz`.
- **`TICKETS`**: add `bookingItemId bigint`, **`status text`** (`active`/`used`/`given_away`/`refunded`, default `active`), `givenAwayAt timestamptz null`, `refundedAt timestamptz null`, `usedAt timestamptz null`.

### Foreign keys (the complete target set)
Already present (keep): `EVENT.hostId→USER.id`, `EVENT_SETTINGS.eventId→EVENT.id`, `BOOKINGS.userId→USER.id`, `BOOKINGS.eventId→EVENT.id`, `TICKETS.bookingId→BOOKINGS.id`, and `PRICE_TIERS.eventId→EVENT.id` (becomes `PRICE_STATUSES.eventId→EVENT.id` after the rename).
**Add:**
- `USER.id → auth.users(id)` **ON DELETE CASCADE** (profile ↔ auth identity, 1:1).
- `BOOKING_ITEMS.bookingId → BOOKINGS.id`
- `BOOKING_ITEMS.priceStatusId → PRICE_STATUSES.id`
- `TICKETS.bookingItemId → BOOKING_ITEMS.id`
**Remove:** `TICKETS.userId → USER.id` (drop the column — owner is reachable via `bookingId → BOOKINGS.userId`).

### Delete behaviour (soft delete — no cascade needed)
- Deleting a booking is an **`UPDATE "BOOKINGS" SET "deletedAt" = now() WHERE id = $1 AND "userId" = $2;`** — not a `DELETE`. Every read filters `WHERE "deletedAt" IS NULL`.
- The booking-child FKs (`TICKETS.bookingId`, `BOOKING_ITEMS.bookingId`) can stay plain (`NO ACTION`/`RESTRICT`); **`ON DELETE CASCADE` is not required** because rows are never physically removed. (The one cascade that IS recommended is `USER.id → auth.users(id)`, so deleting an auth user removes its profile.)

### Columns to remove
- **`USER.passwordHash`** — credentials live in `auth.users` once Supabase Auth is in charge.
- **`USER.walletBalance`** — unused by the app.
- **`PRICE_STATUSES.tierNumber`, `PRICE_STATUSES.minBookingsRequired`** (old `PRICE_TIERS` columns) — superseded by `statusName` / `ticketCapacity` (fix the PK to `id` first).
- **`EVENT_SETTINGS.hardCapacity`** — superseded by `maxCapacity`.
- **`EVENT.date`** — superseded by `startDate` / `endDate`.
- **`TICKETS.userId`** — see FK section.

### Optional hardening
- `status`-type columns are plain `text` today. Optionally add CHECK constraints: `EVENT.status ∈ (early_bird,greenlit,completed,cancelled)`, `PRICE_STATUSES.statusName ∈ (early_bird,greenlit)`, `BOOKINGS.status ∈ (captured,given_away,partially_given_away)`, `TICKETS.status ∈ (active,used,given_away,refunded)`.

---

## 4. Full migration plan — Supabase in charge of authentication (+ data)

> **This is the recommended implementation plan.** Apply §3 (schema), then follow 4.1→4.7 in order, on a branch, verifying each stage. Two steps are **dashboard-only** (the read-only MCP can't do them): creating the demo `auth.users` accounts (§4.4) and turning **off email confirmation** in Authentication settings.

Goal: move **both** auth and data off the Express mock and onto Supabase. After this, login/register/session run through Supabase Auth, all tables live in Supabase with RLS, and the Express backend is retired. The mock already mirrors the target shape (`AUTH_USERS` ↔ `USER` profile), so this is mostly wiring + policies + seed.

### 4.1 Auth model
- Supabase Auth owns the **`auth.users`** table (the real version of our `AUTH_USERS` sim). `public.USER` is a 1:1 profile whose `id = auth.users.id`, with `role` (`user` | `organiser`).
- A signup trigger creates the profile automatically:
```sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public."USER" (id, email, name, username, role, "createdAt")
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
          coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
          coalesce(new.raw_user_meta_data->>'role', 'user'),
          now());
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
```
- Frontend passes role at signup: `supabase.auth.signUp({ email, password, options: { data: { name, username, role } } })`.

### 4.2 Will roles still be recognised? (Yes)
- Jamie is recreated in Supabase Auth with `role: 'user'`, the organiser with `role: 'organiser'`. The trigger writes matching `USER` profile rows. On login the app reads the profile (or JWT metadata) → `role` resolves exactly as today (user view vs Hosted Events), and seeded events/bookings reference the same UUIDs so My/Joined/Hosted Events populate correctly.

### 4.3 RLS policies (the complete set)

RLS must be **enabled** on every table (already true in the project) **and** each table needs explicit policies — RLS on with no policy blocks all anon/authenticated access. Policies use `auth.uid()` and apply to the `anon` (logged-out) and `authenticated` (logged-in) roles.

```sql
-- 0. Enable RLS (already enabled in this project)
alter table public."USER"           enable row level security;
alter table public."EVENT"          enable row level security;
alter table public."EVENT_SETTINGS" enable row level security;
alter table public."PRICE_STATUSES" enable row level security;
alter table public."BOOKINGS"       enable row level security;
alter table public."BOOKING_ITEMS"  enable row level security;
alter table public."TICKETS"        enable row level security;

-- USER (profile): anyone may read (organiser names show publicly); you edit only your own.
create policy user_read   on public."USER" for select using (true);
create policy user_update on public."USER" for update using (auth.uid() = id);
-- No INSERT policy needed: the handle_new_user() trigger is SECURITY DEFINER and bypasses RLS.

-- EVENT: public read; an organiser writes only events they host.
create policy event_read  on public."EVENT" for select using (true);
create policy event_write on public."EVENT" for all
  using (auth.uid() = "hostId") with check (auth.uid() = "hostId");

-- EVENT_SETTINGS: public read; write only if you own the parent EVENT.
create policy settings_read  on public."EVENT_SETTINGS" for select using (true);
create policy settings_write on public."EVENT_SETTINGS" for all
  using (exists (select 1 from public."EVENT" e where e.id = "eventId" and e."hostId" = auth.uid()))
  with check (exists (select 1 from public."EVENT" e where e.id = "eventId" and e."hostId" = auth.uid()));

-- PRICE_STATUSES: public read; write only if you own the parent EVENT.
create policy status_read  on public."PRICE_STATUSES" for select using (true);
create policy status_write on public."PRICE_STATUSES" for all
  using (exists (select 1 from public."EVENT" e where e.id = "eventId" and e."hostId" = auth.uid()))
  with check (exists (select 1 from public."EVENT" e where e.id = "eventId" and e."hostId" = auth.uid()));

-- BOOKINGS: a user sees & manages only their own.
create policy booking_owner on public."BOOKINGS" for all
  using (auth.uid() = "userId") with check (auth.uid() = "userId");

-- BOOKING_ITEMS: scoped via the parent booking's owner.
create policy item_owner on public."BOOKING_ITEMS" for all
  using (exists (select 1 from public."BOOKINGS" b where b.id = "bookingId" and b."userId" = auth.uid()))
  with check (exists (select 1 from public."BOOKINGS" b where b.id = "bookingId" and b."userId" = auth.uid()));

-- TICKETS: scoped via the parent booking's owner.
create policy ticket_owner on public."TICKETS" for all
  using (exists (select 1 from public."BOOKINGS" b where b.id = "bookingId" and b."userId" = auth.uid()))
  with check (exists (select 1 from public."BOOKINGS" b where b.id = "bookingId" and b."userId" = auth.uid()));
```

Notes:
- **There is no built-in organiser/user Postgres role** — RLS enforces *ownership* (host owns events; buyer owns bookings). For a hard "only organisers may create events" rule, add to `event_write`'s check: `and exists (select 1 from public."USER" u where u.id = auth.uid() and u.role = 'organiser')`.
- **Transactional writes** (pledge allocation, hype recalculation, give-away, soft-delete) go through **`SECURITY DEFINER` RPC functions** so invariants match `eventMemoryService.js`; these policies remain the guardrail for any direct table access.
- **The service role bypasses RLS**, so seeding from the dashboard/admin works regardless of policies; policies only constrain the client (anon/authenticated) keys.

### 4.4 Seed + demo accounts
- Apply §3 change-list + the trigger (4.1) + policies (4.3).
- Create the two demo accounts in **Supabase Auth** (dashboard → Authentication → Add user, or the admin API — the read-only MCP **cannot** create `auth.users`): Jamie (`role: user`) and the organiser (`role: organiser`), each with a password. Note their UUIDs.
- Seed `EVENT/EVENT_SETTINGS/PRICE_STATUSES` from `backend/data/*.js`; seed demo `BOOKINGS/BOOKING_ITEMS/TICKETS` against the demo UUIDs.
- Turn **off email confirmation** in Auth settings (otherwise login is blocked until confirmed).

### 4.5 Frontend rewire (`frontend/src/app/`)
- **Auth** (`api.ts`, `App.tsx`, Login/Register pages): replace `/api/auth/*` calls with `supabase.auth.signInWithPassword` / `signUp` / `signOut`; drop the `role` state + `MOCK_USER_IDS` headers; derive `role`/`user` from the session + a `USER` profile read; keep in sync with `supabase.auth.onAuthStateChange` (replaces `resetUsers()` on load).
- **Data** (`api.ts` + `supabase.ts`, reuse `mapDbEventToEventItem`): `fetchEvents` → an `event_summary` view/RPC; `fetchProfile` → the user's non-deleted bookings; `createPledge`/`giveAwayTickets`/`deleteBooking` (soft delete) → RPCs; organiser create/edit/delete event → real Supabase writes (currently frontend-only state).
- **Env**: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (the anon key is safe to ship; rotate the dev token that leaked earlier).

### 4.6 Retire Express
Once reads/writes go to Supabase, `backend/` is no longer the source of truth: `authController.js`, `services/{userMemoryService,mockAuth,eventMemoryService}.js`, `data/*.js` become obsolete.

### 4.7 Staged execution + verification (do on a branch)
1. **Schema + auth**: apply change-list, trigger, RLS; create demo accounts + profiles. Verify a new organiser signup yields a `USER` row with `role='organiser'`.
2. **Reads**: point `fetchEvents`/`fetchProfile` at Supabase; verify browse + Joined Events + correct role view for Jamie/organiser.
3. **Writes**: pledge / give-away / soft-delete / event create+edit via RPCs; verify hype math, "Event unavailable", datetime validation.
4. **Cleanup**: stop calling Express; `npm run build`; app works with the backend stopped.
- DB checks: `list_tables` shows the v2 shape; `get_advisors` (security) shows RLS enabled with policies and no warnings.

### 4.8 Risks
- Multi-step rewrite — auth and data must move together (auth-only leaves UUIDs disconnected from mock data). Transactional pledge/hype logic must live in Postgres functions. Rotate the leaked dev token before relying on this.

---

## 5. Resolving the bugs you'll hit when switching to Supabase

Setting `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` **alone changes nothing** (the app talks to the Express mock; the Supabase client file was even removed). Bugs only appear once you actually point the app at Supabase. Each likely bug and its fix:

| Bug / symptom | Cause | Fix |
|---|---|---|
| App shows **no events/bookings** (empty lists) | RLS is enabled with **no policies**, so the anon key reads nothing | Add the RLS policies in §4.3 (public read for events/settings/statuses; owner-scoped bookings/tickets) |
| Event cards render with `undefined` price / hype / "Unknown organiser" | The frontend expects **computed fields** (`organiserName`, `activeTicketCount`, `hypePercentage`, `spotsLeft`, `currentPrice`, nested `statuses[]`) that aren't real columns | Create an `event_summary` **view or RPC** that returns those computed fields, and select from it |
| `role` is undefined → wrong routing / blank pages | No session wiring; role isn't read from a profile | Wire `supabase.auth` + `onAuthStateChange` in `App.tsx`; read `role` from the `USER` profile (created by the §4.1 trigger) |
| Logged-in user sees **someone else's** or **no** data | Identity mismatch: mock string ids vs Supabase UUIDs | Migrate auth + data together; seed bookings/events against the demo accounts' real UUIDs |
| `column ... does not exist` / `undefined` for `tierName`, `priceTierId`, `currentTierName` | DB still uses old names, or code still uses them | Use the **renamed** names everywhere: `PRICE_STATUSES`, `statusName`, `priceStatusId`, and **no** `currentTierName` (status is derived) |
| Signup succeeds but **login fails** | Supabase email-confirmation is on by default | Turn **off** email confirmation in Auth settings (or confirm via email) |
| Pledge/give-away/delete corrupt counts or race | Multi-row logic done client-side | Move pledge tier-allocation, hype recalculation, give-away and soft-delete into Postgres **RPC functions** (`security definer`) |
| Demo accounts can't be created from code | The read-only MCP can't write `auth.users` | Create Jamie + organiser via the Supabase **dashboard** (Authentication → Add user) with `role` in user metadata |

**Order to avoid them:** apply schema rename + trigger + RLS → create demo users → add the `event_summary` view/RPC → wire auth/session → repoint reads → repoint writes (RPCs) → retire Express. Verify after each step (`list_tables`, `get_advisors`).
