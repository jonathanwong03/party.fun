import type { EventItem } from "./types";

export function formatVenueAddress(location?: string | null, address?: string | null): string {
  const venue = (location ?? "").trim();
  const fullAddress = (address ?? "").trim();
  if (!venue) return fullAddress;
  if (!fullAddress) return venue;
  if (fullAddress.toLowerCase().includes(venue.toLowerCase())) return fullAddress;
  return `${venue}, ${fullAddress}`;
}

export function formatEventLocation(event: Pick<EventItem, "location" | "address">): string {
  return formatVenueAddress(event.location, event.address);
}
