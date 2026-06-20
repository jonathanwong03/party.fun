// Notification orchestration: builds an email from a template and hands it to the
// Resend-backed email processor. Every function is fire-and-forget — failures are
// logged but never block or fail the HTTP request that triggered them.
import * as templates from './emailTemplates.js';
import { sendEmail } from './emailProcessor.js';

// Run an async notification job without awaiting it; swallow + log any error.
function fireAndForget(label, job) {
  Promise.resolve()
    .then(job)
    .catch((err) => console.error(`[NotificationService] ${label} failed:`, err?.message || err));
}

async function send(label, { to, subject, html }) {
  if (!to) {
    console.warn(`[NotificationService] ${label}: no recipient email; skipped.`);
    return;
  }
  const result = await sendEmail({ to, subject, html });
  console.log(`[NotificationService] ${label} → ${to}: ${result.success ? 'sent' : `failed (${result.error})`}`);
}

// #1 — account created (user or organiser)
export function notifyAccountCreated({ email, username, role }) {
  fireAndForget('accountCreated', () =>
    send('accountCreated', {
      to: email,
      subject: 'Welcome to party.fun 🎉',
      html: templates.accountCreatedTemplate({ userName: username, role }),
    }),
  );
}

// #3 — pledge confirmed (to the pledger)
export function notifyPledgeConfirmed({ email, username, role, eventTitle, qty, pricePerTicket, deadline }) {
  fireAndForget('pledgeConfirmed', () =>
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
    }),
  );
}

// #5 — tickets given away (to the giver). allGivenAway → "can no longer attend".
export function notifyTicketsGivenAway({ email, username, role, eventTitle, qty, allGivenAway }) {
  fireAndForget('ticketsGivenAway', () =>
    send('ticketsGivenAway', {
      to: email,
      subject: `Tickets given away: ${eventTitle}`,
      html: templates.ticketsGivenAwayTemplate({ userName: username, role, eventTitle, qty, allGivenAway }),
    }),
  );
}

// #6 — organiser created an event (to the organiser)
export function notifyEventCreated({ email, organiserName, eventTitle, eventId, hypeThreshold, deadline }) {
  fireAndForget('eventCreated', () =>
    send('eventCreated', {
      to: email,
      subject: `Your event is live: ${eventTitle}`,
      html: templates.eventCreatedTemplate({ organiserName, eventTitle, eventId, hypeThreshold, deadline }),
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
  fireAndForget('eventCancelled', async () => {
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
      });
    }
  });
}
