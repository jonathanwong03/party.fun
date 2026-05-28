# party.fun

Frontend-only React prototype for `party.fun`, a threshold-based crowdfunding and ticketing concept for campus events.

The current app is a Vite + React + TypeScript MVP prototype. It uses mock data only: there is no backend, database, real authentication, real payment capture, or persistent event storage yet.

## Current Stack

- React
- TypeScript
- Vite
- React Router
- Plain CSS
- Mock frontend data

The old Express, EJS, MongoDB, and session-based backend prototype has been removed from the active app.

## Prerequisites

- Node.js
- npm

Run all commands from:

```powershell
C:\smu heap\party.fun
```

## Install Dependencies

```powershell
npm install
```

## Run The Prototype

```powershell
npm run dev
```

Vite will print the local development URL, usually:

```text
http://localhost:5173
```

## Build

```powershell
npm run build
```

## Preview Production Build

```powershell
npm run preview
```

## MVP Routes

Public:

```text
/                     Landing / Event Discovery
/events/:eventId      Event Detail
/checkout/:eventId    Checkout / Pledge Form
/confirmation         Confirmation
```

Auth:

```text
/login                Login
/signup               Choose Account Type
/signup/user          User Registration
/signup/admin         Admin Registration
```

User:

```text
/profile              User Profile / My Events
```

Admin:

```text
/admin                Admin Dashboard
/admin/events/new     Create Event
/admin/events/:eventId/edit
                      Edit Event
```

Delete event is handled as a modal in the admin dashboard, not as a separate page.

## Prototype Behaviour

- Event browsing is public.
- Guests can view events and go through checkout.
- Users can simulate account creation and view a mock "My Events" page.
- Admins can view a mock dashboard and open create/edit event forms.
- Checkout simulates a pledge/ticket purchase and redirects to confirmation.
- Admin event creation/editing screens are realistic UI prototypes, but they do not save to a backend.
- The hype meter, pricing tiers, attendees, and ticket information are all based on mock frontend data.

## Important Product Model

The app separates event status from ticket pricing:

- Event status: `draft`, `live`, `confirmed`, `cancelled`
- Pricing tier: `super early`, `early`, `standard`, `confirmed/final price`

This avoids confusion when an event has reached its threshold but still has remaining tickets in the current price tier.

## Future Work

- Add real authentication.
- Add a database for events, users, tickets, and pricing tiers.
- Add admin-only route protection.
- Add real payment authorization/capture flow.
- Persist create/edit event form submissions.
- Add attendee and ticket management pages.
- Add production deployment configuration.
