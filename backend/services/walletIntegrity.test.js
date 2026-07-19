import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWalletDrift } from './walletIntegrity.js';

test('no drift when the latest ledger row matches the balance', () => {
  const users = [{ id: 'u1', walletBalance: 90 }];
  const txns = [
    { userId: 'u1', id: 1, balanceAfter: 100 }, // signup
    { userId: 'u1', id: 2, balanceAfter: 90 },  // a $10 pledge — latest
  ];
  assert.deepEqual(computeWalletDrift(users, txns), []);
});

test('flags a balance that disagrees with its latest ledger row', () => {
  const users = [{ id: 'u1', walletBalance: 100 }]; // but latest ledger says 90
  const txns = [{ userId: 'u1', id: 2, balanceAfter: 90 }];
  const drift = computeWalletDrift(users, txns);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].userId, 'u1');
  assert.equal(drift[0].balance, 100);
  assert.equal(drift[0].ledger, 90);
  assert.equal(drift[0].diff, 10);
});

test('a bank payout row (money out of party.fun, wallet unchanged) is NOT a false drift', () => {
  // The payout writes balanceAfter = the UNCHANGED balance, so latest-balanceAfter still matches.
  const users = [{ id: 'org1', walletBalance: 20 }];
  const txns = [
    { userId: 'org1', id: 1, balanceAfter: 20 },  // signup bonus
    { userId: 'org1', id: 5, balanceAfter: 20 },  // 'payout' (bank) — balance unchanged
  ];
  assert.deepEqual(computeWalletDrift(users, txns), []);
});

test('a user with no ledger rows is fine at zero, flagged when non-zero', () => {
  assert.deepEqual(computeWalletDrift([{ id: 'u1', walletBalance: 0 }], []), []);
  const drift = computeWalletDrift([{ id: 'u1', walletBalance: 5 }], []);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].diff, 5);
});
