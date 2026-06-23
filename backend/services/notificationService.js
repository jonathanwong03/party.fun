// Notification orchestration: builds an email from a template and hands it to the
// Resend-backed email processor. Every function is fire-and-forget — failures are
// logged but never block or fail the HTTP request that triggered them.
import * as templates from './emailTemplates.js';
import { sendEmail } from './emailProcessor.js';
import { buildTicketsPdf } from './ticketPdf.js';

// Run an async notification job without awaiting it; swallow + log any error.
function fireAndForget(label, job) {
  Promise.resolve()
    .then(job)
    .catch((err) => console.error(`[NotificationService] ${label} failed:`, err?.message || err));
}

async function send(label, { to, subject, html, attachments }) {
  if (!to) {
    console.warn(`[NotificationService] ${label}: no recipient email; skipped.`);
    return;
  }
  const result = await sendEmail({ to, subject, html, attachments });
  console.log(`[NotificationService] ${label} → ${to}: ${result.success ? 'sent' : `failed (${result.error})`}`);
}

// #1 — account created (user or organiser)
export function notifyAccountCreated({ email, username, role }) {
  fireAndForget('accountCreated', () =>
    send('accountCreated', {
      to: email,
      subject: 'Welcome to party.fun',
      html: templates.accountCreatedTemplate({ userName: username, role }),
    }),
  );
}

// #3 — pledge confirmed (to the pledger)
export function notifyPledgeConfirmed({ email, username, role, eventTitle, qty, pricePerTicket, deadline }) {
  fireAndForget('pledgeConfirmed', () =>
    send('pledgeConfirmed', {
      to: email,
      subject: `Pledge Confirmed: ${eventTitle}`,
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

// Booking ticket email: a printable PDF of N individual per-ticket QRs attached
// (one ticket per page). Sent at purchase, on greenlit, and whenever the remaining
// count changes. Fire-and-forget.
export function notifyBookingTicket({ email, username, role, eventTitle, dateText, location, reference, bookingToken, ticketCodes = [], greenlit = false }) {
  fireAndForget('bookingTicket', async () => {
    const remaining = ticketCodes.length;
    const pdfBuffer = await buildTicketsPdf({
      event: { title: eventTitle, dateText, location, reference },
      tickets: ticketCodes.map((qrCode) => ({ qrCode })),
    });
    await send('bookingTicket', {
      to: email,
      subject: greenlit ? `You're in: ${eventTitle}` : `Your ticket: ${eventTitle} 🎟️`,
      html: templates.bookingTicketTemplate({ userName: username, role, eventTitle, dateText, location, remaining, reference, greenlit, qrToken: bookingToken }),
      attachments: [
        { filename: 'tickets.pdf', content: pdfBuffer.toString('base64') },
      ],
    });
  });
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

// Event edited (organiser or admin): notify the organiser + every backer of the diff.
export function notifyEventUpdated({ eventTitle, changes = [], editedByAdmin = false, organiser = null, backers = [] }) {
  if (!changes.length) return;
  fireAndForget('eventUpdated', async () => {
    const recipients = [];
    if (organiser?.email) recipients.push(organiser);
    for (const b of backers) if (b?.email) recipients.push(b);
    await Promise.all(recipients.map((r) =>
      send('eventUpdated', {
        to: r.email,
        subject: `Event updated: ${eventTitle}`,
        html: templates.eventUpdatedTemplate({ userName: r.username, role: r.role, eventTitle, changes, editedByAdmin }),
      }),
    ));
  });
}

// #4 — event cancelled: full-refund email to every backer + a summary to the organiser.
// `reason` is 'missed_threshold' | 'organiser' | 'admin' (with optional reasonText).
export function notifyEventCancelled({ eventTitle, reason, reasonText, backers = [], organiser = null }) {
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
            reasonText,
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
