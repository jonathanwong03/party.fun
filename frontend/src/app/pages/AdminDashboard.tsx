import { useState } from 'react';
import { Plus, Eye, Pencil, Trash2, TrendingUp, Zap, CheckCircle2, DollarSign } from 'lucide-react';
import { Button } from '../components/ui/button';
import { HypeMeter } from '../components/HypeMeter';
import { StatusBadge } from '../components/StatusBadge';
import { DeleteEventModal } from '../components/DeleteEventModal';
import { getActiveTier, type EventItem, type Route } from '../components/types';

export function AdminDashboard({ route, go, events, onDelete }: { route: Route; go: (r: Route) => void; events: EventItem[]; onDelete: (id: string) => void }) {
  const [deleting, setDeleting] = useState<string | null>(null);

  const target = events.find((e) => e.id === deleting);
  const totalPledged = events.reduce((s, e) => s + e.backers * e.price, 0);

  return (
    <div>
      <main className="min-w-0 flex-1 px-4 py-6">
        <div className="mx-auto w-full max-w-[1536px]">
          {/* Header */}
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              
              <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>Your events</h1>
              <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                Track hype, pledges and greenlit events in one place.
              </p>
            </div>
            <button
              type="button"
              onClick={() => go({ name: 'create-event' })}
              className="inline-flex items-center gap-2 px-4 text-sm font-medium text-white transition hover:bg-[#ff6647]"
              style={{ background: '#ff4d2e', borderRadius: 9999, height: 44 }}
            >
              <Plus size={18} strokeWidth={2.5} color="#ffffff" />
              <span>Create New Event</span>
            </button>
          </div>

          {/* Summary cards */}
          <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SummaryCard icon={TrendingUp} accent="#ff4d2e" label="Total events" value={events.length.toString()} hint="All-time" />
            <SummaryCard icon={Zap} accent="#ffcb3c" label="Live events" value={events.filter((e) => e.status === 'live' || e.status === 'almost').length.toString()} hint="Gathering hype" />
            <SummaryCard icon={CheckCircle2} accent="#29e07a" label="Greenlit" value={events.filter((e) => e.status === 'greenlit').length.toString()} hint="Confirmed" />
            <SummaryCard icon={DollarSign} accent="#7c5cff" label="Total pledged" value={`$${(totalPledged / 1000).toFixed(1)}k`} hint="Across all events" />
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="flex items-center justify-between border-b px-3 py-3" style={{ borderColor: 'var(--border)' }}>
              <h3>All events</h3>
              <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{events.length} total</span>
            </div>
            <div>
              <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '24%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '10%' }} />
                </colgroup>
                <thead>
                  <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
                    <th className="px-3 py-3 text-left">Event</th>
                    <th className="px-3 py-3 text-left">Date</th>
                    <th className="px-3 py-3 text-left">Hype</th>
                    <th className="px-3 py-3 text-right">Revenue</th>
                    <th className="px-3 py-3 text-right">Threshold</th>
                    <th className="px-3 py-3 text-left">Status</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-3 py-3">
                        <div style={{ fontWeight: 600 }}>{e.title}</div>
                        <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{e.organiser}</div>
                      </td>
                      <td className="px-3 py-4" style={{ color: 'var(--muted-foreground)' }}>{e.date}</td>
                      <td className="px-3 py-4">
                        <div className="w-full min-w-0">
                          <HypeMeter pct={e.hypePct} status={e.status} tier={getActiveTier(e)} size="sm" showLabel={false} />
                        </div>
                        <div className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>{e.hypePct}%</div>
                      </td>
                      <td className="px-3 py-4 text-right" style={{ fontWeight: 600 }}>${(e.backers * e.price).toLocaleString()}</td>
                      <td className="px-3 py-4 text-right" style={{ color: 'var(--muted-foreground)' }}>
                        {e.backers}/{e.threshold}
                      </td>
                      <td className="px-3 py-4"><StatusBadge event={e} /></td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <IconBtn label="View" onClick={() => go({ name: 'event', id: e.id, fromAdmin: true })}><Eye size={14} /></IconBtn>
                          <IconBtn label="Edit" onClick={() => go({ name: 'edit-event', id: e.id })}><Pencil size={14} /></IconBtn>
                          <IconBtn label="Delete" danger onClick={() => setDeleting(e.id)}><Trash2 size={14} /></IconBtn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {target && (
        <DeleteEventModal
          eventName={target.title}
          onCancel={() => setDeleting(null)}
          onConfirm={() => { if (deleting) onDelete(deleting); setDeleting(null); }}
        />
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, hint, accent }: { icon: any; label: string; value: string; hint: string; accent: string }) {
  return (
    <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-center justify-between">
        <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{label}</span>
        <div className="grid size-8 place-items-center rounded-lg" style={{ background: `${accent}20`, color: accent }}>
          <Icon size={15} />
        </div>
      </div>
      <div className="mt-2" style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>{value}</div>
      <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{hint}</div>
    </div>
  );
}

function IconBtn({ children, onClick, label, danger }: { children: React.ReactNode; onClick: () => void; label: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="grid size-8 place-items-center rounded-lg transition hover:bg-white/5"
      style={{ color: danger ? '#ff3354' : 'var(--muted-foreground)' }}
    >
      {children}
    </button>
  );
}
