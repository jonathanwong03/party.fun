import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  notifyPledgeConfirmed,
  dependencies,
  __resetNotificationDependenciesForTests,
} from './notificationService.js';

describe('notifyPledgeConfirmed', () => {
  const logs = [];
  const originalSendEmail = dependencies.sendEmail;

  beforeEach(() => {
    logs.length = 0;
    __resetNotificationDependenciesForTests();
    dependencies.insertNotificationLog = async (row) => {
      logs.push(row);
    };
    dependencies.sendEmail = async () => ({ success: true, mock: true, messageId: 'mock-msg-1' });
  });

  afterEach(() => {
    dependencies.sendEmail = originalSendEmail;
    __resetNotificationDependenciesForTests();
  });

  it('logs mock_sent when email runs in mock mode', async () => {
    await notifyPledgeConfirmed({
      userId: 'user-1',
      email: 'user@smu.edu.sg',
      username: 'jamie',
      eventId: 'event-1',
      eventTitle: 'Campus Party',
      deadline: '2026-12-15T18:00:00+08:00',
      qty: 2,
      pricePerTicket: 15,
    });

    assert.equal(logs.length, 1);
    assert.equal(logs[0].notification_type, 'pledge_confirmed');
    assert.equal(logs[0].status, 'mock_sent');
    assert.equal(logs[0].recipient_email, 'user@smu.edu.sg');
  });

  it('logs sent when Resend accepts the message', async () => {
    dependencies.sendEmail = async () => ({ success: true, messageId: 'msg-live-1' });

    await notifyPledgeConfirmed({
      userId: 'user-1',
      email: 'user@smu.edu.sg',
      username: 'jamie',
      eventId: 'event-1',
      eventTitle: 'Campus Party',
      deadline: '2026-12-15T18:00:00+08:00',
      qty: 1,
      pricePerTicket: 10,
    });

    assert.equal(logs[0].status, 'sent');
  });

  it('logs failed when email delivery fails', async () => {
    dependencies.sendEmail = async () => ({ success: false, error: 'network down' });

    await notifyPledgeConfirmed({
      userId: 'user-1',
      email: 'user@smu.edu.sg',
      username: 'jamie',
      eventId: 'event-1',
      eventTitle: 'Campus Party',
      deadline: '2026-12-15T18:00:00+08:00',
      qty: 1,
      pricePerTicket: 10,
    });

    assert.equal(logs[0].status, 'failed');
    assert.equal(logs[0].error_message, 'network down');
  });
});
