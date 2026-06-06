# party.fun — Database Tables & Schema

This document describes the **authoritative data model** for party.fun, the lifecycle/cancellation fields that drive the "cancelled event is unavailable + delete from Joined Events" feature, and the **exact changes** needed to bring the current (empty, divergent) Supabase project in line with it.

> The live app currently runs on the in-memory Express mock backend (`backend/data/*.js` + `backend/services/eventMemoryService.js`). The mock model below is the richer, correct model. The Supabase project exists but is empty and its schema diverges — the change-list at the end migrates it to this model.

---

## 1. Authoritative data model

### `USER`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| name | text | Full name |
| username | text | Unique login handle |
| email | text | Unique |
| passwordHash | text | bcrypt |
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
| status | text enum | **`pending` \| `greenlit` \| `cancelled` \| `completed`** |
| currentTierName | text enum | `early_bird` \| `main_crowd` |
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
| tierName | text enum | `early_bird` \| `main_crowd` |
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
- A booking is classified into a Joined Events tab as: `cancelled` if `EVENT.status='cancelled'` OR the booking has no active tickets; else `past` if `EVENT.status='completed'`; else `upcoming`. Bookings with `deletedAt` set are excluded from all tabs.
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
