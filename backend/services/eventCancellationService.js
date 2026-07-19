import { cancelEvent } from './eventService.js';
import { refundEventCardBookings } from './stripeRefunds.js';
import { notifyEventCancelled } from './notificationService.js';
import { auditLog } from './auditLog.js';

export const dependencies = {
  cancelEvent,
  refundEventCardBookings,
  notifyEventCancelled,
};

// Shared "cancel a live event and refund its backers" flow: soft-cancels via the
// cancel_event RPC (which refunds wallet pledges + enforces host ownership), issues
// Stripe refunds for card bookings, then emails refunded backers + the organiser.
// Used by both POST /organiser/events/:id/cancel and the AI agent's confirmed
// `cancel_event` action so refunds/notifications never diverge. Runs through the
// caller's own (RLS-scoped) Supabase client.
export async function cancelEventWithRefunds(sb, userId, eventId, reason) {
  const cleanReason = (reason ?? '').trim() || 'Cancelled by the organiser';
  const result = await dependencies.cancelEvent(sb, eventId, cleanReason);
  if (result.error) return { error: result.error };
  void auditLog({ actorUserId: userId, action: 'event_cancelled', targetType: 'event', targetId: eventId, metadata: { reason: cleanReason } });

  // Card-paid backers get a real Stripe refund to their card (wallet refunds done in the RPC).
  await dependencies.refundEventCardBookings(eventId);

  // Fire-and-forget: email every refunded backer + the organiser. Runs after the
  // cancel RPC so refundedAmount is set; get_event_backer_contacts is host-only.
  const [{ data: ev }, { data: me }, { data: backers }] = await Promise.all([
    sb.from('EVENT').select('title').eq('id', eventId).single(),
    sb.from('USER').select('email, username').eq('id', userId).single(),
    sb.rpc('get_event_backer_contacts', { p_event_id: eventId }),
  ]);
  dependencies.notifyEventCancelled({
    eventTitle: ev?.title ?? 'your event',
    reason: 'organiser',
    backers: (backers ?? []).map((b) => ({ email: b.email, username: b.username, role: b.role, method: b.paymentMethod, refundAmount: b.refundAmount })),
    organiser: me?.email ? { email: me.email, username: me.username } : null,
  });

  return { status: 'ok' };
}

