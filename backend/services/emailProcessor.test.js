import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sendEmail, dependencies } from './emailProcessor.js';

const originalEnv = { ...process.env };
const originalCreateResend = dependencies.createResend;

function restoreEnv() {
  process.env = { ...originalEnv };
}

describe('sendEmail', () => {
  beforeEach(() => {
    dependencies.createResend = originalCreateResend;
    restoreEnv();
    delete process.env.RESEND_API_KEY;
    delete process.env.NOTIFICATION_OVERRIDE_EMAIL;
  });

  afterEach(() => {
    dependencies.createResend = originalCreateResend;
    restoreEnv();
  });

  it('runs in mock mode when no API key is configured', async () => {
    const result = await sendEmail({
      to: 'user@smu.edu.sg',
      subject: 'Pledge Confirmed',
      html: '<p>Hello</p>',
    });
    assert.equal(result.success, true);
    assert.equal(result.mock, true);
    assert.match(result.messageId, /^mock-msg-/);
  });

  it('redirects delivery when override email is set', async () => {
    const sent = [];
    dependencies.createResend = () => ({
      emails: {
        send: async (payload) => {
          sent.push(payload);
          return { data: { id: 'msg-123' }, error: null };
        },
      },
    });
    process.env.RESEND_API_KEY = 're_live_test_key';
    process.env.NOTIFICATION_OVERRIDE_EMAIL = 'team@test.com';

    const result = await sendEmail({
      to: 'user@smu.edu.sg',
      subject: 'Pledge Confirmed',
      html: '<p>Hello</p>',
    });

    assert.equal(result.success, true);
    assert.equal(result.mock, undefined);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'team@test.com');
  });

  it('retries once then reports failure when Resend keeps failing', async () => {
    let attempts = 0;
    dependencies.createResend = () => ({
      emails: {
        send: async () => {
          attempts += 1;
          return { error: { message: 'network down' } };
        },
      },
    });
    process.env.RESEND_API_KEY = 're_live_test_key';

    const result = await sendEmail({
      to: 'user@smu.edu.sg',
      subject: 'Pledge Confirmed',
      html: '<p>Hello</p>',
    });

    assert.equal(result.success, false);
    assert.equal(attempts, 2);
    assert.match(result.error, /network down/);
  });
});
