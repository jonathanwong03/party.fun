import { adminClient } from './supabaseAdmin.js';

// Wallet balance ↔ ledger reconciliation (DETECTION ONLY — never mutates money).
//
// Invariant: every writer of WALLET_TRANSACTIONS records `balanceAfter` = the wallet balance AT
// that row (pledge/topup/refund/signup_bonus record the NEW balance; the simulated "bank" payout
// records the UNCHANGED balance). So a user's CURRENT walletBalance must equal the balanceAfter of
// their most recent (highest-id) transaction. Using balanceAfter — rather than a signed sum of
// amounts — sidesteps the payout ambiguity (bank payouts move money OUT of party.fun, not the
// wallet) and any historical type changes.

export const dependencies = { adminClient };

// Pure: users [{ id, walletBalance }] + txns [{ userId, id, balanceAfter }] → the users whose
// stored balance disagrees with their latest ledger row (beyond a cent of rounding).
export function computeWalletDrift(users, txns) {
  const latest = new Map(); // userId -> { id, balanceAfter }
  for (const t of txns ?? []) {
    const cur = latest.get(t.userId);
    if (!cur || Number(t.id) > Number(cur.id)) latest.set(t.userId, { id: t.id, balanceAfter: Number(t.balanceAfter) });
  }
  const drifts = [];
  for (const u of users ?? []) {
    const stored = Number(u.walletBalance) || 0;
    const l = latest.get(u.id);
    const ledger = l ? l.balanceAfter : 0; // no ledger row → should be a zero balance
    if (Math.abs(stored - ledger) > 0.005) {
      drifts.push({
        userId: u.id,
        balance: Number(stored.toFixed(2)),
        ledger: Number(ledger.toFixed(2)),
        diff: Number((stored - ledger).toFixed(2)),
      });
    }
  }
  return drifts;
}

// Read-only sweep: logs every mismatch, NEVER corrects it (money is only ever changed through the
// audited RPCs). Never throws — a detection check must not break the scheduler.
export async function checkWalletDrift() {
  try {
    const admin = dependencies.adminClient();
    const [{ data: users }, { data: txns }] = await Promise.all([
      admin.from('USER').select('id, walletBalance'),
      admin.from('WALLET_TRANSACTIONS').select('userId, id, balanceAfter'),
    ]);
    const drifts = computeWalletDrift(users ?? [], txns ?? []);
    for (const d of drifts) {
      console.error(`[walletDrift] user ${d.userId}: balance ${d.balance} != ledger ${d.ledger} (diff ${d.diff}) — manual review.`);
    }
    return drifts;
  } catch (e) {
    console.error('[walletDrift] check failed:', e?.message || e);
    return [];
  }
}
