Design a consistent MVP web application UI for a product called “party.fun”.

Product concept:
party.fun is a threshold-based crowdfunding and ticketing platform for university parties, CCA gatherings, and student events. Organisers create events with a minimum funding/hype threshold. Attendees pledge or buy tickets. If the event reaches the threshold, the event is greenlit. If it fails, the event is cancelled and users are refunded. The platform uses early-bird dynamic pricing / tiered bonding-curve inspired pricing, where early buyers pay less and late buyers pay more.

Design direction:
Create a modern, energetic, student-focused web app. The visual style should feel like a mix of campus event platform, ticketing dashboard, and hype-driven launchpad. Use a dark base theme inspired by nightlife, parties, and the provided hype meter reference. The design should feel trustworthy, not shady. It should be bold, clean, and easy to understand.

Brand personality:
- Fun
- Social
- High-energy
- Trust-first
- Campus-focused
- Slightly playful, but still polished

Design system:
Create a consistent design system before designing the pages.

Use:
- Dark background: near-black / charcoal
- Primary accent: bright orange-red
- Secondary accents: neon green and warm yellow
- Neutral text: white, light gray, muted gray
- Status colors:
  - Green: threshold reached / confirmed
  - Yellow: almost there / active tier
  - Orange-red: live hype / main CTA
  - Gray: inactive / pending
- Rounded cards, but not overly soft
- Strong progress bars and meter components
- Clean dashboard tables
- Clear form inputs
- Consistent buttons, cards, tabs, badges, and navigation

Typography:
Use a modern sans-serif font. Headings should be bold and high-impact. Body text should be readable and clean. Use consistent font sizes across all pages.

Core reusable components:
- Top navigation bar
- Primary CTA button
- Secondary button
- Danger/delete button
- Event card
- Hype meter progress bar
- Pricing tier bar
- Status badge
- Form input
- Dropdown/select
- Date/time input
- Dashboard table
- Confirmation modal
- Empty state
- Page header
- Admin sidebar or admin navigation
- User profile summary card

Pages to design:
Design the following 12 MVP pages plus one delete confirmation modal.

1. Landing / Event Discovery Page
Purpose: Public page for guests, registered users, and admins to browse events.
Include:
- party.fun logo
- Navigation: Events, How it works, Login, Create Account
- Featured event section
- Event cards grid
- Filters: date, location, price, hype level
- Each event card shows event title, date, location, current ticket price, hype percentage, spots left, and status
- CTA: View Event

2. Event Detail Page
Purpose: Public page where anyone can view event information and pledge/buy ticket.
Include:
- Event banner area
- Event title
- Date, time, location
- Organiser name
- Description
- Hype Meter section
- Minimum threshold
- Current number of backers
- Spots left
- Current ticket price
- Pricing tier / bonding curve visual
- CTA: Buy Ticket / Join the Hype
- Secondary CTA: Login or Create Account
- Clear explanation: buy early, pay less; threshold reached means party is on; missed threshold means refund

3. Checkout / Pledge Form Page
Purpose: Allows both guests and logged-in users to buy/pledge for tickets.
Include:
- Event summary card
- Current ticket price
- Quantity selector
- Buyer details form
- For guest: name, email, phone/Telegram
- For logged-in user: pre-filled profile details
- Payment/simulated payment section
- Price breakdown
- CTA: Confirm Pledge
- Trust note: “Funds are only captured when the event reaches its hype threshold” or “Refunded if threshold is not reached”

4. Confirmation Page
Purpose: Shows successful pledge/ticket registration.
Include:
- Success message
- Event summary
- Ticket quantity
- Current hype progress
- What happens next section
- CTA: Back to Events
- CTA: View My Events if logged in

5. Login Page
Purpose: Existing users and admins log in.
Include:
- Email/username field
- Password field
- Login button
- Forgot password link
- Link to create account
- Clear visual distinction but consistent styling

6. Create Account / Choose Account Type Page
Purpose: User chooses whether they are signing up as a User or Admin.
Include:
- Two large selection cards:
  - User: “Buy tickets, track your events, and join the hype”
  - Admin / Organiser: “Create, manage, and launch events”
- CTA for each role
- Link to login

7. User Registration Page
Purpose: Regular user account creation.
Include:
- Username
- Email
- Password
- Confirm password
- Optional phone/Telegram
- Create account button
- Short note: users can also buy tickets as guests without an account

8. Admin Registration Page
Purpose: Admin/organiser account creation.
Include:
- Organisation/CCA name
- Admin name
- Email
- Password
- Confirm password
- Contact number/Telegram
- Optional social link
- Create admin account button
- Trust note: admins can create and manage events

9. User Profile / My Events Page
Purpose: Registered users view events they have bought/pledged for.
Include:
- User profile summary
- Tabs: Upcoming, Past, Cancelled/Refunded
- List of registered events
- Each event row/card shows title, date, ticket status, hype status, amount paid/pledged
- CTA: Browse More Events
- Empty state if user has no events

10. Admin Dashboard Page
Purpose: Admins manage their events.
Include:
- Admin sidebar or top nav
- Summary cards:
  - Total events
  - Live events
  - Greenlit events
  - Total pledges
- Table/list of events
- Each event shows title, date, hype %, revenue pledged, threshold, status
- Actions: View, Edit, Delete
- CTA: Create New Event

11. Create Event Page
Purpose: Admin creates a new event.
Include a structured form with sections:
- Basic details: title, description, event image/banner
- Schedule: date, start time, end time
- Location: venue name, address
- Capacity and threshold: max capacity, minimum hype threshold
- Pricing model:
  - Tier 1 price and ticket quantity
  - Tier 2 price and ticket quantity
  - Tier 3 price and ticket quantity
  - Final/greenlit price
- Deadline for reaching threshold
- Preview card showing how the event card and hype meter will appear
- CTA: Publish Event
- Secondary CTA: Save Draft

12. Edit Event Page
Purpose: Admin modifies an existing event.
Use the same layout as Create Event, but pre-filled.
Include:
- Current event status
- Warning if editing a live event
- Save Changes button
- Cancel button
- Event preview
- If event is greenlit, show some fields as locked or visually marked as sensitive

Delete Event Confirmation Modal
Purpose: Confirm destructive delete action.
Include:
- Modal title: Delete Event?
- Warning text explaining this action cannot be undone
- Event name
- Optional checkbox or typed confirmation
- Cancel button
- Delete Event button in danger styling

Navigation rules:
- Guests can view events and buy tickets without an account.
- Registered users can view events, buy tickets, and see their registered events in My Events.
- Admins can view public events and also access the Admin Dashboard.
- Only admins can create, edit, and delete events.

Design consistency requirements:
- Use the same navbar style across public pages.
- Use the same form layout across auth and event forms.
- Use the same event card design everywhere.
- Use the same hype meter component on event cards, event detail, confirmation, and admin dashboard.
- Use consistent button colors:
  - Primary action: orange-red
  - Success/confirmed: green
  - Warning/active tier: yellow
  - Delete/destructive: red
  - Secondary actions: dark gray border
- Use consistent spacing, page width, card radius, shadows, and typography scale.
- Build components using Auto Layout.
- Create reusable component variants for buttons, badges, event cards, form inputs, and hype meter states.

Important UX details:
- The app should immediately communicate whether an event is “not yet funded”, “almost there”, or “greenlit”.
- The hype meter should be visually prominent.
- The pricing tier/bonding curve should be easy to understand.
- The checkout flow should feel safe and transparent.
- The admin dashboard should feel practical and efficient, not overly decorative.
- The design should work well for a university student audience.

Output:
Create a full multi-page Figma design with all 12 pages and the delete confirmation modal. Use consistent components, colors, typography, spacing, and layout across the entire application.