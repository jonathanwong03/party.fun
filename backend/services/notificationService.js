import { getUserById } from './userMemoryService.js';
import { getEvent, getEventBackers } from './eventMemoryService.js';
import * as templates from './emailTemplates.js';
import { sendEmail } from './emailProcessor.js';
import supabase from '../../config/supabase.js';

/**
 * Helper to log a notification attempt to the database (and console).
 * Maps to "Monitoring and Delivery Confirmation" in the System Design article.
 */
async function logNotification({ userId, email, eventId, type, subject, status, error }) {
  const sentAt = status === 'sent' ? new Date().toISOString() : null;
  
  console.log(`[NotificationService Log] Type: ${type} | To: ${email} | Status: ${status}${error ? ` | Error: ${error}` : ''}`);

  if (!supabase) {
    console.log('[NotificationService Log] Supabase client offline/not configured; skipped database log.');
    return;
  }

  try {
    // Attempt Supabase insert
    const { error: dbError } = await supabase
      .from('notification_logs')
      .insert({
        user_id: userId && userId.startsWith('user-') || userId === 'mock-user-jamie' ? userId : null, // only valid UUID/IDs
        recipient_email: email,
        event_id: eventId,
        notification_type: type,
        subject,
        status,
        error_message: error || null,
        sent_at: sentAt
      });
      
    if (dbError) {
      // Don't throw - notifications shouldn't crash the main thread
      console.warn(`[NotificationService] Supabase log warning: ${dbError.message}`);
    }
  } catch (dbErr) {
    console.warn(`[NotificationService] Supabase log warning: ${dbErr.message}`);
  }
}

/**
 * Orchestrates sending a pledge confirmation email.
 * Runs asynchronously to prevent blocking the HTTP API response.
 */
export function notifyPledgeConfirmed(userId, eventId, qty, amount) {
  // Fire-and-forget async wrapper
  (async () => {
    try {
      const user = getUserById(userId);
      const event = getEvent(eventId);
      
      if (!user) {
        console.error(`[NotificationService] Cannot confirm pledge: User ${userId} not found.`);
        return;
      }
      if (!event) {
        console.error(`[NotificationService] Cannot confirm pledge: Event ${eventId} not found.`);
        return;
      }

      const email = user.email;
      const subject = `Pledge Confirmed: ${event.title} 🚀`;
      const total = qty * amount; // Subtotal for tickets

      const html = templates.pledgeConfirmedTemplate({
        userName: user.username,
        eventTitle: event.title,
        qty,
        pricePerTicket: amount,
        total,
        deadline: event.deadline
      });

      const result = await sendEmail({ to: email, subject, html });

      await logNotification({
        userId,
        email,
        eventId,
        type: 'pledge_confirmed',
        subject,
        status: result.success ? 'sent' : 'failed',
        error: result.error
      });

    } catch (error) {
      console.error('[NotificationService] Error in notifyPledgeConfirmed:', error);
    }
  })();
}

/**
 * Orchestrates sending a pledge cancellation/refund email.
 * Runs asynchronously to prevent blocking the HTTP API response.
 */
export function notifyPledgeCancelled(userId, eventId, qty, refundAmount) {
  // Fire-and-forget async wrapper
  (async () => {
    try {
      const user = getUserById(userId);
      const event = getEvent(eventId);
      
      if (!user) {
        console.error(`[NotificationService] Cannot cancel pledge: User ${userId} not found.`);
        return;
      }
      if (!event) {
        console.error(`[NotificationService] Cannot cancel pledge: Event ${eventId} not found.`);
        return;
      }

      const email = user.email;
      const subject = `Pledge Cancelled: ${event.title}`;

      const html = templates.pledgeCancelledTemplate({
        userName: user.username,
        eventTitle: event.title,
        qty,
        refundAmount
      });

      const result = await sendEmail({ to: email, subject, html });

      await logNotification({
        userId,
        email,
        eventId,
        type: 'pledge_cancelled',
        subject,
        status: result.success ? 'sent' : 'failed',
        error: result.error
      });

    } catch (error) {
      console.error('[NotificationService] Error in notifyPledgeCancelled:', error);
    }
  })();
}

/**
 * Orchestrates sending greenlight emails to ALL backers of an event.
 * Runs asynchronously to prevent blocking the HTTP API response.
 */
export function notifyEventGreenlit(eventId) {
  // Fire-and-forget async wrapper
  (async () => {
    try {
      const event = getEvent(eventId);
      if (!event) {
        console.error(`[NotificationService] Cannot send greenlit alerts: Event ${eventId} not found.`);
        return;
      }

      const backerIds = getEventBackers(eventId);
      if (backerIds.length === 0) {
        console.log(`[NotificationService] Event ${event.title} greenlit, but has 0 backers to notify.`);
        return;
      }

      console.log(`[NotificationService] Event ${event.title} is greenlit! Notifying ${backerIds.length} backer(s)...`);

      // Send emails to all backers in parallel
      const notificationPromises = backerIds.map(async (userId) => {
        const user = getUserById(userId);
        if (!user) return;

        const email = user.email;
        const subject = `It's a Go! 🎉 ${event.title} is Greenlit!`;

        const html = templates.eventGreenlitTemplate({
          userName: user.username,
          eventTitle: event.title,
          start_time: event.start_time || event.date, // support both schema field & mock field
          location: event.location,
          backers_count: event.backers
        });

        const result = await sendEmail({ to: email, subject, html });

        await logNotification({
          userId,
          email,
          eventId,
          type: 'event_greenlit',
          subject,
          status: result.success ? 'sent' : 'failed',
          error: result.error
        });
      });

      await Promise.all(notificationPromises);

    } catch (error) {
      console.error('[NotificationService] Error in notifyEventGreenlit:', error);
    }
  })();
}
