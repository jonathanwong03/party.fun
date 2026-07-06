import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { requestReset, verifyReset, completeReset, dependencies } from './passwordResetService.js';

describe('passwordResetService', () => {
  const originalAdminClient = dependencies.adminClient;
  const originalNotifyPasswordReset = dependencies.notifyPasswordReset;
  const originalSendSms = dependencies.sendSms;
  const originalSixDigit = dependencies.sixDigit;

  let notifyResetCalled = null;
  let smsSent = null;
  let updateUserCalled = null;
  let mockUsers = [];

  beforeEach(() => {
    notifyResetCalled = null;
    smsSent = null;
    updateUserCalled = null;
    mockUsers = [];
    dependencies.store.clear();

    dependencies.adminClient = () => ({
      from: (table) => {
        if (table === 'USER') {
          return {
            select: () => ({
              ilike: (col, val) => {
                const target = val.replace(/%/g, '').toLowerCase();
                const matched = mockUsers.filter((u) => u.email.toLowerCase() === target);
                return {
                  limit: async () => ({
                    data: matched,
                    error: null
                  })
                };
              },
              not: () => {
                return {
                  data: mockUsers,
                  error: null
                };
              }
            })
          };
        }
      },
      auth: {
        admin: {
          updateUserById: async (userId, payload) => {
            updateUserCalled = { userId, payload };
            return { error: null };
          }
        }
      }
    });

    dependencies.notifyPasswordReset = async (payload) => {
      notifyResetCalled = payload;
    };

    dependencies.sendSms = async (to, body) => {
      smsSent = { to, body };
      return { success: true };
    };

    dependencies.sixDigit = () => '654321';
  });

  afterEach(() => {
    dependencies.adminClient = originalAdminClient;
    dependencies.notifyPasswordReset = originalNotifyPasswordReset;
    dependencies.sendSms = originalSendSms;
    dependencies.sixDigit = originalSixDigit;
    dependencies.store.clear();
  });

  describe('requestReset', () => {
    test('sends email when identifier is an email', async () => {
      mockUsers = [{ id: 'u-1', email: 'alice@smu.edu.sg', username: 'alice', role: 'user' }];

      const res = await requestReset('alice@smu.edu.sg', 'email');
      assert.deepEqual(res, { status: 'ok', email: 'alice@smu.edu.sg' });
      assert.ok(notifyResetCalled);
      assert.equal(notifyResetCalled.email, 'alice@smu.edu.sg');
      assert.equal(notifyResetCalled.code, '654321');
      assert.equal(smsSent, null);

      const entry = dependencies.store.get('alice@smu.edu.sg');
      assert.ok(entry);
      assert.equal(entry.code, '654321');
    });

    test('sends SMS when identifier is a phone number and channel is sms', async () => {
      mockUsers = [{ id: 'u-2', email: 'bob@smu.edu.sg', username: 'bob', role: 'organiser', contact: '+65 88887777' }];

      const res = await requestReset('88887777', 'sms');
      assert.deepEqual(res, { status: 'ok', email: 'bob@smu.edu.sg' });
      assert.ok(smsSent);
      assert.equal(smsSent.to, '+65 88887777');
      assert.match(smsSent.body, /654321/);
      assert.equal(notifyResetCalled, null);

      const entry = dependencies.store.get('bob@smu.edu.sg');
      assert.ok(entry);
    });

    test('returns error when account is not found', async () => {
      const res = await requestReset('unknown@smu.edu.sg');
      assert.deepEqual(res, { error: 'no_account' });
    });

    test('returns error when SMS requested but no phone is on file', async () => {
      mockUsers = [{ id: 'u-1', email: 'alice@smu.edu.sg', username: 'alice', role: 'user', contact: null }];
      const res = await requestReset('alice@smu.edu.sg', 'sms');
      assert.deepEqual(res, { error: 'no_phone' });
    });
  });

  describe('verifyReset', () => {
    test('successfully verifies the correct code', async () => {
      dependencies.store.set('alice@smu.edu.sg', {
        code: '654321',
        expiresAt: Date.now() + 60000,
        attempts: 0,
        userId: 'u-1',
        username: 'alice'
      });

      const res = verifyReset('alice@smu.edu.sg', '654321');
      assert.deepEqual(res, { status: 'ok' });
    });

    test('returns error when code is incorrect', async () => {
      dependencies.store.set('alice@smu.edu.sg', {
        code: '654321',
        expiresAt: Date.now() + 60000,
        attempts: 0,
        userId: 'u-1',
        username: 'alice'
      });

      const res = verifyReset('alice@smu.edu.sg', 'wrong');
      assert.deepEqual(res, { error: 'invalid_code' });
    });
  });

  describe('completeReset', () => {
    test('updates the password in auth admin and deletes stored token', async () => {
      dependencies.store.set('alice@smu.edu.sg', {
        code: '654321',
        expiresAt: Date.now() + 60000,
        attempts: 0,
        userId: 'u-1',
        username: 'alice'
      });

      const res = await completeReset('alice@smu.edu.sg', '654321', 'newsecurepassword');
      assert.deepEqual(res, { status: 'ok' });
      assert.deepEqual(updateUserCalled, {
        userId: 'u-1',
        payload: { password: 'newsecurepassword' }
      });
      assert.equal(dependencies.store.has('alice@smu.edu.sg'), false);
    });

    test('returns error for weak password (< 6 chars)', async () => {
      const res = await completeReset('alice@smu.edu.sg', '654321', '12345');
      assert.deepEqual(res, { error: 'weak_password' });
    });

    test('returns error when verify fails', async () => {
      const res = await completeReset('alice@smu.edu.sg', 'wrong', 'newsecurepassword');
      assert.deepEqual(res, { error: 'invalid_code' });
    });
  });
});
