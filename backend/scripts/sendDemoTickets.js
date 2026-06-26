// One-off: (re)send the ticket email for an existing booking, so a demo booking that
// was seeded straight into the DB still gets the printable PDF with one QR code per
// active ticket. Uses the same notifyBookingTicket path as a real pledge.
//
//   node scripts/sendDemoTickets.js                 # defaults to PF-DEMO-PFD-04 (Neon Rave, 10 tickets)
//   node scripts/sendDemoTickets.js PF-DEMO-SMU-04  # any other booking reference
//
// Delivery follows the usual rules: set RESEND_API_KEY to actually send, and (since the
// demo buyer's address is fake) NOTIFICATION_OVERRIDE_EMAIL to redirect it to your inbox.
// Without RESEND_API_KEY the email is printed to the console (mock mode) instead.
import 'dotenv/config';
import { adminClient } from '../services/supabaseAdmin.js';
import { notifyBookingTicket } from '../services/notificationService.js';
import { formatVenueAddress } from '../utils/eventDisplay.js';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const reference = (process.argv[2] || 'PF-DEMO-PFD-04').trim();
const admin = adminClient();

const { data: booking, error: bErr } = await admin
  .from('BOOKINGS')
  .select('id, reference, qrToken, eventId, userId')
  .eq('reference', reference)
  .is('deletedAt', null)
  .maybeSingle();
if (bErr) { console.error(`FAIL: ${bErr.message}`); process.exit(1); }
if (!booking) { console.error(`FAIL: no booking found with reference "${reference}".`); process.exit(1); }

const [{ data: buyer }, { data: ev }, { data: tix }] = await Promise.all([
  admin.from('USER').select('email, username, role').eq('id', booking.userId).single(),
  admin.from('EVENT').select('title, location, address, startDate').eq('id', booking.eventId).single(),
  admin.from('TICKETS').select('qrCode, status').eq('bookingId', booking.id),
]);

const ticketCodes = (tix ?? []).filter((t) => t.status === 'active').map((t) => t.qrCode);
if (!buyer?.email) { console.error(`FAIL: booking ${reference} has no buyer email.`); process.exit(1); }
if (ticketCodes.length === 0) { console.error(`FAIL: booking ${reference} has no active tickets to send.`); process.exit(1); }

console.log(`Sending ${ticketCodes.length} ticket(s) for "${ev?.title ?? 'event'}" (${reference}) to ${buyer.email} (${buyer.username})...`);

await notifyBookingTicket({
  email: buyer.email,
  username: buyer.username,
  role: buyer.role,
  eventTitle: ev?.title ?? 'Event',
  dateText: fmtDate(ev?.startDate),
  location: formatVenueAddress(ev?.location, ev?.address),
  reference: booking.reference,
  bookingToken: booking.qrToken,
  ticketCodes,
});

console.log(`done — ${ticketCodes.length} QR ticket(s) emailed. Check your inbox (or the backend console if RESEND_API_KEY is unset).`);
process.exit(0);
