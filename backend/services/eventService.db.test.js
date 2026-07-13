import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getHostedSummary,
  getEventAttendees,
  getEventAttendeesPrivate,
  giveAwayTickets,
  deleteBooking,
  listDrafts,
  saveDraft,
  deleteDraft,
  createEvent,
  updateEvent,
  deleteEvent,
  hideEvent,
  listCoOrganiserInvites,
  inviteCoOrganiser,
  respondCoOrganiserInvite,
  dependencies,
} from './eventService.js';

describe('eventService Additional Database helpers', () => {
  let rpcCalls = [];
  let fromCalls = [];
  let syncEventCalled = null;
  let syncDraftCalled = null;
  let deleteDraftEmbeddingCalled = null;

  const originalSyncEvent = dependencies.syncEventEmbedding;
  const originalSyncDraft = dependencies.syncDraftEmbedding;
  const originalDeleteDraftEmb = dependencies.deleteDraftEmbedding;

  beforeEach(() => {
    rpcCalls = [];
    fromCalls = [];
    syncEventCalled = null;
    syncDraftCalled = null;
    deleteDraftEmbeddingCalled = null;

    dependencies.syncEventEmbedding = (sb, eventId, event) => {
      syncEventCalled = { eventId, event };
    };

    dependencies.syncDraftEmbedding = (sb, draftId, userId, draft) => {
      syncDraftCalled = { draftId, userId, draft };
    };

    dependencies.deleteDraftEmbedding = (sb, draftId) => {
      deleteDraftEmbeddingCalled = { draftId };
    };
  });

  afterEach(() => {
    dependencies.syncEventEmbedding = originalSyncEvent;
    dependencies.syncDraftEmbedding = originalSyncDraft;
    dependencies.deleteDraftEmbedding = originalDeleteDraftEmb;
  });

  const mockSb = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === 'get_hosted_revenue') {
        return { data: { events: [{ eventId: 'evt-1', revenue: 120 }], totalRevenue: 120 }, error: null };
      }
      if (name === 'get_events') {
        return {
          data: [
            { id: 'evt-1', hostId: 'user-1', title: 'Gig', derived_status: 'early_bird', statuses: [] }
          ],
          error: null
        };
      }
      if (name === 'get_event_attendees') {
        return { data: [{ name: 'Attendee 1', username: 'att1' }], error: null };
      }
      if (name === 'get_event_attendees_private') {
        return { data: [{ name: 'Attendee 1', username: 'att1', email: 'att1@test.com' }], error: null };
      }
      if (name === 'get_profile') {
        return { data: { tickets: [] }, error: null };
      }
      if (name === 'give_away_tickets') {
        return { data: { status: 'ok' }, error: null };
      }
      if (name === 'soft_delete_booking') {
        return { data: { status: 'ok' }, error: null };
      }
      if (name === 'create_event') {
        return { data: { status: 'ok', eventId: 'new-evt-123' }, error: null };
      }
      if (name === 'update_event') {
        return { data: { status: 'ok' }, error: null };
      }
      if (name === 'delete_event') {
        return { data: { status: 'ok' }, error: null };
      }
      if (name === 'hide_event') {
        return { data: { status: 'ok' }, error: null };
      }
      if (name === 'get_coorganiser_invites') {
        return { data: [{ inviteId: 'invite-1', status: 'pending' }], error: null };
      }
      if (name === 'invite_coorganiser') {
        return { data: { status: 'ok' }, error: null };
      }
      if (name === 'respond_coorganiser_invite') {
        return { data: { status: 'ok' }, error: null };
      }
      return { data: null, error: null };
    },
    from: (table) => {
      return {
        select: (cols) => {
          fromCalls.push({ table, select: cols });
          return {
            eq: (col, val) => {
              fromCalls.push({ table, eqCol: col, eqVal: val });
              return {
                single: async () => {
                  if (table === 'BOOKINGS') return { data: { eventId: 'evt-1' }, error: null };
                  if (table === 'EVENT_DRAFTS') return { data: { id: 'draft-1', payload: { title: 'Old Draft' } }, error: null };
                  return { data: null, error: null };
                }
              };
            },
            order: async (col, opts) => {
              fromCalls.push({ table, orderCol: col, orderOpts: opts });
              return { data: [{ id: 'draft-1', payload: { title: 'My Draft' } }], error: null };
            }
          };
        },
        update: (payload) => {
          fromCalls.push({ table, updatePayload: payload });
          return {
            eq: (col, val) => {
              fromCalls.push({ table, eqCol: col, eqVal: val });
              return {
                select: () => ({
                  single: async () => ({ data: { id: 'draft-1', payload: payload.payload }, error: null })
                })
              };
            }
          };
        },
        insert: (payload) => {
          fromCalls.push({ table, insertPayload: payload });
          return {
            select: () => ({
              single: async () => ({ data: { id: 'draft-2', payload: payload.payload }, error: null })
            })
          };
        },
        delete: () => {
          fromCalls.push({ table, deleted: true });
          return {
            eq: async (col, val) => {
              fromCalls.push({ table, eqCol: col, eqVal: val });
              return { error: null };
            }
          };
        }
      };
    }
  };

  test('getHostedSummary compiles revenue maps and event status metrics', async () => {
    const res = await getHostedSummary(mockSb, 'user-1');
    assert.deepEqual(res, {
      revenueByEvent: { 'evt-1': 120 },
      totalRevenue: 120,
      totalEvents: 1,
      upcoming: 1,
      confirmed: 0
    });
    assert.equal(rpcCalls.some((c) => c.name === 'get_hosted_revenue'), true);
  });

  test('getEventAttendees returns list of public attendee entries', async () => {
    const res = await getEventAttendees(mockSb, 'evt-1');
    assert.deepEqual(res, [{ name: 'Attendee 1', username: 'att1' }]);
    assert.deepEqual(rpcCalls[rpcCalls.length - 1], { name: 'get_event_attendees', args: { p_event_id: 'evt-1' } });
  });

  test('getEventAttendeesPrivate handles RLS forbidden violations cleanly', async () => {
    const forbiddenSb = {
      rpc: async () => ({ data: null, error: { code: '42501', message: 'not_host' } })
    };
    const res = await getEventAttendeesPrivate(forbiddenSb, 'evt-1');
    assert.deepEqual(res, { error: 'forbidden' });
  });

  test('giveAwayTickets releases quantity and triggers profile/events refresh', async () => {
    const res = await giveAwayTickets(mockSb, 'user-1', 'booking-1', 2);
    assert.ok(res.profile);
    assert.equal(rpcCalls.some((c) => c.name === 'give_away_tickets'), true);
  });

  test('deleteBooking triggers soft deletion RPC and refresh', async () => {
    const res = await deleteBooking(mockSb, 'user-1', 'booking-1');
    assert.ok(res.profile);
    assert.equal(rpcCalls.some((c) => c.name === 'soft_delete_booking'), true);
  });

  test('listDrafts returns mapper payloads', async () => {
    const drafts = await listDrafts(mockSb);
    assert.deepEqual(drafts, [{ id: 'draft-1', title: 'My Draft' }]);
  });

  test('saveDraft updates existing draft and syncs vector embeddings', async () => {
    const draftPayload = { id: '00000000-0000-0000-0000-000000000000', title: 'New Draft' };
    const saved = await saveDraft(mockSb, 'user-1', draftPayload);
    
    assert.equal(saved.id, 'draft-1');
    assert.deepEqual(saved.title, 'New Draft');
    assert.ok(syncDraftCalled);
    assert.equal(syncDraftCalled.draftId, 'draft-1');
  });

  test('saveDraft inserts a brand new draft if no UUID id is provided', async () => {
    const draftPayload = { title: 'New Inserted Draft' };
    const saved = await saveDraft(mockSb, 'user-1', draftPayload);
    
    assert.equal(saved.id, 'draft-2');
    assert.deepEqual(saved.title, 'New Inserted Draft');
    assert.ok(syncDraftCalled);
    assert.equal(syncDraftCalled.draftId, 'draft-2');
  });

  test('deleteDraft deletes DB entry and de-indexes draft embedding', async () => {
    await deleteDraft(mockSb, 'draft-1');
    assert.ok(deleteDraftEmbeddingCalled);
    assert.equal(deleteDraftEmbeddingCalled.draftId, 'draft-1');
  });

  test('createEvent RPC mapping', async () => {
    const event = { title: 'New Gala', statuses: [{ statusName: 'early_bird', price: 10, qty: 5 }] };
    const res = await createEvent(mockSb, event);
    assert.deepEqual(res, { eventId: 'new-evt-123' });
    assert.ok(syncEventCalled);
    assert.equal(syncEventCalled.eventId, 'new-evt-123');
  });

  test('updateEvent RPC mapping', async () => {
    const event = { id: 'evt-1', title: 'Updated Gala' };
    const res = await updateEvent(mockSb, event);
    assert.deepEqual(res, { status: 'ok' });
    assert.ok(syncEventCalled);
    assert.equal(syncEventCalled.eventId, 'evt-1');
  });

  test('deleteEvent RPC mapping', async () => {
    const res = await deleteEvent(mockSb, 'evt-1');
    assert.deepEqual(res, { status: 'ok' });
  });

  test('hideEvent RPC mapping', async () => {
    const res = await hideEvent(mockSb, 'evt-1');
    assert.deepEqual(res, { status: 'ok' });
  });

  test('listCoOrganiserInvites RPC mapping', async () => {
    const invites = await listCoOrganiserInvites(mockSb);
    assert.deepEqual(invites, [{ inviteId: 'invite-1', status: 'pending' }]);
  });

  test('inviteCoOrganiser RPC mapping', async () => {
    const res = await inviteCoOrganiser(mockSb, 'evt-1', 'colleague@test.com');
    assert.deepEqual(res, { status: 'ok' });
  });

  test('respondCoOrganiserInvite RPC mapping', async () => {
    const res = await respondCoOrganiserInvite(mockSb, 'invite-1', 'accept');
    assert.deepEqual(res, { status: 'ok' });
  });
});
