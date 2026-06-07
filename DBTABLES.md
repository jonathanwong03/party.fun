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
| status | text enum | **`early_bird` \| `greenlit` \| `cancelled`** — status and pricing tier are now one concept. Derived from hype: `greenlit` when active tickets ≥ hypeThreshold (100%), else `early_bird`; `cancelled` when cancelled. ("Past" events are derived from the end date, not a stored status.) |
| currentTierName | text enum | `early_bird` \| `greenlit` (mirrors `status`) |
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
| maxCapacity | int | hard ticket cap |
| deadline | timestamptz | hype deadline |
| createdAt / updatedAt | timestamptz | |

### `PRICE_TIERS` (many per EVENT)
| Column | Type | Notes |
|---|---|---|
| id | bigint (PK) | |
| eventId | uuid (FK → EVENT.id) | |
| tierName | text enum | `early_bird` \| `greenlit` (was `main_crowd`) |
| price | numeric | |
| ticketCapacity | int | tickets available at this tier |
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
| priceTierId | bigint (FK → PRICE_TIERS.id) | |
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

### Relations
```
AUTH_USERS 1──1 USER       (USER.id = AUTH_USERS.id)
USER 1──* EVENT            (EVENT.hostId)
USER 1──* BOOKINGS         (BOOKINGS.userId)
EVENT 1──1 EVENT_SETTINGS  (EVENT_SETTINGS.eventId)
EVENT 1──* PRICE_TIERS     (PRICE_TIERS.eventId)
EVENT 1──* BOOKINGS        (BOOKINGS.eventId)
BOOKINGS 1──* BOOKING_ITEMS (soft delete — booking is marked deletedAt, not removed)
BOOKINGS 1──* TICKETS       (soft delete — booking is marked deletedAt, not removed)
PRICE_TIERS 1──* BOOKING_ITEMS (BOOKING_ITEMS.priceTierId)
BOOKING_ITEMS 1──* TICKETS  (TICKETS.bookingItemId)
```

---

## 2. Fields that drive the cancellation / delete feature

- **`EVENT.status = 'cancelled'`** (+ `cancelledAt`, `cancellationReason`) — event-level cancellation. Such an event is **unavailable for everyone**: hidden from All Events, no pledge button (replaced with red "Event unavailable"), no re-pledge.
- **Buyer give-away** — when all of a user's tickets for an event have `TICKETS.status = 'given_away'` (booking `activeTicketCount = 0`), that event is treated as cancelled **for that user** (same unavailable behaviour).
- A booking is classified into a Joined Events tab as: `cancelled` if `EVENT.status='cancelled'` OR the booking has no active tickets; else `past` if the event's **end date is in the past**; else `upcoming`. Bookings with `deletedAt` set are excluded from all tabs. (There is no `completed` status anymore — "Past" is derived from the end date.)
- **Delete from Cancelled/Past tab** = **soft delete**. `ON DELETE CASCADE` is a *hard*-delete mechanism (deleting a parent row auto-deletes its child `TICKETS`/`BOOKING_ITEMS` in the same statement); we no longer use it. Instead the delete is an `UPDATE "BOOKINGS" SET "deletedAt" = now() WHERE id = $1 AND "userId" = $2;` and every read filters `deletedAt IS NULL`. The row (and its tickets/items) stays for audit/recovery; the soft-deleted booking is also excluded from hype/spot counts.

---

## 3. Exact Supabase change-list

Current Supabase tables (all empty): `USER, EVENT, EVENT_SETTINGS, PRICE_TIERS, BOOKINGS, TICKETS`.

### Add a new table
- **`BOOKING_ITEMS`** — `id bigint identity PK`, `bookingId bigint FK→BOOKINGS.id`, `priceTierId bigint FK→PRICE_TIERS.id`, `quantity int`, `unitPrice numeric`, `subtotal numeric`, `created_at timestamptz default now()`.

### Add columns
- **`USER`**: add `username text unique`, `role text` (`user`/`organiser`), `contact text null`, `socialLink text null`.
- **`EVENT`**: add `startDate timestamptz`, `endDate timestamptz`, `imageUrl text`, `currentTierName text`, `greenlitAt timestamptz null`, **`cancelledAt timestamptz null`**, **`cancellationReason text null`**, `updatedAt timestamptz`.
- **`EVENT_SETTINGS`**: add `maxCapacity int` (replaces `hardCapacity`), `updatedAt timestamptz`.
- **`PRICE_TIERS`**: add `tierName text`, `ticketCapacity int`.
- **`BOOKINGS`**: add `refundedAmount numeric default 0`, `capturedAt timestamptz`, `refundedAt timestamptz null`, **`deletedAt timestamptz null`** (soft-delete marker), `updatedAt timestamptz`.
- **`TICKETS`**: add `bookingItemId bigint FK→BOOKING_ITEMS.id`, **`status text`** (`active`/`used`/`given_away`/`refunded`, default `active`), `givenAwayAt timestamptz null`, `refundedAt timestamptz null`, `usedAt timestamptz null`.

### Delete behaviour (soft delete — no cascade needed)
- Deleting a booking is an **`UPDATE "BOOKINGS" SET "deletedAt" = now() WHERE id = $1 AND "userId" = $2;`** — not a `DELETE`. Every read filters `WHERE "deletedAt" IS NULL`.
- The `TICKETS.bookingId` / `BOOKING_ITEMS.bookingId` FKs can stay plain (`NO ACTION`/`RESTRICT`); **`ON DELETE CASCADE` is not required** because rows are never physically removed. (Add cascade only if you later introduce a true purge job.)

### Columns to remove (only if fully aligning to the mock model — optional)
- **`USER.walletBalance`** — unused by the app.
- **`PRICE_TIERS.tierNumber`, `PRICE_TIERS.minBookingsRequired`** — superseded by `tierName` / `ticketCapacity`. (Note: `tierNumber` is currently part of the composite PK — adjust the PK to `id` only before dropping.)
- **`EVENT_SETTINGS.hardCapacity`** — superseded by `maxCapacity`.
- **`EVENT.date`** — superseded by `startDate` / `endDate`.
- **`TICKETS.userId`** — redundant; the owner is reachable via `bookingId → BOOKINGS.userId` (keep if you prefer a denormalised shortcut).

> No column needs to be removed *for the feature itself* — it only requires the cancellation fields (already partly present via `EVENT.status`) and the new **`BOOKINGS.deletedAt`** column for soft delete.

---

## 4. Full migration plan — Supabase in charge of authentication (+ data)

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

### 4.3 RLS policies (enable on every table; use `auth.uid()`)
```sql
create policy user_read   on public."USER"  for select using (true);
create policy user_update on public."USER"  for update using (auth.uid() = id);
create policy event_read  on public."EVENT" for select using (true);
create policy event_write on public."EVENT" for all
  using (auth.uid() = "hostId") with check (auth.uid() = "hostId");
-- EVENT_SETTINGS / PRICE_TIERS: read true; write where parent EVENT.hostId = auth.uid()
create policy booking_owner on public."BOOKINGS" for all
  using (auth.uid() = "userId") with check (auth.uid() = "userId");
-- BOOKING_ITEMS / TICKETS: scoped via their booking's userId
```
Transactional flows (pledge tier-allocation, hype recalculation, give-away, soft-delete) become **Postgres RPC functions** (`security definer`) so invariants match `eventMemoryService.js` while RLS guards direct access.

### 4.4 Seed + demo accounts
- Apply §3 change-list + the trigger (4.1) + policies (4.3).
- Create the two demo accounts in **Supabase Auth** (dashboard → Authentication → Add user, or the admin API — the read-only MCP **cannot** create `auth.users`): Jamie (`role: user`) and the organiser (`role: organiser`), each with a password. Note their UUIDs.
- Seed `EVENT/EVENT_SETTINGS/PRICE_TIERS` from `backend/data/*.js`; seed demo `BOOKINGS/BOOKING_ITEMS/TICKETS` against the demo UUIDs.
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
