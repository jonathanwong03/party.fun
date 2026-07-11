import { useEffect, useState } from 'react';
import { Plus, Eye, Pencil, Trash2, Ban } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { HypeMeter } from '../components/HypeMeter';
import { DeleteEventModal } from '../components/DeleteEventModal';
import { getActiveStatus, type EventItem, type Route } from '../components/types';
import { fetchHostedSummary, type HostedSummary } from '../api';

// Display label for the dashboard's Status column, mapped from the backend status.
function dashboardStatus(e: EventItem): 'GREENLIT' | 'EARLY BIRDS' | 'CANCELLED' | 'COMPLETED' {
  if (e.status === 'cancelled') return 'CANCELLED';
  if (e.status === 'completed') return 'COMPLETED';
  if (e.status === 'greenlit') return 'GREENLIT';
  return 'EARLY BIRDS';
}

const STATUS_FILTERS: { key: 'all' | EventItem['status']; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'early_bird', label: 'Early Birds' },
  { key: 'greenlit', label: 'Greenlit' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'completed', label: 'Completed' },
];

const DASHBOARD_STATUS_COLORS: Record<'GREENLIT' | 'EARLY BIRDS' | 'CANCELLED' | 'COMPLETED', string> = {
  GREENLIT: '#29e07a',
  'EARLY BIRDS': '#ffcb3c',
  CANCELLED: '#ff3354',
  COMPLETED: '#9a9aa5',
};

// An event can't be cancelled once it has started.
const hasStarted = (e: EventItem) => !!e.startsAt && new Date(e.startsAt).getTime() <= Date.now();

export function OrganiserHostedEvents({ route, go, events, onCancel, onHide, drafts, onDeleteDraft }: { route: Route; go: (r: Route) => void; events: EventItem[]; onCancel: (id: string, reason: string) => void; onHide: (id: string) => void; drafts: EventItem[]; onDeleteDraft: (id: string) => void }) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [tab, setTab] = useState<'created' | 'drafts'>(route.name === 'hosted-events' ? route.tab ?? 'created' : 'created');
  const [statusFilter, setStatusFilter] = useState<'all' | EventItem['status']>('all');

  const isDrafts = tab === 'drafts';
  // The dashboard includes owned events plus accepted co-organised events.
  const created = events.filter((e) => (e.mine || e.isCoOrganiser) && !e.hostHidden);
  const filteredCreated = statusFilter === 'all' ? created : created.filter((e) => e.status === statusFilter);
  const rows = isDrafts ? drafts : filteredCreated;
  const target = [...events, ...drafts].find((e) => e.id === deleting);
  // Cancelled events get a "remove from dashboard" (hide) action instead of cancel.
  const targetCancelled = !isDrafts && target?.status === 'cancelled';

  // Revenue + aggregate counts are computed by the backend (accurate, net of refunds).
  const [summary, setSummary] = useState<HostedSummary>({ revenueByEvent: {}, totalRevenue: 0, totalEvents: 0, upcoming: 0, confirmed: 0 });
  useEffect(() => {
    let ignore = false;
    fetchHostedSummary().then((s) => { if (!ignore) setSummary(s); }).catch(() => {});
    return () => { ignore = true; };
  }, [events]);

  return (
    <div>
      <main className="min-w-0 flex-1 px-4 py-6">
        <div className="mx-auto w-full max-w-[1536px]">
          {/* Header */}
          <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[22px] sm:text-[26px]" style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>Manage your events</h1>
              <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                Track hype, pledges and confirmed events in one place.
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

          {/* Status filter (created events only) */}
          {!isDrafts && (
            <div className="mb-5">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | EventItem['status'])}>
                <SelectTrigger className="w-full md:w-52" style={{ background: 'var(--surface-2)' }}>
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((f) => (
                    <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Table */}
          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="flex items-center justify-between border-b px-3 py-3" style={{ borderColor: 'var(--border)' }}>
              <h3>{isDrafts ? 'Drafts' : 'Created events'}</h3>
              <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{rows.length} total</span>
            </div>
              {/* Mobile card list */}
            <div className="md:hidden divide-y" style={{ borderColor: 'var(--border)' }}>
              {rows.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  {isDrafts ? 'No drafts yet. Start creating an event and hit "Save Draft" to keep it here.' : 'No events yet.'}
                </div>
              ) : rows.map((e) => {
                const s = isDrafts ? null : dashboardStatus(e);
                return (
                  <div key={e.id} className="flex flex-col gap-3 border-t px-4 py-4" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold leading-tight">{e.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                          <span>{e.organiser || (isDrafts ? 'Draft event' : '')}</span>
                          {!isDrafts && e.isCoOrganiser && (
                            <span className="rounded-full px-2 py-0.5" style={{ background: 'rgba(255,203,60,0.16)', color: '#ffcb3c', fontWeight: 700 }}>Co-organiser</span>
                          )}
                        </div>
                      </div>
                      {s ? (
                        <span className="shrink-0 text-xs uppercase tracking-wide" style={{ color: DASHBOARD_STATUS_COLORS[s], fontWeight: 700 }}>{s}</span>
                      ) : (
                        <span className="shrink-0 text-xs uppercase tracking-wide" style={{ color: 'var(--muted-foreground)', fontWeight: 600 }}>Draft</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      <span>{e.date || '—'}</span>
                      <span>Revenue: <strong style={{ color: 'var(--foreground)' }}>${(summary.revenueByEvent[e.id] ?? 0).toLocaleString()}</strong></span>
                      <span>{e.activeTicketCount}/{e.hypeThreshold}</span>
                    </div>
                    <div>
                      <HypeMeter pct={e.hypePercentage} status={e.status} statusIndex={getActiveStatus(e)} size="sm" showLabel={false} />
                      <div className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>{e.hypePercentage}% hype</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isDrafts ? (
                        <>
                          <button onClick={() => go({ name: 'create-event', draftId: e.id })} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:bg-white/5" style={{ borderColor: 'var(--border)' }}><Pencil size={13} /> Resume</button>
                          <button onClick={() => { setReason(''); setDeleting(e.id); }} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:bg-white/5" style={{ borderColor: 'var(--border)', color: '#ff3354' }}><Trash2 size={13} /> Delete</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => go({ name: 'event', id: e.id, fromOrganiser: true })} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:bg-white/5" style={{ borderColor: 'var(--border)' }}><Eye size={13} /> View</button>
                          {(e.canEdit ?? e.mine) && <button onClick={() => go({ name: 'edit-event', id: e.id })} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:bg-white/5" style={{ borderColor: 'var(--border)' }}><Pencil size={13} /> Edit</button>}
                          {e.status === 'cancelled' && (e.canDelete ?? e.mine) ? (
                            <button onClick={() => setDeleting(e.id)} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:bg-white/5" style={{ borderColor: 'var(--border)', color: '#ff3354' }}><Trash2 size={13} /> Remove</button>
                          ) : (e.canCancel ?? e.mine) && (e.status === 'early_bird' || e.status === 'greenlit') && !hasStarted(e) ? (
                            <button onClick={() => { setReason(''); setDeleting(e.id); }} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:bg-white/5" style={{ borderColor: 'var(--border)', color: '#ff3354' }}><Ban size={13} /> Cancel</button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '19%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '9%' }} />
                </colgroup>
                <thead>
                  <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
                    <th className="px-3 py-3 text-left">Event</th>
                    <th className="px-3 py-3 text-left">Date</th>
                    <th className="px-3 py-3 text-left">Hype</th>
                    <th className="px-3 py-3 text-left">Revenue</th>
                    <th className="px-3 py-3 text-left">Threshold</th>
                    <th className="px-3 py-3 pl-6 text-left">Status</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-3 py-3">
                        <div style={{ fontWeight: 600 }}>{e.title}</div>
                        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                          <span>{e.organiser || (isDrafts ? 'Draft event' : '')}</span>
                          {!isDrafts && e.isCoOrganiser && (
                            <span className="rounded-full px-2 py-0.5" style={{ background: 'rgba(255,203,60,0.16)', color: '#ffcb3c', fontWeight: 700 }}>
                              Co-organiser
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-4" style={{ color: 'var(--muted-foreground)' }}>{e.date || '—'}</td>
                      <td className="px-3 py-4">
                        <div className="w-full min-w-0">
                          <HypeMeter pct={e.hypePercentage} status={e.status} statusIndex={getActiveStatus(e)} size="sm" showLabel={false} />
                        </div>
                        <div className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>{e.hypePercentage}%</div>
                      </td>
                      <td className="px-3 py-4 text-left" style={{ fontWeight: 600 }}>${(summary.revenueByEvent[e.id] ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-4 text-left" style={{ color: 'var(--muted-foreground)' }}>
                        {e.activeTicketCount}/{e.hypeThreshold}
                      </td>
                      <td className="px-3 py-4 pl-6">
                        {isDrafts ? (
                          <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted-foreground)', fontWeight: 600 }}>Draft</span>
                        ) : (
                          (() => {
                            const s = dashboardStatus(e);
                            return (
                              <span className="text-xs uppercase tracking-wide" style={{ color: DASHBOARD_STATUS_COLORS[s], fontWeight: 600 }}>{s}</span>
                            );
                          })()
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {isDrafts ? (
                            <>
                              <IconBtn label="Resume" onClick={() => go({ name: 'create-event', draftId: e.id })}><Pencil size={14} /></IconBtn>
                              <IconBtn label="Delete" danger onClick={() => { setReason(''); setDeleting(e.id); }}><Trash2 size={14} /></IconBtn>
                            </>
                          ) : (
                            <>
                              <IconBtn label="View" onClick={() => go({ name: 'event', id: e.id, fromOrganiser: true })}><Eye size={14} /></IconBtn>
                              {(e.canEdit ?? e.mine) && <IconBtn label="Edit" onClick={() => go({ name: 'edit-event', id: e.id })}><Pencil size={14} /></IconBtn>}
                              {e.status === 'cancelled' && (e.canDelete ?? e.mine) ? (
                                <IconBtn label="Remove" danger onClick={() => setDeleting(e.id)}><Trash2 size={14} /></IconBtn>
                              ) : (e.canCancel ?? e.mine) && (e.status === 'early_bird' || e.status === 'greenlit') && !hasStarted(e) ? (
                                <IconBtn label="Cancel" danger onClick={() => { setReason(''); setDeleting(e.id); }}><Ban size={14} /></IconBtn>
                              ) : null}
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
                   {isDrafts ? 'No drafts yet. Start creating an event and hit "Save Draft" to keep it here.' : 'No events yet.'}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {target && (
        isDrafts ? (
          <DeleteEventModal
            eventName={target.title}
            title="Delete draft?"
            leadIn="You're about to delete the draft"
            warning="When this draft is deleted, your progress won't be saved. Drafts aren't published, so no one has pledged."
            onCancel={() => setDeleting(null)}
            onConfirm={() => { if (deleting) onDeleteDraft(deleting); setDeleting(null); }}
          />
        ) : targetCancelled ? (
          <DeleteEventModal
            eventName={target.title}
            title="Delete event?"
            leadIn="You're about to remove"
            confirmWord="CONFIRM"
            actionLabel="Delete Event"
            warning="This removes the event from your dashboard. Backers keep their record and refund."
            onCancel={() => setDeleting(null)}
            onConfirm={() => { if (deleting) onHide(deleting); setDeleting(null); }}
          />
        ) : (
          <DeleteEventModal
            eventName={target.title}
            title="Cancel Event?"
            leadIn="You're about to cancel"
            confirmWord="CONFIRM"
            actionLabel="Cancel Event"
            warning="All pledges will be refunded — wallet payments to backers' wallets instantly, card payments back to their cards. Backers will be notified by email."
            reason={reason}
            onReasonChange={setReason}
            reasonPrompt="Why are you cancelling this event?"
            onCancel={() => setDeleting(null)}
            onConfirm={() => { if (deleting) onCancel(deleting, reason); setDeleting(null); }}
          />
        )
      )}
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
