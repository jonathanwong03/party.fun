import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { postPledge, dependencies } from './checkoutController.js';

function mockSupabase() {
  return {
    from(table) {
      if (table === 'USER') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { email: 'user@smu.edu.sg', username: 'jamie', role: 'user' } }),
            }),
          }),
        };
      }
      if (table === 'EVENT') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  title: 'Campus Party',
                  location: 'Hall',
                  address: '123456',
                  startDate: '2026-12-01T18:00:00+08:00',
                },
              }),
            }),
          }),
        };
      }
      if (table === 'TICKETS') {
        return {
          select: () => ({
            eq: async () => ({ data: [{ qrCode: 'PF-1', status: 'active', bookingId: 1 }] }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe('postPledge', () => {
  const sendCalls = [];
  const original = { ...dependencies };

  beforeEach(() => {
    sendCalls.length = 0;
    Object.assign(dependencies, original);
    dependencies.getEvent = async () => ({
      status: 'early_bird',
      title: 'Campus Party',
      deadline: '2026-12-15T18:00:00+08:00',
    });
    dependencies.createPledge = async () => ({
      bookingId: 1,
      qrToken: 'qr-token',
      reference: 'PF-ABCD-1234',
      event: {
        title: 'Campus Party',
        price: 15,
        status: 'early_bird',
        deadline: '2026-12-15T18:00:00+08:00',
      },
      profile: {
        profile: { email: 'user@smu.edu.sg', handle: 'jamie', fullName: 'Jamie' },
      },
    });
    dependencies.notifyPledgeConfirmed = async (params) => {
      sendCalls.push(params);
    };
    dependencies.notifyBookingTicket = async () => {};
    dependencies.notifyEventGreenlit = async () => {};
  });

  it('returns ok and triggers pledge confirmed notification on success', async () => {
    const res = createMockRes();
    await postPledge(
      {
        supabase: mockSupabase(),
        user: { id: 'user-1' },
        params: { eventId: 'event-1' },
        body: { qty: 2 },
        originalUrl: '/api/checkout/event-1/pledge',
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].email, 'user@smu.edu.sg');
    assert.equal(sendCalls[0].eventTitle, 'Campus Party');
    assert.equal(sendCalls[0].qty, 2);
  });

  it('rejects admin accounts before creating a pledge', async () => {
    let createCalled = false;
    dependencies.createPledge = async () => {
      createCalled = true;
      return {};
    };
    const res = createMockRes();

    await postPledge(
      {
        supabase: mockSupabase(),
        user: { id: 'admin-1', role: 'admin' },
        params: { eventId: 'event-1' },
        body: { qty: 1 },
        originalUrl: '/api/checkout/event-1/pledge',
      },
      res,
    );

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.status, 'admin_forbidden');
    assert.equal(createCalled, false);
  });

  it('does not send notification when pledge fails', async () => {
    dependencies.createPledge = async () => ({ error: 'not_enough_tickets' });
    const res = createMockRes();

    await postPledge(
      {
        supabase: mockSupabase(),
        user: { id: 'user-1' },
        params: { eventId: 'event-1' },
        body: { qty: 99 },
        originalUrl: '/api/checkout/event-1/pledge',
      },
      res,
    );

    assert.equal(res.statusCode, 409);
    assert.equal(sendCalls.length, 0);
  });

  it('uses captured pledge amount for hype-driven notification totals', async () => {
    dependencies.createPledge = async () => ({
      bookingId: 1,
      qrToken: 'qr-token',
      reference: 'PF-ABCD-1234',
      amount: 20.23,
      event: {
        title: 'Curve Party',
        price: 10,
        status: 'early_bird',
        deadline: '2026-12-15T18:00:00+08:00',
      },
      profile: {
        profile: { email: 'user@smu.edu.sg', handle: 'jamie', fullName: 'Jamie' },
      },
    });

    const res = createMockRes();
    await postPledge(
      {
        supabase: mockSupabase(),
        user: { id: 'user-1' },
        params: { eventId: 'event-1' },
        body: { qty: 2 },
        originalUrl: '/api/checkout/event-1/pledge',
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].totalAmount, 20.23);
    assert.equal(sendCalls[0].pricePerTicket, 10.115);
  });
});

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}
