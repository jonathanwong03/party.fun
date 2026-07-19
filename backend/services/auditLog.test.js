import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { auditLog, dependencies } from './auditLog.js';

let savedKey;
let inserted;
const original = dependencies.adminClient;

beforeEach(() => {
  savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  inserted = [];
  dependencies.adminClient = () => ({ from: () => ({ insert: async (row) => { inserted.push(row); return { error: null }; } }) });
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  dependencies.adminClient = original;
});

test('writes an audit row with the expected shape', async () => {
  await auditLog({ actorUserId: 'u1', action: 'wallet_topup', targetType: 'wallet', targetId: 'u1', amount: 50, metadata: { paymentIntentId: 'pi_1' } });
  assert.equal(inserted.length, 1);
  assert.deepEqual(inserted[0], {
    actorUserId: 'u1', action: 'wallet_topup', targetType: 'wallet', targetId: 'u1', amount: 50, metadata: { paymentIntentId: 'pi_1' },
  });
});

test('does nothing without an action', async () => {
  await auditLog({ actorUserId: 'u1' });
  assert.equal(inserted.length, 0);
});

test('never throws when the write fails (auditing is best-effort)', async () => {
  dependencies.adminClient = () => ({ from: () => ({ insert: async () => { throw new Error('db down'); } }) });
  await assert.doesNotReject(auditLog({ action: 'pledge', targetId: 'e1' }));
});

test('skips silently when no service-role key is configured', async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  await auditLog({ action: 'pledge', targetId: 'e1' });
  assert.equal(inserted.length, 0);
});
