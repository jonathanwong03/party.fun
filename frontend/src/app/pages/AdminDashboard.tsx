import { useState } from 'react';
import { Plus, Eye, Pencil, Trash2, TrendingUp, Zap, CheckCircle2, DollarSign } from 'lucide-react';
import { Button } from '../components/ui/button';
import { HypeMeter } from '../components/HypeMeter';
import { DeleteEventModal } from '../components/DeleteEventModal';
import { getActiveTier, TIER_COLORS, TIER_LABELS, type EventItem, type Route } from '../components/types';

// Lifecycle status shown in the dashboard's Status column, derived from the event's
// status flag and whether it has reached its hype threshold.
function dashboardStatus(e: EventItem): 'GREENLIT' | 'PENDING' | 'CANCELLED' {
  if (e.status === 'cancelled') return 'CANCELLED';
  if (e.status === 'greenlit' || e.backers >= e.threshold) return 'GREENLIT';
  return 'PENDING';
}

const STATUS_COLORS: Record<'GREENLIT' | 'PENDING' | 'CANCELLED', string> = {
  GREENLIT: 'var(--foreground)',
  PENDING: 'var(--foreground)',
  CANCELLED: '#ff6b85',
};

export function AdminDashboard({ route, go, events, onDelete, drafts, onDeleteDraft }: { route: Route; go: (r: Route) => void; events: EventItem[]; onDelete: (id: string) => void; drafts: EventItem[]; onDeleteDraft: (id: string) => void }) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [tab, setTab] = useState<'created' | 'drafts'>('created');

  const isDrafts = tab === 'drafts';
  // The dashboard is for events the admin created themselves (mine), not the full catalogue.
  const created = events.filter((e) => e.mine);
  const rows = isDrafts ? drafts : created;
  const target = [...events, ...drafts].find((e) => e.id === deleting);
  const totalPledged = created.reduce((s, e) => s + e.backers * e.price, 0);

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
            <SummaryCard icon={TrendingUp} accent="#ff4d2e" label="Total events" value={created.length.toString()} hint="All-time events" />
            <SummaryCard icon={Zap} accent="#ffcb3c" label="Upcoming" value={created.filter((e) => dashboardStatus(e) !== 'CANCELLED').length.toString()} hint="Ongoing events" />
            <SummaryCard icon={CheckCircle2} accent="#29e07a" label="Greenlit" value={created.filter((e) => e.status === 'greenlit').length.toString()} hint="Confirmed events" />
            <SummaryCard icon={DollarSign} accent="#7c5cff" label="Total pledged" value={`$${(totalPledged / 1000).toFixed(1)}k`} hint="Across all events" />
          </div>

          {/* Tabs */}
          <div className="mb-5 flex gap-2 rounded-full border p-1" style={{ borderColor: 'var(--border)', background: 'var(--surface)', width: 'fit-content' }}>
            {(['created', 'drafts'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="rounded-full px-4 py-1.5 text-sm transition"
                style={{
                  background: tab === t ? '#ff4d2e' : 'transparent',
                  color: tab === t ? '#fff' : 'var(--muted-foreground)',
                  fontWeight: 600,
                }}
              >
                {t === 'created' ? 'Created events' : 'Drafts'}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="flex items-center justify-between border-b px-3 py-3" style={{ borderColor: 'var(--border)' }}>
              <h3>{isDrafts ? 'Drafts' : 'Created events'}</h3>
              <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{rows.length} total</span>
            </div>
            <div>
              <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '21%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                </colgroup>
                <thead>
                  <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
                    <th className="px-3 py-3 text-left">Event</th>
                    <th className="px-3 py-3 text-left">Date</th>
                    <th className="px-3 py-3 text-left">Hype</th>
                    <th className="px-3 py-3 text-right">Revenue</th>
                    <th className="px-3 py-3 text-right">Threshold</th>
                    <th className="px-3 py-3 text-left">Tier</th>
                    <th className="px-3 py-3 text-left">Status</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-3 py-3">
                        <div style={{ fontWeight: 600 }}>{e.title}</div>
                        <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{e.organiser || (isDrafts ? 'Draft event' : '')}</div>
                      </td>
                      <td className="px-3 py-4" style={{ color: 'var(--muted-foreground)' }}>{e.date || '—'}</td>
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
                      <td className="px-3 py-4">
                        {(() => {
                          const ti = getActiveTier(e);
                          return (
                            <span
                              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
                              style={{ background: `${TIER_COLORS[ti]}1f`, color: TIER_COLORS[ti], fontWeight: 600 }}
                            >
                              <span className="size-1.5 rounded-full" style={{ background: TIER_COLORS[ti] }} />
                              {TIER_LABELS[ti]}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-4">
                        {isDrafts ? (
                          <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted-foreground)', fontWeight: 600 }}>Draft</span>
                        ) : (
                          (() => {
                            const s = dashboardStatus(e);
                            return (
                              <span className="text-xs uppercase tracking-wide" style={{ color: STATUS_COLORS[s], fontWeight: 600 }}>{s}</span>
                            );
                          })()
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {isDrafts ? (
                            <>
                              <IconBtn label="Resume" onClick={() => go({ name: 'create-event', draftId: e.id })}><Pencil size={14} /></IconBtn>
                              <IconBtn label="Delete" danger onClick={() => setDeleting(e.id)}><Trash2 size={14} /></IconBtn>
                            </>
                          ) : (
                            <>
                              <IconBtn label="View" onClick={() => go({ name: 'event', id: e.id, fromAdmin: true })}><Eye size={14} /></IconBtn>
                              <IconBtn label="Edit" onClick={() => go({ name: 'edit-event', id: e.id })}><Pencil size={14} /></IconBtn>
                              <IconBtn label="Delete" danger onClick={() => setDeleting(e.id)}><Trash2 size={14} /></IconBtn>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <div className="px-3 py-12 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  {isDrafts ? 'No drafts yet. Start creating an event and hit “Save Draft” to keep it here.' : 'No events yet.'}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {target && (
        <DeleteEventModal
          eventName={target.title}
          onCancel={() => setDeleting(null)}
          onConfirm={() => { if (deleting) (isDrafts ? onDeleteDraft : onDelete)(deleting); setDeleting(null); }}
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
