// Stripe lets you refund a charge only for a limited window after it was created (Stripe
// documents 180 days for ACH; cards are similarly bounded). Enforce a configurable ceiling so
// we flag too-old charges for manual handling instead of letting refunds.create fail silently.
export const REFUND_WINDOW_DAYS = Number(process.env.REFUND_WINDOW_DAYS) || 180;

// True when a charge made at `chargeAt` is still within the refundable window.
// A null/unknown chargeAt is treated as refundable (let Stripe be the source of truth).
export function canRefund(chargeAt, windowDays = REFUND_WINDOW_DAYS) {
  if (!chargeAt) return true;
  const ms = new Date(chargeAt).getTime();
  if (!Number.isFinite(ms)) return true;
  const ageDays = (Date.now() - ms) / (1000 * 60 * 60 * 24);
  return ageDays <= windowDays;
}
