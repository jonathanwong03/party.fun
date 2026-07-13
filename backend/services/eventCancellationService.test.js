import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cancelEventWithRefunds, dependencies } from './eventCancellationService.js';

describe('eventCancellationService', () => {
  const originalCancelEvent = dependencies.cancelEvent;
  const originalRefundEventCardBookings = dependencies.refundEventCardBookings;
  const originalNotifyEventCancelled = dependencies.notifyEventCancelled;

  let cancelCalled = null;
  let refundsCalled = null;
  let notifyCalled = null;

  beforeEach(() => {
    cancelCalled = null;
    refundsCalled = null;
    notifyCalled = null;

    dependencies.cancelEvent = async (sb, eventId, reason) => {
      cancelCalled = { eventId, reason };
      return { status: 'ok' };
    };

    dependencies.refundEventCardBookings = async (eventId) => {
      refundsCalled = { eventId };
    };

    dependencies.notifyEventCancelled = (payload) => {
      notifyCalled = payload;
    };
  });

  afterEach(() => {
    dependencies.cancelEvent = originalCancelEvent;
    dependencies.refundEventCardBookings = originalRefundEventCardBookings;
    dependencies.notifyEventCancelled = originalNotifyEventCancelled;
  });

  test('successfully cancels event with wallet and card refunds and dispatches notifications', async () => {
    const mockSb = {
      from: (table) => {
        if (table === 'EVENT') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { title: 'Rooftop Party' }, error: null })
              })
            })
          };
        }
        if (table === 'USER') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { email: 'host@smu.edu.sg', username: 'hostie' }, error: null })
              })
            })
          };
        }
      },
      rpc: (name) => {
        if (name === 'get_event_backer_contacts') {
          return {
            data: [
              { email: 'user1@smu.edu.sg', username: 'user1', role: 'user', paymentMethod: 'card', refundAmount: 10 },
              { email: 'user2@smu.edu.sg', username: 'user2', role: 'user', paymentMethod: 'wallet', refundAmount: 15 }
            ],
            error: null
          };
        }
      }
    };

    const res = await cancelEventWithRefunds(mockSb, 'host-id-123', 'event-id-123', 'Rain forecasted');
    
    assert.deepEqual(res, { status: 'ok' });
    assert.deepEqual(cancelCalled, { eventId: 'event-id-123', reason: 'Rain forecasted' });
    assert.deepEqual(refundsCalled, { eventId: 'event-id-123' });
    
    // Check notification dispatch payloads
    assert.ok(notifyCalled);
    assert.equal(notifyCalled.eventTitle, 'Rooftop Party');
    assert.equal(notifyCalled.reason, 'organiser');
    assert.equal(notifyCalled.backers.length, 2);
    assert.equal(notifyCalled.backers[0].email, 'user1@smu.edu.sg');
    assert.equal(notifyCalled.backers[1].paymentMethod, undefined); // mapped to method
    assert.equal(notifyCalled.backers[0].method, 'card');
    assert.deepEqual(notifyCalled.organiser, { email: 'host@smu.edu.sg', username: 'hostie' });
  });

  test('returns error when cancelEvent fails and does not process card refunds/notifications', async () => {
    dependencies.cancelEvent = async () => {
      return { error: 'not_owner' };
    };

    const mockSb = {};
    const res = await cancelEventWithRefunds(mockSb, 'host-id-123', 'event-id-123', 'Rain');
    
    assert.deepEqual(res, { error: 'not_owner' });
    assert.equal(refundsCalled, null);
    assert.equal(notifyCalled, null);
  });
});
