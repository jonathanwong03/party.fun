export function formatVenueAddress(location, address) {
  const venue = String(location ?? '').trim();
  const fullAddress = String(address ?? '').trim();
  if (!venue) return fullAddress;
  if (!fullAddress) return venue;
  if (fullAddress.toLowerCase().includes(venue.toLowerCase())) return fullAddress;
  return `${venue}, ${fullAddress}`;
}
