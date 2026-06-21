/**
 * HTML Email Templates for party.fun
 * Follows modern responsive email design matching the party.fun dark-theme aesthetic.
 */

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Shared dark theme shell for email consistency
const emailShell = (content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>party.fun</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0b0b0f;
      color: #f3f4f6;
    }
    .wrapper {
      width: 100%;
      background-color: #0b0b0f;
      padding: 40px 20px;
      box-sizing: border-box;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #12121a;
      border: 1px solid #1f1f2e;
      border-radius: 16px;
      overflow: hidden;
    }
    .header {
      padding: 30px 40px 20px;
      text-align: center;
      border-bottom: 1px solid #1f1f2e;
    }
    .logo {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.03em;
      color: #ffffff;
      text-decoration: none;
    }
    .logo span {
      color: #ff4d2e;
    }
    .content {
      padding: 40px;
    }
    h1 {
      margin-top: 0;
      font-size: 22px;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.3;
    }
    p {
      font-size: 15px;
      line-height: 1.6;
      color: #9ca3af;
      margin: 0 0 20px;
    }
    .details-box {
      background-color: #171725;
      border: 1px solid #1f1f2e;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 30px;
    }
    .details-title {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #ff4d2e;
      font-weight: 700;
      margin-bottom: 12px;
    }
    .details-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .details-row:last-child {
      margin-bottom: 0;
    }
    .details-label {
      color: #9ca3af;
    }
    .details-value {
      color: #ffffff;
      font-weight: 600;
      text-align: right;
    }
    .divider {
      height: 1px;
      background-color: #1f1f2e;
      margin: 16px 0;
    }
    .total-row {
      font-size: 16px;
      font-weight: 700;
    }
    .total-value {
      color: #ff4d2e;
    }
    .btn {
      display: inline-block;
      background-color: #ff4d2e;
      color: #ffffff !important;
      text-decoration: none;
      padding: 12px 28px;
      font-weight: 700;
      font-size: 15px;
      border-radius: 9999px;
      text-align: center;
      transition: background-color 0.2s;
    }
    .footer {
      padding: 30px 40px;
      text-align: center;
      font-size: 12px;
      color: #4b5563;
      border-top: 1px solid #1f1f2e;
      background-color: #0e0e14;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <a href="https://party.fun" class="logo">party<span>.fun</span></a>
      </div>
      <div class="content">
        ${content}
      </div>
      <div class="footer">
        &copy; 2026 party.fun. All campus rights reserved.<br>
        This is a transactional receipt for your crowdfunding pledge.
      </div>
    </div>
  </div>
</body>
</html>
`;

export function pledgeConfirmedTemplate({ userName, eventTitle, qty, pricePerTicket, total, deadline }) {
  const safeName = escapeHtml(userName);
  const safeTitle = escapeHtml(eventTitle);
  const formattedTotal = Number(total).toFixed(2);
  const formattedPrice = Number(pricePerTicket).toFixed(2);
  const formattedDeadline = deadline ? new Date(deadline).toLocaleDateString('en-SG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : 'the funding deadline';

  return emailShell(`
    <h1>Pledge Confirmed! 🚀</h1>
    <p>Hi ${safeName},</p>
    <p>Your pledge to <strong>${safeTitle}</strong> is confirmed. Your payment of <strong>$${formattedTotal}</strong> has been <strong>captured</strong> and your tickets are locked in.</p>
    
    <div class="details-box">
      <div class="details-title">Pledge Details</div>
      <div class="details-row">
        <span class="details-label">Event</span>
        <span class="details-value">${safeTitle}</span>
      </div>
      <div class="details-row">
        <span class="details-label">Tickets</span>
        <span class="details-value">${qty}</span>
      </div>
      <div class="details-row">
        <span class="details-label">Price per Ticket</span>
        <span class="details-value">$${formattedPrice}</span>
      </div>
      <div class="divider"></div>
      <div class="details-row total-row">
        <span class="details-label" style="color:#ffffff;">Total Captured</span>
        <span class="details-value total-value">$${formattedTotal}</span>
      </div>
    </div>
    
    <p>If this event does not reach its hype threshold by <strong>${formattedDeadline}</strong>, it will not greenlight and your payment will be refunded automatically.</p>
    
    <div style="text-align: center; margin-top: 30px;">
      <a href="https://party.fun" class="btn">View My Pledges</a>
    </div>
  `);
}

export function pledgeCancelledTemplate({ userName, eventTitle, qty, refundAmount }) {
  const formattedRefund = Number(refundAmount).toFixed(2);

  return emailShell(`
    <h1>Pledge Cancelled</h1>
    <p>Hi ${userName},</p>
    <p>We have processed your pledge cancellation for <strong>${eventTitle}</strong>. Since you cancelled before the campaign ended, your spot has been freed and any pending hold has been cancelled.</p>
    
    <div class="details-box">
      <div class="details-title">Cancellation Details</div>
      <div class="details-row">
        <span class="details-label">Event</span>
        <span class="details-value">${eventTitle}</span>
      </div>
      <div class="details-row">
        <span class="details-label">Tickets Cancelled</span>
        <span class="details-value">${qty}</span>
      </div>
      <div class="divider"></div>
      <div class="details-row total-row">
        <span class="details-label" style="color:#ffffff;">Cancelled Amount</span>
        <span class="details-value" style="color:#ff3354;">$${formattedRefund}</span>
      </div>
    </div>
    
    <p>Hope to see you at another party soon!</p>
    
    <div style="text-align: center; margin-top: 30px;">
      <a href="https://party.fun" class="btn" style="background-color:#374151;">Browse Other Events</a>
    </div>
  `);
}

export function eventGreenlitTemplate({ userName, eventTitle, start_time, location, backers_count }) {
  const formattedDate = start_time ? new Date(start_time).toLocaleDateString('en-SG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : 'soon';

  return emailShell(`
    <h1>It's a Go! 🎉 ${eventTitle} is Greenlit!</h1>
    <p>Hi ${userName},</p>
    <p>Incredible news! <strong>${eventTitle}</strong> has reached its target of <strong>${backers_count} backers</strong> and has officially been <strong>GREENLIT</strong>! The party is officially on!</p>
    
    <p>Your pledge is now locked in, and the organiser is gearing up for the event. Here are the event details for your calendar:</p>
    
    <div class="details-box">
      <div class="details-title">Event Schedule & Location</div>
      <div class="details-row">
        <span class="details-label">Time & Date</span>
        <span class="details-value">${formattedDate}</span>
      </div>
      <div class="details-row">
        <span class="details-label">Venue</span>
        <span class="details-value">${location}</span>
      </div>
    </div>
    
    <p>Get ready to party! You can view your ticket and QR codes in your profile section.</p>
    
    <div style="text-align: center; margin-top: 30px;">
      <a href="https://party.fun" class="btn">Get Tickets & QR Code</a>
    </div>
  `);
}
