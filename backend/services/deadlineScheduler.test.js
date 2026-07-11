import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runOnce, startDeadlineScheduler, dependencies } from './deadlineScheduler.js';

describe('deadlineScheduler', () => {
  const originalAdminClient = dependencies.adminClient;
  const originalNotifyEventCancelled = dependencies.notifyEventCancelled;
  const originalNotifyEventCompleted = dependencies.notifyEventCompleted;
  const originalRefundEventCardBookings = dependencies.refundEventCardBookings;
  const originalReconcilePayments = dependencies.reconcilePayments;
  const originalSetTimeout = dependencies.setTimeout;
  const originalSetInterval = dependencies.setInterval;

  let notifyCancelledPayloads = [];
  let notifyCompletedPayloads = [];
  let refundCardBookingsCalls = [];
  let reconcilePaymentsCalled = false;
  let expiredEventsData = [];
  let completedEventsData = [];
  let mockEvent = null;
  let mockOrganiser = null;
  let mockBookings = [];
  let mockBackers = [];

  beforeEach(() => {
    notifyCancelledPayloads = [];
    notifyCompletedPayloads = [];
    refundCardBookingsCalls = [];
    reconcilePaymentsCalled = false;
    expiredEventsData = [];
    completedEventsData = [];
    mockEvent = { title: 'Rooftop Bar Party', hostId: 'host-123', profit: 150 };
    mockOrganiser = { email: 'host@test.com', username: 'hostie' };
    mockBookings = [{ userId: 'backer-1', refundedAmount: 25, paymentMethod: 'card' }];
    mockBackers = [{ id: 'backer-1', email: 'backer1@test.com', username: 'backer1', role: 'user' }];

    dependencies.adminClient = () => ({
      rpc: async (name) => {
        if (name === 'expire_overdue_events') {
          return { data: expiredEventsData, error: null };
        }
        if (name === 'complete_due_events') {
          return { data: completedEventsData, error: null };
        }
        return { data: null, error: null };
      },
      from: (table) => {
        return {
          select: () => ({
            eq: (col, val) => {
              if (table === 'BOOKINGS') {
                return {
                  is: async () => ({ data: mockBookings, error: null })
                };
              }
              return {
                single: async () => {
                  if (table === 'EVENT') return { data: mockEvent, error: null };
                  if (table === 'USER') return { data: mockOrganiser, error: null };
                  return { data: null, error: null };
                }
              };
            },
            in: async () => {
              return { data: mockBackers, error: null };
            }
          })
        };
      }
    });

    dependencies.notifyEventCancelled = (payload) => {
      notifyCancelledPayloads.push(payload);
    };

    dependencies.notifyEventCompleted = (payload) => {
      notifyCompletedPayloads.push(payload);
    };

    dependencies.refundEventCardBookings = async (eventId) => {
      refundCardBookingsCalls.push(eventId);
    };

    dependencies.reconcilePayments = async () => {
      reconcilePaymentsCalled = true;
      return { scanned: 0, refunded: 0 };
    };
  });

  afterEach(() => {
    dependencies.adminClient = originalAdminClient;
    dependencies.notifyEventCancelled = originalNotifyEventCancelled;
    dependencies.notifyEventCompleted = originalNotifyEventCompleted;
    dependencies.refundEventCardBookings = originalRefundEventCardBookings;
    dependencies.reconcilePayments = originalReconcilePayments;
    dependencies.setTimeout = originalSetTimeout;
    dependencies.setInterval = originalSetInterval;
  });

  test('expired event auto-cancellation processes card refunds & dispatches backer notifications', async () => {
    expiredEventsData = [{ event_id: 'evt-expired-123' }];

    await runOnce();

    assert.deepEqual(refundCardBookingsCalls, ['evt-expired-123']);
    assert.equal(notifyCancelledPayloads.length, 1);
    assert.equal(notifyCancelledPayloads[0].eventTitle, 'Rooftop Bar Party');
    assert.equal(notifyCancelledPayloads[0].reason, 'missed_threshold');
    assert.equal(notifyCancelledPayloads[0].backers.length, 1);
    assert.equal(notifyCancelledPayloads[0].backers[0].email, 'backer1@test.com');
    assert.equal(notifyCancelledPayloads[0].backers[0].refundAmount, 25);
    assert.equal(notifyCancelledPayloads[0].backers[0].method, 'card');
    assert.deepEqual(notifyCancelledPayloads[0].organiser, { email: 'host@test.com', username: 'hostie' });
    assert.equal(reconcilePaymentsCalled, true);
  });

  test('completed event payout triggers notifications to organizer with total revenue', async () => {
    completedEventsData = [{ event_id: 'evt-completed-456' }];

    await runOnce();

    assert.equal(notifyCompletedPayloads.length, 1);
    assert.equal(notifyCompletedPayloads[0].eventTitle, 'Rooftop Bar Party');
    assert.equal(notifyCompletedPayloads[0].revenue, 150);
    assert.equal(notifyCompletedPayloads[0].eventId, 'evt-completed-456');
    assert.deepEqual(notifyCompletedPayloads[0].organiser, { userId: undefined, email: 'host@test.com', username: 'hostie' });
  });

  test('startDeadlineScheduler configures correct timers for ticking checks', () => {
    let timeoutSet = null;
    let intervalSet = null;

    dependencies.setTimeout = (fn, ms) => {
      timeoutSet = { fn, ms };
    };

    dependencies.setInterval = (fn, ms) => {
      intervalSet = { fn, ms };
    };

    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_key_here';
    startDeadlineScheduler();

    assert.ok(timeoutSet);
    assert.ok(intervalSet);
    assert.equal(timeoutSet.ms, 10000); // FIRST_RUN_DELAY_MS
    assert.equal(intervalSet.ms, 5 * 60 * 1000); // DEFAULT_INTERVAL_MS
  });
});
