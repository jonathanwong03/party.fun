import { createClient } from '@supabase/supabase-js';
import * as templates from './emailTemplates.js';
import { sendEmail as defaultSendEmail } from './emailProcessor.js';

function defaultServerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const defaultDependencies = {
  sendEmail: defaultSendEmail,
  createServerClient: defaultServerClient,
  insertNotificationLog: null,
};

export const dependencies = { ...defaultDependencies };

export function __resetNotificationDependenciesForTests() {
  dependencies.sendEmail = defaultDependencies.sendEmail;
  dependencies.createServerClient = defaultDependencies.createServerClient;
  dependencies.insertNotificationLog = defaultDependencies.insertNotificationLog;
}

function deliveryStatus(result) {
  if (!result.success) return 'failed';
  if (result.mock) return 'mock_sent';
  return 'sent';
}

async function logNotification({ userId, email, eventId, type, subject, status, error }) {
  const sentAt = status === 'sent' || status === 'mock_sent' ? new Date().toISOString() : null;
  console.log(`[NotificationService Log] Type: ${type} | To: ${email} | Status: ${status}${error ? ` | Error: ${error}` : ''}`);

  const row = {
    user_id: userId ?? null,
    recipient_email: email,
    event_id: eventId,
    notification_type: type,
    subject,
    status,
    error_message: error || null,
    sent_at: sentAt,
  };

  if (dependencies.insertNotificationLog) {
    try {
      await dependencies.insertNotificationLog(row);
    } catch (dbErr) {
      console.warn(`[NotificationService] Log warning: ${dbErr.message}`);
    }
    return;
  }

  const supabase = dependencies.createServerClient();
  if (!supabase) return;

  try {
    const { error: dbError } = await supabase.from('notification_logs').insert(row);
    if (dbError) console.warn(`[NotificationService] Supabase log warning: ${dbError.message}`);
  } catch (dbErr) {
    console.warn(`[NotificationService] Supabase log warning: ${dbErr.message}`);
  }
}

// Run an async notification job without awaiting it; swallow + log any error.
function fireAndForget(label, job) {
  const p = Promise.resolve()
    .then(job)
    .catch((err) => console.error(`[NotificationService] ${label} failed:`, err?.message || err));
  return p;
}

async function send(label, { to, subject, html, logPayload = {} }) {
  if (!to) {
    console.warn(`[NotificationService] ${label}: no recipient email; skipped.`);
    return { success: false, error: 'no_email' };
  }
  const result = await dependencies.sendEmail({ to, subject, html });
  const status = deliveryStatus(result);
  console.log(`[NotificationService] ${label} → ${to}: ${status}${result.error ? ` (${result.error})` : ''}`);
  
  await logNotification({
    userId: logPayload.userId,
    email: to,
    eventId: logPayload.eventId,
    type: logPayload.type || label,
    subject,
    status,
    error: result.error,
  });

  return result;
}

// #1 — account created (user or organiser)
export function notifyAccountCreated({ email, username, role }) {
  return fireAndForget('accountCreated', () =>
    send('accountCreated', {
      to: email,
      subject: 'Welcome to party.fun 🎉',
      html: templates.accountCreatedTemplate({ userName: username, role }),
    }),
  );
}

// #3 — pledge confirmed (to the pledger)
export function notifyPledgeConfirmed({ userId, email, username, role, eventId, eventTitle, qty, pricePerTicket, deadline }) {
  return fireAndForget('pledgeConfirmed', () =>
    send('pledgeConfirmed', {
      to: email,
      subject: `Pledge Confirmed: ${eventTitle} 🚀`,
      html: templates.pledgeConfirmedTemplate({
        userName: username,
        role,
        eventTitle,
        qty,
        pricePerTicket,
        total: Number(qty) * Number(pricePerTicket),
        deadline,
      }),
      logPayload: { userId, eventId, type: 'pledge_confirmed' },
    }),
  );
}

// #5 — tickets given away (to the giver). allGivenAway → "can no longer attend".
export function notifyTicketsGivenAway({ userId, email, username, role, eventId, eventTitle, qty, allGivenAway }) {
  return fireAndForget('ticketsGivenAway', () =>
    send('ticketsGivenAway', {
      to: email,
      subject: `Tickets given away: ${eventTitle}`,
      html: templates.ticketsGivenAwayTemplate({ userName: username, role, eventTitle, qty, allGivenAway }),
      logPayload: { userId, eventId, type: 'tickets_given_away' },
    }),
  );
}

// #6 — organiser created an event (to the organiser)
export function notifyEventCreated({ email, organiserName, eventTitle, eventId, hypeThreshold, deadline }) {
  return fireAndForget('eventCreated', () =>
    send('eventCreated', {
      to: email,
      subject: `Your event is live: ${eventTitle}`,
      html: templates.eventCreatedTemplate({ organiserName, eventTitle, eventId, hypeThreshold, deadline }),
      logPayload: { eventId, type: 'event_created' },
    }),
  );
}

// Password reset: emails the 6-digit code. Awaited (the request waits on the send),
// unlike the fire-and-forget notifications above.
export async function notifyPasswordReset({ email, username, role, code }) {
  await send('passwordReset', {
    to: email,
    subject: 'Your party.fun password reset code',
    html: templates.passwordResetTemplate({ userName: username, role, code }),
  });
}

// #4 — event cancelled: full-refund email to every backer + a summary to the organiser.
// `reason` is 'missed_threshold' or 'organiser'.
export function notifyEventCancelled({ eventTitle, reason, backers = [], organiser = null }) {
  return fireAndForget('eventCancelled', async () => {
    await Promise.all(
      backers.map((b) =>
        send('eventCancelled(backer)', {
          to: b.email,
          subject: `Event cancelled — full refund: ${eventTitle}`,
          html: templates.eventCancelledTemplate({
            userName: b.username,
            role: b.role,
            method: b.method,
            eventTitle,
            refundAmount: b.refundAmount ?? 0,
            reason,
          }),
          logPayload: { userId: b.userId, type: 'event_cancelled' },
        }),
      ),
    );

    if (organiser?.email) {
      await send('eventCancelled(organiser)', {
        to: organiser.email,
        subject: `Your event was cancelled: ${eventTitle}`,
        html: templates.eventCancelledOrganiserTemplate({
          organiserName: organiser.username,
          eventTitle,
          reason,
          backerCount: backers.length,
        }),
        logPayload: { userId: organiser.userId, type: 'event_cancelled' },
      });
    }
  });
}

export function notifyPledgeCancelled({ userId, email, username, eventId, eventTitle, qty, refundAmount }) {
  return fireAndForget('pledgeCancelled', () =>
    send('pledgeCancelled', {
      to: email,
      subject: `Pledge Cancelled: ${eventTitle}`,
      html: templates.pledgeCancelledTemplate({
        userName: username,
        eventTitle,
        qty,
        refundAmount,
      }),
      logPayload: { userId, eventId, type: 'pledge_cancelled' },
    }),
  );
}

export function notifyEventGreenlit(eventId, event) {
  fireAndForget('eventGreenlit', async () => {
    if (!event) {
      console.error(`[NotificationService] Cannot send greenlit alerts: Event ${eventId} not found.`);
      return;
    }

    const supabase = dependencies.createServerClient();
    if (!supabase) {
      console.warn('[NotificationService] No Supabase client; skipped greenlit fan-out.');
      return;
    }

    const { data: bookings, error } = await supabase
      .from('BOOKINGS')
      .select('userId, USER!inner(email, username, role)')
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

        await send('eventGreenlit', {
          to: user.email,
          subject,
          html,
          logPayload: { userId: row.userId, eventId, type: 'event_greenlit' },
        });
      }),
    );
  });
}
