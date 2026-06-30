/**
 * HTML email templates for party.fun.
 *
 * Email clients (Gmail especially) strip `<style>` selectively — notably they
 * ignore `display:flex` and don't load custom web fonts — so the brand logo,
 * detail rows and buttons are all built with INLINE styles + table layout and a
 * web-safe font stack to render consistently everywhere.
 */

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Where email buttons send the user. Override APP_BASE_URL for a deployed site.
const APP_URL = process.env.APP_BASE_URL || 'http://localhost:5173';

const FONT = 'Arial, Helvetica, sans-serif';

// Email-safe brand logo: an orange rounded "p" box + "party.fun" wordmark, all inline.
const logo = () => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
    <tr>
      <td style="vertical-align:middle;padding-right:10px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="width:36px;height:36px;background-color:#ff4d2e;border-radius:9px;text-align:center;vertical-align:middle;font-family:${FONT};font-weight:800;font-size:22px;line-height:36px;color:#000000;">p</td>
        </tr></table>
      </td>
      <td style="vertical-align:middle;font-family:${FONT};font-weight:800;font-size:24px;letter-spacing:-0.5px;color:#ffffff;">party<span style="color:#ff4d2e;">.fun</span></td>
    </tr>
  </table>
`;

// One "Label: Value" line (grey label, white/accent value) — no flexbox.
const row = (label, value, valueColor = '#ffffff') =>
  `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;font-family:${FONT};"><span style="color:#9ca3af;">${label}:</span> <span style="color:${valueColor};font-weight:600;">${value}</span></p>`;

const detailsBox = (title, rowsHtml) => `
  <div style="background-color:#171725;border:1px solid #1f1f2e;border-radius:12px;padding:24px;margin-bottom:30px;">
    <div style="font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:#ff4d2e;font-weight:700;margin-bottom:14px;font-family:${FONT};">${title}</div>
    ${rowsHtml}
  </div>
`;

const button = (label, href, bg = '#ff4d2e') => `
  <div style="text-align:center;margin-top:30px;">
    <a href="${href}" style="display:inline-block;background-color:${bg};color:#ffffff;text-decoration:none;padding:13px 30px;font-weight:700;font-size:15px;border-radius:9999px;font-family:${FONT};">${label}</a>
  </div>
`;

const sgDateTime = (iso, fallback) =>
  iso
    ? new Date(iso).toLocaleDateString('en-SG', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : fallback;

const h1 = (text) => `<h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;font-family:${FONT};">${text}</h1>`;
const p = (text) => `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#9ca3af;font-family:${FONT};">${text}</p>`;
const divider = '<div style="height:1px;background-color:#1f1f2e;margin:14px 0;"></div>';
// Shared dark shell. Layout styles live in <style>; brand/content styling is inline.
const emailShell = (content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>party.fun</title>
</head>
<body style="margin:0;padding:0;background-color:#0b0b0f;color:#f3f4f6;font-family:${FONT};">
  <div style="width:100%;background-color:#0b0b0f;padding:40px 20px;box-sizing:border-box;">
    <div style="max-width:600px;margin:0 auto;background-color:#12121a;border:1px solid #1f1f2e;border-radius:16px;overflow:hidden;">
      <div style="padding:30px 40px 24px;text-align:center;border-bottom:1px solid #1f1f2e;">
        ${logo()}
      </div>
      <div style="padding:40px;">
        ${content}
      </div>
      <div style="padding:30px 40px;text-align:center;font-size:12px;color:#4b5563;border-top:1px solid #1f1f2e;background-color:#0e0e14;font-family:${FONT};">
        &copy; 2026 party.fun. All campus rights reserved.<br>
        This is a transactional notification for your party.fun activity.
      </div>
    </div>
  </div>
</body>
</html>
`;

// Recipient identity line, e.g. "Hi user123 (User)," — makes a shared demo inbox unambiguous.
const roleLabel = (role) => (role === 'organiser' ? 'Organiser' : 'User');
const greet = (name, role) => p(`Hi ${name} (${roleLabel(role)}),`);

export function passwordResetTemplate({ userName, role, code }) {
  return emailShell(`
    ${h1('Reset your password')}
    ${greet(userName || 'there', role)}
    ${p('Use the 6-digit code below to reset your party.fun password. It expires in 10 minutes.')}
    <div style="text-align:center;margin:24px 0;">
      <div style="display:inline-block;background-color:#171725;border:1px solid #1f1f2e;border-radius:12px;padding:18px 28px;font-family:${FONT};font-size:32px;font-weight:800;letter-spacing:10px;color:#ffffff;">${code}</div>
    </div>
    ${p("If you didn't request this, you can safely ignore this email — your password won't change.")}
  `);
}

export function accountCreatedTemplate({ userName, role }) {
  const accountType = role === 'organiser' ? 'Organiser' : 'Attendee';
  return emailShell(`
    ${h1('Welcome to party.fun!')}
    ${greet(userName, role)}
    ${p(`Your <strong>${accountType}</strong> account has been created successfully. You're all set to ${role === 'organiser' ? 'spin up events, set hype thresholds and rally your crowd' : 'pledge for events and lock in your spot before they greenlight'}.`)}
    ${detailsBox('Account Details', row('Username', userName) + row('Account type', accountType))}
    ${button('Open party.fun', `${APP_URL}/login`)}
  `);
}

export function pledgeConfirmedTemplate({ userName, role, eventTitle, qty, pricePerTicket, total, deadline }) {
  const safeName = escapeHtml(userName);
  const safeTitle = escapeHtml(eventTitle);
  const formattedTotal = Number(total).toFixed(2);
  const formattedPrice = Number(pricePerTicket).toFixed(2);
  const formattedDeadline = sgDateTime(deadline, 'the funding deadline');

  return emailShell(`
    ${h1('Pledge Confirmed! 🚀')}
    ${greet(safeName, role)}
    ${p(`Your pledge to <strong>${safeTitle}</strong> is confirmed. Your payment of <strong>$${formattedTotal}</strong> has been <strong>captured</strong> and your tickets are locked in.`)}
    ${detailsBox('Pledge Details',
      row('Event', safeTitle) +
      row('Tickets', qty) +
      row('Price per ticket', `$${formattedPrice}`) +
      divider +
      row('Total Captured', `$${formattedTotal}`, '#ff4d2e'),
    )}
    ${p(`If this event does not reach its hype threshold by <strong>${formattedDeadline}</strong>, it will not greenlight and your payment will be refunded automatically.`)}
    ${button('View My Pledges', `${APP_URL}/joined-events`)}
  `);
}

// Booking ticket: the printable PDF (one per-ticket QR per page) is attached to
// this email. Each attendee shows their own ticket's QR at the door.
export function bookingTicketTemplate({ userName, role, eventTitle, dateText, location, remaining, reference, greenlit, qrToken }) {
  const lead = greenlit
    ? `Great news — <strong>${eventTitle}</strong> is greenlit and your spot is locked in! Your ticket${remaining === 1 ? '' : 's'} ${remaining === 1 ? 'is' : 'are'} attached.`
    : `Your pledge to <strong>${eventTitle}</strong> is confirmed. Your ticket${remaining === 1 ? '' : 's'} ${remaining === 1 ? 'is' : 'are'} attached.`;
  return emailShell(`
    ${h1(greenlit ? 'You’re in — event greenlit' : 'Your ticket')}
    ${greet(userName, role)}
    ${p(lead)}
    ${p(`<span style="color:#ff4d2e;font-weight:700;">Your ticket${remaining === 1 ? '' : 's'} ${remaining === 1 ? 'is' : 'are'} in the attached PDF (<strong>tickets.pdf</strong>).</span> It has one printable ticket with its own QR code per person — show each QR at the door to check in. QR codes are only valid during the event.`)}
    ${detailsBox('Ticket Details',
      row('Event', eventTitle) +
      (dateText ? row('When', dateText) : '') +
      (location ? row('Where', location) : '') +
      divider +
      row('Tickets', `${remaining}`, '#ff4d2e') +
      row('Reference', reference ?? '—'),
    )}
    ${qrToken ? button('Download your tickets (PDF)', `${APP_URL}/api/tickets/by-token/${qrToken}/pdf`) : ''}
  `);
}

export function eventCreatedTemplate({ organiserName, eventTitle, eventId, hypeThreshold, deadline }) {
  const formattedDeadline = sgDateTime(deadline, 'the funding deadline');
  const manageUrl = eventId ? `${APP_URL}/hosted-events/events/${eventId}/edit` : `${APP_URL}/hosted-events`;

  return emailShell(`
    ${h1('Your event is live!')}
    ${greet(organiserName, 'organiser')}
    ${p(`Your event <strong>${eventTitle}</strong> has been created and is now open for pledges. It will greenlight automatically once it reaches its hype threshold.`)}
    ${detailsBox('Event Details',
      row('Event', eventTitle) +
      row('Hype threshold', `${hypeThreshold} tickets`) +
      row('Deadline', formattedDeadline),
    )}
    ${button('Manage Event', manageUrl)}
  `);
}

export function coOrganiserInviteTemplate({ userName, inviterName, eventTitle, eventId }) {
  const inviteUrl = `${APP_URL}/pending-invites`;
  const eventUrl = eventId ? `${APP_URL}/events/${eventId}` : `${APP_URL}/events`;

  return emailShell(`
    ${h1('Co-organiser invite')}
    ${greet(userName || 'there', 'organiser')}
    ${p(`<strong>${inviterName || 'An organiser'}</strong> invited you to help manage <strong>${eventTitle}</strong> on party.fun.`)}
    ${detailsBox('What co-organisers can do',
      row('Allowed', 'Edit event details, view attendees, and check in tickets') +
      row('Not allowed', 'Cancel, hide, or delete the event'),
    )}
    ${p('Accept or decline the invite inside party.fun. This email is only a notification.')}
    ${button('Review Invite', inviteUrl)}
    ${button('View Event', eventUrl, '#374151')}
  `);
}

export function eventCancelledTemplate({ userName, role, method, eventTitle, refundAmount, reason, reasonText }) {
  const formattedRefund = Number(refundAmount || 0).toFixed(2);
  const missed = reason === 'missed_threshold';
  const byAdmin = reason === 'admin';
  const intro = byAdmin
    ? `<strong>${eventTitle}</strong> has been cancelled by a party.fun administrator.`
    : missed
    ? `Unfortunately, <strong>${eventTitle}</strong> did not reach its hype threshold by the deadline, so it has been cancelled.`
    : `The organiser has cancelled <strong>${eventTitle}</strong>.`;
  const card = method === 'card';
  const refundLine = card
    ? 'Your pledge has been <strong>refunded to your card</strong> — funds typically return within ~3–5 business days.'
    : 'Your pledge has been <strong>refunded to your party.fun wallet instantly</strong>.';
  const refundRowLabel = card ? 'Refunded to card' : 'Refunded to wallet';

  return emailShell(`
    ${h1('Event Cancelled')}
    ${greet(userName, role)}
    ${p(`${intro} ${refundLine} No action needed on your part.`)}
    ${byAdmin && reasonText ? detailsBox('Reason for cancellation', p(reasonText).replace('margin:0 0 20px', 'margin:0')) : ''}
    ${detailsBox('Refund Details',
      row('Event', eventTitle) +
      divider +
      row(refundRowLabel, `$${formattedRefund}`, '#ff4d2e'),
    )}
    ${p("We're sorry this one didn't happen — there are plenty more parties to back.")}
    ${button('Browse Other Events', `${APP_URL}/events`, '#374151')}
  `);
}

// Event edited (by the organiser or an admin) — sent to the organiser + every backer.
export function eventUpdatedTemplate({ userName, role, eventTitle, changes = [], editedByAdmin }) {
  const who = editedByAdmin ? 'A party.fun administrator' : 'The organiser';
  const rows = changes.map((c) => row(c.label, `${c.from} -> ${c.to}`)).join('');
  return emailShell(`
    ${h1('Event updated')}
    ${greet(userName, role)}
    ${p(`${who} updated <strong>${eventTitle}</strong>. Here's what changed:`)}
    ${detailsBox('Changes', rows || row('Details', 'updated'))}
    ${p('Your tickets remain valid. If the new details no longer work for you, you can manage your tickets from your profile.')}
    ${button('View Event', `${APP_URL}/events`, '#374151')}
  `);
}

export function eventCancelledOrganiserTemplate({ organiserName, eventTitle, reason, backerCount }) {
  const missed = reason === 'missed_threshold';
  const intro = missed
    ? `Your event <strong>${eventTitle}</strong> did not reach its hype threshold by the deadline and has been automatically cancelled.`
    : `Your event <strong>${eventTitle}</strong> has been cancelled.`;

  return emailShell(`
    ${h1('Event Cancelled')}
    ${greet(organiserName, 'organiser')}
    ${p(`${intro} ${backerCount > 0 ? `All <strong>${backerCount}</strong> backer${backerCount === 1 ? '' : 's'} have been refunded in full and notified by email.` : 'There were no active backers to refund.'}`)}
    ${detailsBox('Cancellation Summary',
      row('Event', eventTitle) +
      row('Reason', missed ? 'Missed threshold by deadline' : 'Cancelled by organiser') +
      row('Backers refunded', backerCount),
    )}
    ${button('Go to Dashboard', `${APP_URL}/hosted-events`)}
  `);
}

export function eventCompletedTemplate({ organiserName, eventTitle, revenue }) {
  const formattedRevenue = Number(revenue || 0).toFixed(2);
  return emailShell(`
    ${h1('Event Complete 🎉')}
    ${greet(organiserName, 'organiser')}
    ${p(`Your event <strong>${eventTitle}</strong> has wrapped up. Here's the revenue generated from ticket sales, paid out to your wallet.`)}
    ${detailsBox('Revenue Summary',
      row('Event', eventTitle) +
      row('Revenue from ticket sales', `$${formattedRevenue}`, '#29e07a'),
    )}
    ${p('Operational costs are handled outside party.fun and are not deducted here.')}
    ${button('Go to Dashboard', `${APP_URL}/hosted-events`)}
  `);
}

export function agentAdviceTemplate({ organiserName, eventTitle, tips = [] }) {
  const items = tips
    .map((t) => `<li style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#e5e7eb;"><strong style="color:#ffffff;">${t.title}</strong> — ${t.detail}</li>`)
    .join('');
  return emailShell(`
    ${h1('A few ways to boost your event 🚀')}
    ${greet(organiserName, 'organiser')}
    ${p(`Your event <strong>${eventTitle}</strong> is approaching its deadline and hasn't reached its hype threshold yet. Here are some ideas from the party.fun assistant to help it get there:`)}
    <div style="background-color:#171725;border:1px solid #1f1f2e;border-radius:12px;padding:20px 24px;margin-bottom:30px;">
      <ul style="margin:0;padding-left:18px;">${items}</ul>
    </div>
    ${p('Open your dashboard to make changes — or ask the in-app assistant and it can apply them for you (with your confirmation).')}
    ${button('Go to Dashboard', `${APP_URL}/hosted-events`)}
  `);
}

export function ticketsGivenAwayTemplate({ userName, role, eventTitle, qty, allGivenAway }) {
  const note = allGivenAway
    ? `You've given away <strong>all</strong> your tickets, so you will <strong>no longer be able to attend ${eventTitle}</strong>. The released spots have returned to the public pool.`
    : `You've given away <strong>${qty}</strong> ticket${qty === 1 ? '' : 's'} for <strong>${eventTitle}</strong>. Your remaining tickets are still active.`;

  return emailShell(`
    ${h1('Tickets Given Away')}
    ${greet(userName, role)}
    ${p(note)}
    ${detailsBox('Give-Away Details',
      row('Event', eventTitle) +
      row('Tickets given away', qty),
    )}
    ${p('Giving away tickets is final and non-refundable, as noted at the time.')}
    ${button('View My Events', `${APP_URL}/joined-events`)}
  `);
}

export function pledgeCancelledTemplate({ userName, eventTitle, qty, refundAmount }) {
  const formattedRefund = Number(refundAmount).toFixed(2);
  return emailShell(`
    ${h1('Pledge Cancelled')}
    ${p(`Hi ${userName},`)}
    ${p(`We have processed your pledge cancellation for <strong>${eventTitle}</strong>. Your spot has been freed and any pending hold has been cancelled.`)}
    ${detailsBox('Cancellation Details',
      row('Event', eventTitle) +
      row('Tickets cancelled', qty) +
      divider +
      row('Cancelled amount', `$${formattedRefund}`, '#ff3354'),
    )}
    ${p('Hope to see you at another party soon!')}
    ${button('Browse Other Events', `${APP_URL}/events`, '#374151')}
  `);
}

export function eventGreenlitTemplate({ userName, eventTitle, start_time, location }) {
  const formattedDate = sgDateTime(start_time, 'soon');
  return emailShell(`
    ${h1(`It's a Go! ${eventTitle} is Greenlit!`)}
    ${p(`Hi ${userName},`)}
    ${p(`Great news — <strong>${eventTitle}</strong> has reached its hype threshold and is officially <strong>GREENLIT</strong>! Your pledge is locked in.`)}
    ${detailsBox('Event Schedule & Location',
      row('Time & date', formattedDate) +
      row('Venue', location),
    )}
    ${p('Get ready to party! You can view your tickets in your profile.')}
    ${button('View My Events', `${APP_URL}/joined-events`)}
  `);
}
