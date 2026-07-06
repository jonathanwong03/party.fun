import { useState } from 'react';
import { ShieldAlert, Pencil, Ban, Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import type { EventItem, Route } from '../components/types';

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  early_bird: { text: 'EARLY BIRDS', color: '#ffd23f' },
  greenlit: { text: 'GREENLIT', color: '#29e07a' },
  completed: { text: 'COMPLETED', color: '#4d8dff' },
  cancelled: { text: 'CANCELLED', color: '#ff3354' },
};

export function AdminManageEvents({ go, events, onCancel }: { go: (r: Route) => void; events: EventItem[]; onCancel: (id: string, reason: string) => Promise<void> }) {
  const [q, setQ] = useState('');
  const [cancelling, setCancelling] = useState<EventItem | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = events.filter((e) => `${e.title} ${e.organiser}`.toLowerCase().includes(q.trim().toLowerCase()));

  const submit = async () => {
    if (reason.trim().length < 10) { setError('Please give a clear reason (at least 10 characters).'); return; }
    if (!cancelling) return;
    setBusy(true);
    try { await onCancel(cancelling.id, reason.trim()); setCancelling(null); setReason(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to cancel.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-[1536px] px-6 py-8">
      <h1 className="mb-6 flex items-center gap-2" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' }}>
        <ShieldAlert size={26} style={{ color: '#ff4d2e' }} /> Manage Events
      </h1>

      <div className="relative mb-5 max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by event or organiser…" className="pl-9" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }} />
      </div>

      <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: 'var(--muted-foreground)' }} className="text-left">
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Event</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Organiser</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Date</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const s = STATUS_LABEL[e.status] ?? STATUS_LABEL.early_bird;
              const canActOn = e.status === 'early_bird' || e.status === 'greenlit';
              return (
                <tr key={e.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-4 py-3" style={{ fontWeight: 600 }}>{e.title}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--muted-foreground)' }}>{e.organiser}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--muted-foreground)' }}>{e.date}</td>
                  <td className="px-4 py-3"><span style={{ color: s.color, fontWeight: 700, fontSize: 12 }}>{s.text}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {canActOn && (
                        <>
                          <Button onClick={() => go({ name: 'edit-event', id: e.id })} variant="outline" className="h-8 gap-1 text-xs" style={{ borderRadius: 10 }}><Pencil size={13} /> Edit</Button>
                          <Button onClick={() => { setReason(''); setError(null); setCancelling(e); }} className="h-8 gap-1 bg-[#ff3354] text-xs text-white hover:bg-[#ff4865]" style={{ borderRadius: 10 }}><Ban size={13} /> Cancel</Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="px-3 py-12 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>No events found.</div>}
      </div>

      {cancelling && (
        <div className="fixed inset-0 z-50 grid place-items-center px-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="w-full max-w-md rounded-2xl border p-6" style={{ background: 'var(--surface)', borderColor: 'var(--border-strong)' }}>
            <h3 className="mb-1" style={{ fontWeight: 700, fontSize: 18 }}>Cancel this event?</h3>
            <p className="mb-4 text-sm" style={{ color: 'var(--muted-foreground)' }}>
              You're about to cancel <strong style={{ color: 'var(--foreground)' }}>{cancelling.title}</strong>. All pledges are refunded, and the organiser + backers are emailed that an administrator cancelled it (with your reason).
            </p>
            <label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Reason (required, min 10 characters)</label>
            <textarea
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError(null); }}
              rows={3}
              placeholder="e.g. This event violates the community guidelines because…"
              className="w-full rounded-lg border p-3 text-sm"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            />
            {error && <p className="mt-2 text-xs" style={{ color: '#ff9a82' }}>{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => { setCancelling(null); setReason(''); setError(null); }} variant="outline" style={{ borderRadius: 12 }}>Back</Button>
              <Button onClick={submit} disabled={busy || reason.trim().length < 10} className="bg-[#ff3354] text-white hover:bg-[#ff4865] disabled:opacity-50" style={{ borderRadius: 12 }}>
                {busy ? 'Cancelling…' : 'Cancel Event'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
