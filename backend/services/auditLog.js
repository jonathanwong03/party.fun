import { adminClient } from './supabaseAdmin.js';

// Best-effort audit trail for money-moving + admin-moderation actions. Writes one AUDIT_LOG row via
// the service-role client (RLS: admin-read only). Auditing is OBSERVATIONAL — it must never throw
// into or slow down the action it records, so every failure is swallowed with a warning.
export const dependencies = { adminClient };

export async function auditLog({ actorUserId = null, action, targetType = null, targetId = null, amount = null, metadata = null } = {}) {
  if (!action) return;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return; // no privileged client to write with
  try {
    const { error } = await dependencies.adminClient()
      .from('AUDIT_LOG')
      .insert({ actorUserId, action, targetType, targetId, amount, metadata });
    if (error) console.warn('[auditLog] write failed:', error.message);
  } catch (e) {
    console.warn('[auditLog] write failed:', e?.message || e);
  }
}
