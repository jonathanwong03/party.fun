import { createClient } from '@supabase/supabase-js';
import * as templates from './emailTemplates.js';
import { sendEmail } from './emailProcessor.js';

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function logNotification({ userId, email, eventId, type, subject, status, error }) {
  const sentAt = status === 'sent' ? new Date().toISOString() : null;
  console.log(`[NotificationService Log] Type: ${type} | To: ${email} | Status: ${status}${error ? ` | Error: ${error}` : ''}`);

  const supabase = serverClient();
  if (!supabase) return;

  try {
    const { error: dbError } = await supabase.from('notification_logs').insert({
      user_id: userId ?? null,
      recipient_email: email,
      event_id: eventId,
      notification_type: type,
      subject,
      status,
      error_message: error || null,
      sent_at: sentAt,
    });
    if (dbError) console.warn(`[NotificationService] Supabase log warning: ${dbError.message}`);
  } catch (dbErr) {
    console.warn(`[NotificationService] Supabase log warning: ${dbErr.message}`);
  }
}

export function notifyPledgeConfirmed({ userId, email, username, eventId, eventTitle, deadline, qty, pricePerTicket }) {
  (async () => {
    try {
      const subject = `Pledge Confirmed: ${eventTitle} 🚀`;
      const html = templates.pledgeConfirmedTemplate({
        userName: username,
        eventTitle,
        qty,
        pricePerTicket,
        total: qty * pricePerTicket,
        deadline,
      });
      const result = await sendEmail({ to: email, subject, html });
      await logNotification({
        userId,
        email,
        eventId,
        type: 'pledge_confirmed',
        subject,
        status: result.success ? 'sent' : 'failed',
        error: result.error,
      });
    } catch (error) {
      console.error('[NotificationService] Error in notifyPledgeConfirmed:', error);
    }
  })();
}

export function notifyPledgeCancelled({ userId, email, username, eventId, eventTitle, qty, refundAmount }) {
  (async () => {
    try {
      const subject = `Pledge Cancelled: ${eventTitle}`;
      const html = templates.pledgeCancelledTemplate({
        userName: username,
        eventTitle,
        qty,
        refundAmount,
      });
      const result = await sendEmail({ to: email, subject, html });
      await logNotification({
        userId,
        email,
        eventId,
        type: 'pledge_cancelled',
        subject,
        status: result.success ? 'sent' : 'failed',
        error: result.error,
      });
    } catch (error) {
      console.error('[NotificationService] Error in notifyPledgeCancelled:', error);
    }
  })();
}

export function notifyEventGreenlit(eventId, event) {
  (async () => {
    try {
      if (!event) {
        console.error(`[NotificationService] Cannot send greenlit alerts: Event ${eventId} not found.`);
        return;
      }

      const supabase = serverClient();
      if (!supabase) {
        console.warn('[NotificationService] No Supabase client; skipped greenlit fan-out.');
        return;
      }

      const { data: bookings, error } = await supabase
        .from('BOOKINGS')
        .select('userId, USER!inner(email, username)')
        .eq('eventId', eventId)
        .gt('activeTicketCount', 0);

      if (error) {
        console.error('[NotificationService] Failed to load backers:', error.message);
        return;
      }

      const backers = bookings ?? [];
      if (backers.length === 0) {
        console.log(`[NotificationService] Event ${event.title} greenlit, but has 0 backers to notify.`);
        return;
      }

      console.log(`[NotificationService] Event ${event.title} is greenlit! Notifying ${backers.length} backer(s)...`);

      await Promise.all(
        backers.map(async (row) => {
          const user = row.USER;
          if (!user?.email) return;

          const subject = `It's a Go! 🎉 ${event.title} is Greenlit!`;
          const html = templates.eventGreenlitTemplate({
            userName: user.username,
            eventTitle: event.title,
            start_time: event.startLong || event.date,
            location: event.location,
            backers_count: event.activeTicketCount ?? backers.length,
          });
          const result = await sendEmail({ to: user.email, subject, html });
          await logNotification({
            userId: row.userId,
            email: user.email,
            eventId,
            type: 'event_greenlit',
            subject,
            status: result.success ? 'sent' : 'failed',
            error: result.error,
          });
        }),
      );
    } catch (error) {
      console.error('[NotificationService] Error in notifyEventGreenlit:', error);
    }
  })();
}
