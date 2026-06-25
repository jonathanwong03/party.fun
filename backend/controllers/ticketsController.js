import { buildTicketsPdf } from '../services/ticketPdf.js';
import { adminClient } from '../services/supabaseAdmin.js';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// Stream a printable PDF (one page per active ticket) for the caller's own booking.
// RLS on req.supabase ensures a user can only read their own booking/tickets.
export async function getTicketsPdf(req, res) {
  const bookingId = Number(req.params.bookingId);
  const { data: b } = await req.supabase.from('BOOKINGS').select('reference, eventId').eq('id', bookingId).single();
  if (!b) { res.status(404).json({ status: 'not_found', message: 'Booking not found.' }); return; }
  const [{ data: ev }, { data: tix }] = await Promise.all([
    req.supabase.from('EVENT').select('title, location, startDate').eq('id', b.eventId).single(),
    req.supabase.from('TICKETS').select('qrCode, status').eq('bookingId', bookingId),
  ]);
  const tickets = (tix ?? []).filter((t) => t.status === 'active').map((t) => ({ qrCode: t.qrCode }));
  const pdf = await buildTicketsPdf({
    event: { title: ev?.title ?? 'Event', dateText: fmtDate(ev?.startDate), location: ev?.location, reference: b.reference },
    tickets,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="tickets-${b.reference ?? bookingId}.pdf"`);
  res.send(pdf);
}

// Public ticket PDF reached from the email's download button. The booking's qrToken
// is the unguessable bearer, so no auth header is needed; uses the service-role client.
export async function getTicketsPdfByToken(req, res) {
  const admin = adminClient();
  const token = String(req.params.qrToken ?? '').trim();
  const { data: b } = await admin.from('BOOKINGS').select('id, reference, eventId').eq('qrToken', token).is('deletedAt', null).single();
  if (!b) { res.status(404).json({ status: 'not_found', message: 'Tickets not found.' }); return; }
  const [{ data: ev }, { data: tix }] = await Promise.all([
    admin.from('EVENT').select('title, location, startDate').eq('id', b.eventId).single(),
    admin.from('TICKETS').select('qrCode, status').eq('bookingId', b.id),
  ]);
  const tickets = (tix ?? []).filter((t) => t.status === 'active').map((t) => ({ qrCode: t.qrCode }));
  const pdf = await buildTicketsPdf({
    event: { title: ev?.title ?? 'Event', dateText: fmtDate(ev?.startDate), location: ev?.location, reference: b.reference },
    tickets,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="tickets-${b.reference ?? b.id}.pdf"`);
  res.send(pdf);
}
