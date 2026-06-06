# party.fun — Database & Migration Plan (v2: Supabase Auth + Data)

This document is the **target schema and migration plan** for moving party.fun off the in-memory Express mock and onto **Supabase** for both **authentication** and **data**. It supersedes [DBTABLES.md](DBTABLES.md) (kept as the mock-era reference).

> Status today: the app runs on the Express mock (`backend/`); the Supabase project exists but is **empty (0 rows)** with a schema that diverges from the working model. This plan brings Supabase to the v2 model and rewires the React app to use it directly via `@supabase/supabase-js` (client already in `frontend/src/app/supabase.ts`).

---

## 0. The core idea (why anything changes)
Supabase Auth stores identities in the managed **`auth.users`** table and exposes the current user id as **`auth.uid()`**. We therefore turn `public.USER` into a **profile table whose `id = auth.users.id`** (1:1), created automatically on signup by a trigger. Consequences:
- **`USER.passwordHash` is removed** — Supabase Auth owns credentials.
- All user FKs (`EVENT.hostId`, `BOOKINGS.userId`, `TICKETS.userId`) reference `public.USER.id`, which now equals the auth UUID.
- **Row Level Security (RLS)** policies (using `auth.uid()`) replace the old `X-Mock-Role` header trust.

---

## 1. Auth model

```
auth.users            (managed by Supabase — id uuid, email, encrypted_password, raw_user_meta_data, …)
  └─1:1─ public.USER  (profile; id = auth.users.id)
```

`public.USER` profile is populated by a trigger on signup:

```sql
-- Profile row is created automatically whenever a Supabase auth user is created.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public."USER" (id, email, name, username, role, "createdAt")
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'role', 'user'),
    now()
  );
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

---

## 1b. Interactions (runtime data flow)

How the pieces talk to each other once on Supabase. **Nothing has been applied yet — this is the target behaviour.**

**A. Sign up**
```
RegisterUser/RegisterOrganiser page
  → supabase.auth.signUp({ email, password, options:{ data:{ name, username, role } } })
  → Supabase inserts a row in auth.users
  → trigger on_auth_user_created fires
  → handle_new_user() inserts the matching public.USER profile (id = auth.users.id, role from metadata)
```

**B. Log in / session**
```
Login page → supabase.auth.signInWithPassword({ email, password })
  → Supabase returns a session (JWT) stored by the client
  → App.tsx reads the session; supabase.auth.onAuthStateChange keeps it in sync
  → role/profile come from a public.USER select (replaces the old X-Mock-Role header)
```
The JWT carries `auth.uid()`; every subsequent query is evaluated against the RLS policies in §3.

**C. Reading data (e.g. All Events, Joined Events)**
```
frontend → supabase.from('event_summary').select(...)        // public read policy
frontend → supabase.from('BOOKINGS').select(...)             // RLS: only rows where userId = auth.uid()
  → mapDbEventToEventItem() shapes rows into EventItem (already exists in supabase.ts)
```

**D. Writing data (pledge / give-away / delete / create-event)** — done through **RPCs** (Postgres functions, `security definer`) so multi-row invariants stay atomic and match `eventMemoryService.js`:
```
Pledge:      supabase.rpc('create_pledge',   { event_id, qty })
                → allocates tiers, inserts BOOKINGS + BOOKING_ITEMS + TICKETS, recomputes hype/status
Give away:   supabase.rpc('give_away_tickets', { booking_id, quantity })
                → flips TICKETS.status='given_away', updates BOOKINGS.status, recomputes hype
Delete:      supabase.rpc('delete_booking',  { booking_id })   // soft delete
                → sets BOOKINGS.deletedAt = now() (row kept; hidden from reads; excluded from hype)
Create/edit: supabase.from('EVENT').insert/update(...)         // RLS: only where hostId = auth.uid()
                + matching EVENT_SETTINGS / PRICE_TIERS rows
```

**E. Who is allowed to do what (enforced by RLS, §3)**
| Actor | EVENT / SETTINGS / TIERS | own BOOKINGS / TICKETS | others' BOOKINGS |
|---|---|---|---|
| Anonymous | read | — | — |
| Logged-in user | read | read + write (via RPC) | no access |
| Organiser | read all; write only `hostId = auth.uid()` | read + write own | no access |

The frontend passes `name`/`username`/`role` via `supabase.auth.signUp({ email, password, options: { data: { name, username, role } } })`.

---

## 2. Tables (v2 final shape)

### `USER` (profile of `auth.users`)
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | **FK → auth.users(id) ON DELETE CASCADE** (no longer self-generated) |
| name | text | |
| username | text unique | |
| email | text unique | mirror of `auth.users.email` |
| role | text enum | `user` \| `organiser` (default `user`) |
| contact | text \| null | |
| socialLink | text \| null | |
| createdAt | timestamptz | default now() |
| ~~passwordHash~~ | — | **removed** (Auth owns credentials) |
| ~~walletBalance~~ | — | **removed** (unused) |

### `EVENT`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | default gen_random_uuid() |
| hostId | uuid | FK → USER.id |
| title / description / location | text | |
| startDate / endDate | timestamptz | |
| imageUrl | text | |
| status | text enum | `pending` \| `greenlit` \| `cancelled` \| `completed` |
| currentTierName | text enum | `early_bird` \| `main_crowd` |
| greenlitAt / cancelledAt | timestamptz \| null | |
| cancellationReason | text \| null | |
| createdAt / updatedAt | timestamptz | |
| ~~date~~ | — | replaced by startDate/endDate |

### `EVENT_SETTINGS` (1–1 with EVENT)
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| eventId | uuid | FK → EVENT.id |
| hypeThreshold | int | = Early Birds tier quantity |
| maxCapacity | int | (replaces `hardCapacity`) |
| deadline | timestamptz | |
| createdAt / updatedAt | timestamptz | |

### `PRICE_TIERS` (many per EVENT)
| Column | Type | Notes |
|---|---|---|
| id | bigint identity (PK) | |
| eventId | uuid | FK → EVENT.id |
| tierName | text enum | `early_bird` \| `main_crowd` (replaces `tierNumber`) |
| price | numeric | |
| ticketCapacity | int | (replaces `minBookingsRequired`) |
| createdAt | timestamptz | |

### `BOOKINGS`
| Column | Type | Notes |
|---|---|---|
| id | bigint identity (PK) | |
| userId | uuid | FK → USER.id |
| eventId | uuid | FK → EVENT.id |
| amountPaid / refundedAmount | numeric | |
| status | text enum | `captured` \| `given_away` \| `partially_given_away` |
| capturedAt / refundedAt | timestamptz | |
| **deletedAt** | timestamptz \| null | **soft-delete marker (NULL = live)** |
| createdAt / updatedAt | timestamptz | |

### `BOOKING_ITEMS` (new table)
| Column | Type | Notes |
|---|---|---|
| id | bigint identity (PK) | |
| bookingId | bigint | FK → BOOKINGS.id |
| priceTierId | bigint | FK → PRICE_TIERS.id |
| quantity / unitPrice / subtotal | int/numeric | |
| createdAt | timestamptz | |

### `TICKETS`
| Column | Type | Notes |
|---|---|---|
| id | bigint identity (PK) | |
| bookingId | bigint | FK → BOOKINGS.id |
| bookingItemId | bigint | FK → BOOKING_ITEMS.id |
| qrCode | text | |
| status | text enum | `active` \| `used` \| `given_away` \| `refunded` |
| givenAwayAt / refundedAt / usedAt | timestamptz \| null | |
| createdAt | timestamptz | |
| ~~userId~~ | — | optional to drop (reachable via bookingId → BOOKINGS.userId) |

### Relations
```
auth.users 1──1 USER          (USER.id = auth.users.id)
USER 1──* EVENT               (EVENT.hostId)
USER 1──* BOOKINGS            (BOOKINGS.userId)
EVENT 1──1 EVENT_SETTINGS
EVENT 1──* PRICE_TIERS
EVENT 1──* BOOKINGS
BOOKINGS 1──* BOOKING_ITEMS   (soft delete — not physically removed)
BOOKINGS 1──* TICKETS         (soft delete — not physically removed)
PRICE_TIERS 1──* BOOKING_ITEMS
BOOKING_ITEMS 1──* TICKETS
```

---

## 3. RLS policies (enable on every table)

```sql
-- USER: anyone may read profiles (organiser names shown publicly); a user edits only their own.
create policy user_read    on public."USER" for select using (true);
create policy user_update  on public."USER" for update using (auth.uid() = id);

-- EVENT / EVENT_SETTINGS / PRICE_TIERS: public read; organiser writes only their own events.
create policy event_read   on public."EVENT" for select using (true);
create policy event_write  on public."EVENT" for all
  using (auth.uid() = "hostId") with check (auth.uid() = "hostId");
-- (settings/tiers: read true; write where the parent EVENT.hostId = auth.uid())

-- BOOKINGS / BOOKING_ITEMS / TICKETS: a user sees & manages only their own rows.
create policy booking_owner on public."BOOKINGS" for all
  using (auth.uid() = "userId") with check (auth.uid() = "userId");
-- (booking_items/tickets: scoped via their booking's userId)
```

> Transactional flows (pledge tier-allocation, hype recalculation, give-away, soft-delete) are implemented as **Postgres functions (RPC)** with `security definer` so they enforce the same invariants `eventMemoryService.js` does today, while RLS guards direct table access.

---

## 4. Exact Supabase change-list (current empty schema → v2)

**Add table**
- `BOOKING_ITEMS` (cols above).

**Add columns**
- `EVENT`: `startDate, endDate, imageUrl, currentTierName, greenlitAt, cancelledAt, cancellationReason, updatedAt`.
- `EVENT_SETTINGS`: `maxCapacity, updatedAt`.
- `PRICE_TIERS`: `tierName, ticketCapacity`.
- `BOOKINGS`: `refundedAmount, capturedAt, refundedAt, deletedAt, updatedAt`.
- `TICKETS`: `bookingItemId, status, givenAwayAt, refundedAt, usedAt`.
- `USER`: `username, role, contact, socialLink` (if not present).

**Repoint / constraints**
- `USER.id` → FK `auth.users(id) ON DELETE CASCADE`; stop defaulting to `gen_random_uuid()`.
- Add `handle_new_user()` trigger on `auth.users`.
- FKs `TICKETS.bookingId` / `BOOKING_ITEMS.bookingId` → `BOOKINGS.id` (plain — soft delete, no cascade).

**Drop**
- `USER.passwordHash`, `USER.walletBalance`.
- `EVENT_SETTINGS.hardCapacity` (→ maxCapacity).
- `PRICE_TIERS.tierNumber`, `PRICE_TIERS.minBookingsRequired` (adjust composite PK to `id` only first).
- `EVENT.date` (→ startDate/endDate).
- optional: `TICKETS.userId`.

**Enable**
- RLS policies in §3 on all tables.

**Seed**
- Port `backend/data/*.js` fixtures (events, settings, tiers, demo bookings/items/tickets).
- Create the two demo auth users (Jamie = `user`, organiser) via the Auth admin API with metadata so the trigger creates their profiles; reseed bookings against those UUIDs.

---

## 4b. How the current mock data tables change

Each in-memory fixture in `backend/data/*.js` maps to a Supabase table. "Live shape" = what the mock holds today; "→ v2" = what changes when it becomes a Supabase table. (Today's app reads these via `eventMemoryService.js`; after migration the data lives in Supabase and the fixtures are only used once, to seed.)

| Mock file | Supabase table | What changes (→ v2) |
|---|---|---|
| `mockUsers.js` | `USER` (+ `auth.users`) | **Biggest change.** Each mock user becomes an `auth.users` row (created via Auth) **plus** a `public.USER` profile with the **same UUID**. `passwordHash` is **dropped** from the profile (credentials move to `auth.users`). The string ids (`mock-user-jamie`, `host-nus-emc`, …) are replaced by real **UUIDs**; every reference below must use the new UUIDs. `id` now **FK → auth.users(id)**. |
| `mockEvents.js` | `EVENT` | Same columns; `hostId` now points at the user's **UUID** (not `host-nus-emc`). Keeps `startDate/endDate/status/currentTierName/greenlitAt/cancelledAt/cancellationReason`. No `date` column (already split). `id` stays uuid. |
| `mockEventSettings.js` | `EVENT_SETTINGS` | Unchanged shape (`hypeThreshold`, `maxCapacity`, `deadline`). `eventId` references the event UUID. |
| `mockPriceTiers.js` | `PRICE_TIERS` | Unchanged shape (`tierName`, `price`, `ticketCapacity`). `eventId` → event UUID. (Supabase's pre-existing `tierNumber`/`minBookingsRequired` columns are dropped in favour of these.) |
| `mockBookings.js` | `BOOKINGS` | Same shape **including `deletedAt`** (soft delete). `userId` → user UUID, `eventId` → event UUID. |
| `mockBookingItems.js` | `BOOKING_ITEMS` | New table in Supabase (didn't exist there). Shape unchanged (`bookingId`, `priceTierId`, `quantity`, `unitPrice`, `subtotal`). |
| `mockTickets.js` | `TICKETS` | Adds `bookingItemId`, `status`, `givenAwayAt`, `refundedAt`, `usedAt` (Supabase only had `bookingId/userId/qrCode`). `bookingId`/`bookingItemId` reference the seeded rows. `userId` optional (reachable via booking). |

**Net effect on identifiers:** the only structurally disruptive change is **user identity** — string mock ids → Supabase **UUIDs**, and `passwordHash` leaving the profile for `auth.users`. Events/settings/tiers/bookings/items/tickets keep their field shapes; their foreign keys just point at the new UUIDs once seeded. The mock model and the v2 model are otherwise the same 7 entities with the same relations.

> Important: the read-only Supabase MCP cannot create `auth.users` rows, so the demo accounts (Jamie = `user`, organiser) must be created via the Supabase **dashboard / Auth admin API**; the seed for `BOOKINGS`/`TICKETS` then uses those generated UUIDs.

## 5. Frontend rewire (`frontend/src/app/`)

**Auth** (`api.ts`, `App.tsx`, `pages/Login.tsx`, `pages/RegisterUser.tsx`, `pages/RegisterOrganiser.tsx`):
- Replace `loginRequest`/`registerRequest`/`resetUsers` (which POST `/api/auth/*`) with `supabase.auth.signInWithPassword`, `supabase.auth.signUp({…, options:{ data:{ name, username, role } }})`, `supabase.auth.signOut`.
- Drop the `role` state + `MOCK_USER_IDS` header scheme. Derive `role`/`user` from the **session** + a `public.USER` profile fetch; keep in sync with `supabase.auth.onAuthStateChange` (replaces the page-load `resetUsers`).

**Data layer** (`api.ts` + `supabase.ts`, reusing `mapDbEventToEventItem`):
- `fetchEvents` → select from an `event_summary` **view/RPC** (matches existing `EventSummaryRow`).
- `fetchProfile` → user's non-deleted bookings with derived `tab`/`activeTicketCount`.
- `createPledge` / `giveAwayTickets` / `deleteBooking` (soft delete = `update deletedAt`) → Supabase RPCs holding the transactional logic.
- Organiser create/edit/delete event (today **frontend-only** React state via `addEvent`/`updateEvent`/`deleteEvent`) → real Supabase inserts/updates so events persist.

**Env**: set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

---

## 6. Retire the Express backend
After the frontend reads/writes Supabase, `backend/` (auth + data routes) is no longer the source of truth. Default: keep it for reference but stop calling it; the obsolete files are `backend/controllers/authController.js`, `backend/services/{userMemoryService,mockAuth,eventMemoryService}.js`, `backend/data/*.js`.

---

## 7. Suggested execution order (do on a branch, verify each stage)
1. **Schema + auth**: apply migrations (§2/§4), trigger (§1), RLS (§3); create demo auth users + profiles.
2. **Reads**: point `fetchEvents`/`fetchProfile` at Supabase; verify browse + Joined Events.
3. **Writes**: pledge / give-away / soft-delete / event create+edit via RPCs; verify flows + datetime validation + "Event unavailable".
4. **Cleanup**: stop using the Express backend; `npm run build`.

## 8. Verification checklist
- `list_tables` shows v2 shape; `get_advisors` (security) reports RLS enabled with policies, no warnings.
- Register organiser → `public.USER` row with `role='organiser'` (trigger). Login/logout/refresh persists session.
- RLS: a user sees only their own bookings; organiser edits only their own events.
- Pledge tier-allocation + hype update correct; give-away; soft-delete keeps row with `deletedAt` and hides it, re-pledge works; cancelled event shows "Event unavailable".
- App works with the Express backend stopped.

## 9. Risks
- Large staged rewrite; transactional pledge/hype logic must live in Postgres functions to preserve current guarantees.
- The Supabase access token exposed earlier in development must be rotated before relying on this.
