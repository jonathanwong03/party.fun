# party.fun — Events API Contracts

This document outlines the API contracts and schemas for managing events. Since the client React application is transitioning to load records from Supabase, these contracts serve as the specifications for both client queries and backend database views.

---

## 1. GET `/events` (Discover Feed List)
* **Description**: Fetches all active event campaigns to display on the main landing feed.
* **Optimization (Minimal Fields)**: To ensure fast load times and lightweight network payloads, this endpoint returns only the minimal metadata required to render the feed cards. Full details (like descriptions and the entire pricing tiers array) are deferred.

### Response `200 OK`
```json
[
  {
    "id": "e1000000-0000-0000-0000-000000000001",
    "title": "Neon Jungle: Freshers Rave",
    "organiser_name": "NUS Electronic Music Club",
    "start_time": "2026-06-12T14:00:00.000Z",
    "location": "The Projector, Golden Mile Tower",
    "image_url": "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80&auto=format&fit=crop",
    "current_price": 18.00,
    "current_tier_label": "Tier 2 — Early",
    "backers_count": 156,
    "backers_threshold": 200,
    "status": "funding"
  }
]
```

---

## 2. GET `/events/:eventId` (Single Event Details)
* **Description**: Fetches comprehensive metadata for a specific event to render the full detail page.
* **Separation Rationale**: Tiers lists, long descriptions, and capacity specifics are loaded only when the user clicks into the event, preventing the feed list from over-fetching data.

### Response `200 OK`
```json
{
  "id": "e1000000-0000-0000-0000-000000000001",
  "title": "Neon Jungle: Freshers Rave",
  "organiser_name": "NUS Electronic Music Club",
  "organiser_id": "d1000000-0000-0000-0000-000000000001",
  "description": "A night of bass-heavy beats, UV body paint and free-flow mocktails. Capping our orientation week with the loudest party on campus.",
  "start_time": "2026-06-12T14:00:00.000Z",
  "location": "The Projector, Golden Mile Tower",
  "image_url": "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80&auto=format&fit=crop",
  "backers_threshold": 200,
  "hard_capacity": 400,
  "status": "funding",
  "deadline": "2026-06-10T15:59:00.000Z",
  "created_at": "2026-06-01T11:00:00.000Z",
  "backers_count": 156,
  "spots_sold": 156,
  "spots_left": 244,
  "tiers": [
    { "label": "Super Early", "price": 12.00, "max_spots": 50, "slots_sold": 50 },
    { "label": "Early", "price": 18.00, "max_spots": 100, "slots_sold": 80 },
    { "label": "Standard", "price": 25.00, "max_spots": 150, "slots_sold": 26 },
    { "label": "Greenlit Door", "price": 32.00, "max_spots": 100, "slots_sold": 0 }
  ]
}
```

---

## 3. POST `/events` (Create New Event)
* **Description**: Allows organizers to launch a new zero-risk campus campaign.
* **Validation**: Requires a minimum threshold and valid chronological deadlines.

### Request Body
```json
{
  "title": "Post-Finals Yacht Party",
  "description": "Golden-hour cocktails and lo-fi DJ sets on the harbor.",
  "start_time": "2026-06-28T09:30:00.000Z",
  "location": "Sentosa Cove",
  "image_url": "https://images.unsplash.com/photo-1530103862676-de8c9debad1d",
  "backers_threshold": 80,
  "hard_capacity": 120,
  "deadline": "2026-06-25T10:00:00.000Z",
  "tiers": [
    { "tier_index": 0, "label": "Super Early", "price": 18.00, "max_spots": 30 },
    { "tier_index": 1, "label": "Early", "price": 24.00, "max_spots": 40 },
    { "tier_index": 2, "label": "Standard", "price": 28.00, "max_spots": 30 },
    { "tier_index": 3, "label": "Greenlit Door", "price": 35.00, "max_spots": 20 }
  ]
}
```

### Response `201 Created`
```json
{
  "id": "e1000000-0000-0000-0000-000000000003",
  "title": "Post-Finals Yacht Party",
  "status": "funding"
}
```

---

## 4. PATCH `/events/:eventId` (Modify Existing Event)
* **Description**: Allows administrators to update event logistics or manually trigger early cancellation/refunds.
* **Rules**: Pricing tiers and financial amounts are immutable once pledges are locked to preserve transaction integrity.

### Request Body
```json
{
  "title": "Post-Finals Yacht Party (Updated Title)",
  "location": "Sentosa Marina Club",
  "status": "failed" 
}
```

### Response `200 OK`
```json
{
  "id": "e1000000-0000-0000-0000-000000000003",
  "title": "Post-Finals Yacht Party (Updated Title)",
  "status": "failed"
}
```
