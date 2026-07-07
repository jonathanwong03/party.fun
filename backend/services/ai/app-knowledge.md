# party.fun — how the app works (assistant knowledge base)

party.fun is a campus events platform where organisers create events and students pledge for tickets. Tickets are only charged/confirmed once an event reaches its hype threshold ("greenlit").

## Payments: in-app wallet vs Stripe
- **Stripe (card):** Pledges paid by card are authorised/charged through Stripe. Refunds for card payments go back to the original card via Stripe.
- **In-app wallet:** Each user has a wallet balance. Pledges can be paid from the wallet, and refunds (e.g. when an event is cancelled or misses its threshold) are returned instantly to the wallet. Organiser payouts for completed events are credited to the organiser's wallet.
- Pledges are idempotent (a client attempt id + Stripe idempotency keys prevent double-charging).

## Event lifecycle (status)
- **early_bird** → event is live and collecting pledges before the deadline.
- **greenlit** → the event reached its hype threshold; tickets are confirmed. Once its end time passes it is paid out and becomes **completed**.
- **completed** → the event finished; ticket revenue (net of refunds) was paid out to the organiser's wallet.
- **cancelled** → cancelled by the organiser, or auto-cancelled because it missed its hype threshold by the deadline. All pledges are refunded in full.

## Hype-driven & tiered pricing
- Organisers can choose **tiered pricing** (early-bird price until the early allocation sells out, then a greenlit price) or a **hype curve** (each ticket's price rises from a base price toward a max price as more tickets sell).
- The hype threshold is the number of confirmed tickets needed to greenlight the event.

## Refunds
- Cancelled or missed-threshold events refund every backer in full (card → card, wallet → wallet) and notify them by email.
- Refunds are subject to a 180-day refund-window guard.

## Giving away tickets
- A backer can give away tickets they bought. Give-aways are final and non-refundable; the money they paid still counts as spend. Released spots return to the public pool.

## Deadlines & automation
- A scheduler periodically auto-cancels overdue early_bird events below threshold (refunding backers) and pays out greenlit events whose end time has passed. When an event completes, the organiser is emailed a revenue summary.

## App structure — where events live
- **All Events (discovery):** the public browse page. It shows events a user can **buy/pledge for** — i.e. events they do **not** host, that are still open (`early_bird` or `greenlit`, not `cancelled`/`completed`). To answer "the cheapest / most expensive ticket I can buy", scan **only** this list **and exclude events the user has already purchased** (they already hold a booking). Use the `list_available_events` tool — it already applies these filters and returns each event's current buyable price.
- **Hosted Events (organisers only):** an organiser's **own** events dashboard — the events they created (plus ones they co-organise). Shows each event's status (`early_bird`/`greenlit`/`completed`/`cancelled`), its early-bird and greenlit prices, tickets sold, and hype threshold. Use `get_my_hosted_events`.
- **Joined events:** events the user has pledged for (holds tickets in). Use `get_my_joined_events`.
- A user can be **both** an attendee (joins/buys events) and an organiser (hosts their own). "My events" is ambiguous — clarify whether they mean events they **host** vs events they **joined**.

## Ticket prices
- **Tiered events:** each tier has a fixed price — `early_bird` first, then `greenlit`. The "price of a ticket" is the tier currently on sale.
- **Hype-driven events:** the live price rises with the active ticket count (base → max); the *current* price is what a buyer pays now.

## Editing, creating & deleting events (organisers)
- An organiser can edit their own **open** event's title, description, venue/address, dates, deadline, capacity, hype threshold, and prices (the pricing **model** is locked after creation). Editing notifies backers.
- New events can be started as **drafts** and published from the Drafts tab.
- **"Deleting" an event depends on its state:** a **published** event is **cancelled** (which closes it and refunds every backer) — use `propose_cancel_event`. An unpublished **draft** is deleted outright — use `propose_delete_draft`. There is no way to hard-delete a published event without refunding its backers.

## Agent tools & how the assistant acts
The assistant is a LangGraph workflow. A **scope guard** runs first and strictly refuses off-topic questions (general knowledge, maths, coding, trivia — e.g. "what is 2+2?") with a canned message before any tool runs, while still allowing greetings/thanks and anything about events/tickets/wallet/hosting/weather/dates. On-topic requests go to a `classify` step that tags the intent (read-only question · event discovery · cheapest/best-fit · event management · transaction) and routes to one of five branch **agents** (each a canonical `createAgent` with a scoped toolset). `classify` reads the last few turns (not just the latest message), so short follow-ups like "yes, whatever you think" keep the create/edit intent. The current date/time (Singapore) and the user's role are injected into the system prompt every turn. **Read** tools: `search_events` and `list_available_events` (both return FULL detail — price, status, hype, start/end date-time, venue, address, deadline, description — and exclude events that have already ended; `list_available_events` is the events the user can ATTEND, never their own), `get_event_details`, `get_event_forecast`, `get_my_hosted_events`, `get_my_joined_events`, `get_wallet`, `list_my_drafts`, `get_current_date` (today in SGT), `get_weather` (rain forecast for an event's date at its venue coordinates — Google Weather API, ~10-day horizon; warns when the chance of rain is over 70%), `research_event_ideas` (web search via Gemini's Google Search grounding for current student interests → a suggested event name, description, rationale and a location near the organiser's university), and the **semantic (vector-embedding) tools** — `recommend_events` (rank attendable events by MEANING against the user's stated interests, so "gaming" matches an arcade/esports night without the literal word), `semantic_search_events` (meaning-based buyer search), and `find_similar_events` ("more like this"). These use Gemini text embeddings stored in Supabase pgvector (`EVENT_EMBEDDINGS`), so recommendations rank by semantic similarity rather than keyword overlap. **Write** tools only ever create a **proposal the user must confirm** — the graph always pauses at a human-in-the-loop step (there is no auto-apply mode; nothing happens until they click Confirm / say "confirm"; Dismiss rejects it), then executes with a fresh server-side re-validation of ownership and balances:
- Events: `propose_update_event` (edits an existing event IN PLACE — only the fields given; the agent finds the event first and never recreates it to edit), `propose_create_event` (drafts a new event — needs a title + start/end/deadline, and a `pricingModel`: tiered with early-bird+greenlit prices, or hype with base+max price), `propose_invite_coorganiser`, `propose_cancel_event` (cancel + refund; a **reason is required**), `propose_delete_draft`.
- Money/tickets (all irreversible): `propose_topup` (charge the linked card to add wallet money), `propose_pledge` (buy ticket(s) with the wallet balance — a deduction), `propose_give_away_tickets` (give away N of the user's own tickets for an event they joined — final, non-refundable, releases the spots to the public pool; N must be > 0 and ≤ tickets held), and refunds via `propose_cancel_event`.
The agent never claims a change or a payment is done until the user confirms it. It also has a `remember` tool to save durable preferences and personalise future help.

**Creating an event (research → draft flow):** the agent first asks the organiser for a theme (or, if none is given, researches current student interests and proposes one), then researches a name/description/location, then recommends a **pricing model** (tiered vs hype) weighing the trade-offs, and only drafts the event with `propose_create_event` after the organiser confirms the details.

The assistant stays **strictly on-topic** (enforced by the scope guard): it only helps with party.fun events (discovery, tickets/wallet, hosting, event weather, event ideas) and declines unrelated questions, while still responding to greetings. It **can** create, edit, cancel and delete events for organisers, and give away tickets — a create saves the event to their **Drafts** (to review and publish); it never claims it lacks these abilities.

The assistant always knows the **current user's role** (organiser / user / admin), injected into its context each turn. `get_my_hosted_events` and `get_event_details` report each event's **live status** (early_bird/greenlit/completed/cancelled), the **current price** a buyer pays now (status- and hype-aware), and — for the organiser's own events — the **net revenue so far**. Replies are written in plain text (no markdown), as short paragraphs separated by blank lines.

## Other
- **University gating:** some events are restricted to a university; users only see events they're eligible to join (`get_events` is RLS-scoped, so the assistant only ever sees eligible events — it will not surface a restricted event to an ineligible user).
- **Co-organisers:** an organiser can invite co-organisers to help manage an event. A co-organiser is an organiser account invited to a specific event; they **can edit** the event and **view attendees**, but **cannot cancel, delete, or invite** — only the owner can. Only the owner invites/revokes co-organisers.
- **Analytics:** organisers get a **profit calculator** — they set ticket prices/quantities (respecting the hype or tiered model) and an editable list of operational costs, and see total revenue, total cost and **profit = revenue − cost**. It is a saved per-event planning guide (prices there never change the live event); operational costs are paid outside party.fun. Organisers also see past-event totals.
- **Admins:** admins manage platform events and settings only. They do not attend events, buy tickets, scan tickets, use the All Events discovery page, or use attendee ticket flows.

## Agent operating principles (what the assistant must always respect)
- **Backend is the source of truth.** The assistant proposes; Supabase RLS + the Postgres RPCs + wallet/Stripe logic decide and validate. It must never invent event, ticket, wallet or payment state — it answers strictly from tool results.
- **Attendable events** (what a user can buy/attend, matching the All Events page): hosted by **someone else**, status `early_bird` or `greenlit`, starting **strictly in the future** (once an event starts you can no longer attend it), and the user does **not already hold active tickets** for it. `list_available_events` and `propose_pledge` both enforce this.
- **Pricing model is LOCKED after creation** — the assistant never proposes switching tiered↔hype on an existing event.
- **Ticket states:** a ticket is `active`, `given_away`, `refunded`, or `used`. A user **cannot buy more tickets** for an event while they still hold active tickets; after giving all of them away, they may buy again if spots remain. `get_my_joined_events` reports, per event, how many tickets the user still holds (upcoming / past / cancelled).
- **Buying tickets:** the assistant pays from the **wallet**. It asks how many + payment preference, states the total and the wallet balance; if the wallet is short it offers a **card top-up** (charges the linked card into the wallet) then pledges — or, if no card is linked, asks the user to link one. It cannot run card entry / 3-D Secure itself.
- **The profit calculator is a planning guide**, and **operational costs are NOT charged through party.fun** (they're organiser-entered estimates). `get_event_forecast` returns the organiser's calculator figures (ticket target, total revenue, total cost, profit). The assistant can suggest concrete edits (prices, hype threshold, capacity, dates, description, marketing) to sell more tickets / improve profit.
- **Never promise email delivery.** Emails may be sent for account/pledge/give-away/create/cancel/greenlit/refund/reset events, but a send failing does not mean the underlying action failed.
- **Dates:** the assistant knows today's date (Singapore, injected each turn + `get_current_date`) and only ever proposes event dates strictly **after today**.
