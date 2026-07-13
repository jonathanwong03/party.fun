import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { requestPhoneLogin, verifyPhoneLogin, dependencies } from './phoneLoginService.js';

describe('phoneLoginService', () => {
  const originalAdminClient = dependencies.adminClient;
  const originalSendSms = dependencies.sendSms;
  const originalSixDigit = dependencies.sixDigit;

  let smsSent = null;
  let generateLinkArgs = null;
  let mockUsers = [];

  beforeEach(() => {
    smsSent = null;
    generateLinkArgs = null;
    mockUsers = [];
    dependencies.store.clear();

    dependencies.adminClient = () => ({
      from: (table) => {
        if (table === 'USER') {
          return {
            select: () => ({
              not: () => {
                return {
                  data: mockUsers,
                  error: null
                };
              }
            })
          }
        }
      },
      auth: {
        admin: {
          generateLink: async (args) => {
            generateLinkArgs = args;
            return {
              data: {
                properties: { hashed_token: 'hashed_token_abc' }
              },
              error: null
            };
          }
        }
      }
    });

    dependencies.sendSms = async (to, body) => {
      smsSent = { to, body };
      return { success: true };
    };

    dependencies.sixDigit = () => '123456';
  });

  afterEach(() => {
    dependencies.adminClient = originalAdminClient;
    dependencies.sendSms = originalSendSms;
    dependencies.sixDigit = originalSixDigit;
    dependencies.store.clear();
  });

  describe('requestPhoneLogin', () => {
    test('sends SMS and stores code when user is found by phone number', async () => {
      mockUsers = [
        { id: 'user-id-1', email: 'user1@smu.edu.sg', contact: '+65 99676766' }
      ];

      const res = await requestPhoneLogin('99676766');
      assert.deepEqual(res, { status: 'ok' });
      assert.ok(smsSent);
      assert.equal(smsSent.to, '+65 99676766');
      assert.match(smsSent.body, /123456/);

      // Verify entry exists in store
      const entry = dependencies.store.get('99676766');
      assert.ok(entry);
      assert.equal(entry.code, '123456');
      assert.equal(entry.userId, 'user-id-1');
      assert.equal(entry.email, 'user1@smu.edu.sg');
    });

    test('normalises phone numbers correctly (Singapore code "+65" prefix)', async () => {
      mockUsers = [
        { id: 'user-id-1', email: 'user1@smu.edu.sg', contact: '+6599676766' }
      ];

      // request with standard number, should match "+65" normalised
      const res = await requestPhoneLogin('+65 99676766');
      assert.deepEqual(res, { status: 'ok' });
    });

    test('returns error when phone number does not exist on any account', async () => {
      mockUsers = [
        { id: 'user-id-1', email: 'user1@smu.edu.sg', contact: '88888888' }
      ];

      const res = await requestPhoneLogin('99676766');
      assert.deepEqual(res, { error: 'no_phone_account' });
      assert.equal(smsSent, null);
    });

    test('returns error when SMS sending fails', async () => {
      mockUsers = [
        { id: 'user-id-1', email: 'user1@smu.edu.sg', contact: '99676766' }
      ];
      dependencies.sendSms = async () => ({ success: false });

      const res = await requestPhoneLogin('99676766');
      assert.deepEqual(res, { error: 'sms_failed' });
    });
  });

  describe('verifyPhoneLogin', () => {
    test('successfully verifies code and returns magic link session data', async () => {
      // Mock code in store
      dependencies.store.set('99676766', {
        code: '123456',
        expiresAt: Date.now() + 60000,
        attempts: 0,
        userId: 'user-id-1',
        email: 'user1@smu.edu.sg'
      });

      const res = await verifyPhoneLogin('99676766', '123456');
      assert.deepEqual(res, {
        status: 'ok',
        email: 'user1@smu.edu.sg',
        tokenHash: 'hashed_token_abc'
      });

      assert.ok(generateLinkArgs);
      assert.equal(generateLinkArgs.type, 'magiclink');
      assert.equal(generateLinkArgs.email, 'user1@smu.edu.sg');

      // Entry should be removed after verification
      assert.equal(dependencies.store.has('99676766'), false);
    });

    test('returns invalid_code error when code is incorrect', async () => {
      dependencies.store.set('99676766', {
        code: '123456',
        expiresAt: Date.now() + 60000,
        attempts: 0,
        userId: 'user-id-1',
        email: 'user1@smu.edu.sg'
      });

      const res = await verifyPhoneLogin('99676766', 'wrong');
      assert.deepEqual(res, { error: 'invalid_code' });
      
      const entry = dependencies.store.get('99676766');
      assert.equal(entry.attempts, 1);
    });

    test('returns expired_code error when token has expired', async () => {
      dependencies.store.set('99676766', {
        code: '123456',
        expiresAt: Date.now() - 1000, // expired 1s ago
        attempts: 0,
        userId: 'user-id-1',
        email: 'user1@smu.edu.sg'
      });

      const res = await verifyPhoneLogin('99676766', '123456');
      assert.deepEqual(res, { error: 'expired_code' });
      assert.equal(dependencies.store.has('99676766'), false);
    });

    test('returns too_many_attempts error and clears entry when attempts exceed limit', async () => {
      dependencies.store.set('99676766', {
        code: '123456',
        expiresAt: Date.now() + 60000,
        attempts: 5, // at limit
        userId: 'user-id-1',
        email: 'user1@smu.edu.sg'
      });

      const res = await verifyPhoneLogin('99676766', '123456');
      assert.deepEqual(res, { error: 'too_many_attempts' });
      assert.equal(dependencies.store.has('99676766'), false);
    });
  });
});
