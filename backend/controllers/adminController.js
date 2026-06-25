import { refundEventCardBookings } from '../services/stripeRefunds.js';
import { notifyEventCancelled } from '../services/notificationService.js';
import { adminClient } from '../services/supabaseAdmin.js';
import { buildLicensePdf } from '../services/licensePdf.js';

// Returns the caller's USER row if they're an admin, else null.
async function adminUser(req) {
  const { data } = await req.supabase.from('USER').select('role, username, email, createdAt').eq('id', req.user.id).single();
  return data?.role === 'admin' ? data : null;
}

const licenseFor = (id, me) => ({
  username: me.username,
  licenseId: 'PF-ADMIN-' + String(id).slice(0, 8).toUpperCase(),
  issued: me.createdAt ? new Date(me.createdAt).toLocaleDateString('en-SG', { year: 'numeric', month: 'long', day: 'numeric' }) : '—',
  validity: 'Valid while the administrator account is active.',
});

const CANCEL_MESSAGES = {
  reason_too_short: 'Please provide a clear reason (at least 10 characters).',
  not_found: 'Event not found.',
  not_admin: 'Admins only.',
};

// Moderation cancel of any event (mandatory reason). Refunds + notifies with admin attribution.
export async function postAdminCancel(req, res) {
  const me = await adminUser(req);
  if (!me) return res.status(403).json({ status: 'forbidden', message: 'Admins only.' });
  const eventId = req.params.eventId;
  const reason = String(req.body?.reason ?? '');

  const { data, error } = await req.supabase.rpc('admin_cancel_event', { p_event_id: eventId, p_reason: reason });
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  if (data?.error) return res.status(400).json({ status: data.error, message: CANCEL_MESSAGES[data.error] ?? 'Unable to cancel event.' });

  // Card refunds + notify backers/organiser (attributed to admin) — fire-and-forget after responding.
  res.json({ status: 'ok' });
  try {
    await refundEventCardBookings(eventId);
    const admin = adminClient();
    const { data: ev } = await admin.from('EVENT').select('title, hostId').eq('id', eventId).single();
    const { data: host } = await admin.from('USER').select('email, username').eq('id', ev?.hostId).single();
    const { data: bookings } = await admin.from('BOOKINGS').select('userId, refundedAmount, paymentMethod').eq('eventId', eventId).is('deletedAt', null);
    const byUser = {};
    for (const b of bookings ?? []) {
      const c = byUser[b.userId] ?? { amount: 0, method: b.paymentMethod };
      c.amount += Number(b.refundedAmount ?? 0);
      byUser[b.userId] = c;
    }
    const ids = Object.keys(byUser);
    let backers = [];
    if (ids.length) {
      const { data: us } = await admin.from('USER').select('id, email, username, role').in('id', ids);
      backers = (us ?? []).filter((u) => u.email).map((u) => ({ email: u.email, username: u.username, role: u.role, method: byUser[u.id].method, refundAmount: byUser[u.id].amount }));
    }
    notifyEventCancelled({ eventTitle: ev?.title ?? 'the event', reason: 'admin', reasonText: reason, backers, organiser: host?.email ? { email: host.email, username: host.username } : null });
  } catch (e) {
    console.error('[Admin] post-cancel handling failed:', e?.message || e);
  }
}

export async function getLicense(req, res) {
  const me = await adminUser(req);
  if (!me) return res.status(403).json({ status: 'forbidden', message: 'Admins only.' });
  res.json(licenseFor(req.user.id, me));
}

export async function getLicensePdf(req, res) {
  const me = await adminUser(req);
  if (!me) return res.status(403).json({ status: 'forbidden', message: 'Admins only.' });
  const pdf = await buildLicensePdf(licenseFor(req.user.id, me));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="party-fun-admin-license.pdf"');
  res.send(pdf);
}
