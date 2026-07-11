import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { TrendingUp, Users, DollarSign, CalendarCheck, Ticket, Zap, CheckCircle2, Sparkles, LineChart as LineChartIcon } from 'lucide-react';
import { fetchAnalytics, fetchHostedSummary, fetchEventCalculator, saveEventCalculator, fetchRevenueTips, type AnalyticsData, type DayCount, type HostedSummary, type CalculatorState, type CalcCost, type RevenueTip } from '../api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import type { EventItem, Role, Route } from '../components/types';

const PIE_COLORS = ['#ff4d2e', '#29e07a', '#ffd23f', '#4d8dff', '#b04dff'];
const AXIS = { fontSize: 11, fill: '#8a8a99' } as const;

type Gran = 'day' | 'week' | 'month';

function aggregate(series: DayCount[], gran: Gran): { label: string; count: number }[] {
  if (gran === 'day') return series.map((d) => ({ label: d.day.slice(5), count: Number(d.count) }));
  const map = new Map<string, number>();
  for (const d of series) {
    const date = new Date(d.day);
    let key: string;
    if (gran === 'month') {
      key = d.day.slice(0, 7);
    } else {
      const onejan = new Date(date.getFullYear(), 0, 1);
      const week = Math.ceil((((date.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7);
      key = `${date.getFullYear()}-W${String(week).padStart(2, '0')}`;
    }
    map.set(key, (map.get(key) ?? 0) + Number(d.count));
  }
  return Array.from(map, ([label, count]) => ({ label, count }));
}

export function Analytics({ role, events }: { role: Role | null; go: (r: Route) => void; events?: EventItem[] }) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [hosted, setHosted] = useState<HostedSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gran, setGran] = useState<Gran>('day');

  useEffect(() => {
    let ignore = false;
    fetchAnalytics().then((d) => { if (!ignore) setData(d); }).catch((e) => { if (!ignore) setError(e instanceof Error ? e.message : 'Unable to load analytics.'); });
    return () => { ignore = true; };
  }, [role]);

  useEffect(() => {
    if (!data?.organiser) return;
    let ignore = false;
    fetchHostedSummary().then((s) => { if (!ignore) setHosted(s); }).catch(() => {});
    return () => { ignore = true; };
  }, [data?.organiser]);

  const spendSeries = useMemo(
    () => (data ? aggregate((data.user.spendByDay ?? []).map((d) => ({ day: d.day, count: Number(d.amount) })), gran) : []),
    [data, gran],
  );

  if (error) return <Shell><Empty text={error} /></Shell>;
  if (!data) return <Shell><Empty text="Loading analytics…" /></Shell>;

  const topEvents = data.global.topEvents.map((e) => ({ ...e, name: e.title.length > 18 ? e.title.slice(0, 17) + '…' : e.title }));

  return (
    <Shell>
      {/* Personal summary (everyone) */}
      {data.platform ? (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Stat icon={CalendarCheck} accent="#ff4d2e" label="Total events" value={String(data.platform.totals.events)} />
          <Stat icon={Users} accent="#4d8dff" label="Total attendees" value={String(data.platform.totals.attendees)} />
          <Stat icon={DollarSign} accent="#29e07a" label="Platform revenue" value={`$${Number(data.platform.totals.revenue).toFixed(2)}`} />
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Stat icon={CalendarCheck} accent="#ff4d2e" label="All events joined" value={String(data.user.totals.joined)} />
          <Stat icon={TrendingUp} accent="#4d8dff" label="Current events joined" value={String(data.user.totals.upcoming)} />
          <Stat icon={DollarSign} accent="#29e07a" label="Total spent" value={`$${Number(data.user.totals.spent).toFixed(2)}`} />
        </div>
      )}

      {/* Spending over time (personal, non-admin) */}
      {!data.platform && (
        <ChartCard
          title="Spending over time"
          subtitle="What you've spent on tickets"
          right={<Granularity value={gran} onChange={setGran} />}
        >
          {spendSeries.length === 0 ? <Empty text="No spending yet." /> : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={spendSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="spend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#29e07a" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#29e07a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${Number(v).toFixed(2)}`} />
                <Area type="monotone" dataKey="count" name="Spent ($)" stroke="#29e07a" strokeWidth={2} fill="url(#spend)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Most popular events (global, cross-organiser) */}
        <ChartCard title="Most popular events" subtitle="Confirmed tickets across all organisers">
          {topEvents.length === 0 ? <Empty text="No active events yet." /> : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topEvents} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" width={120} tick={AXIS} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="ticketsSold" name="Tickets" fill="#ff4d2e" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Event status breakdown */}
        <ChartCard title="Events by status" subtitle="All events on the platform">
          {data.global.statusBreakdown.length === 0 ? <Empty text="No events yet." /> : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={data.global.statusBreakdown} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={100} label>
                  {data.global.statusBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#f5f5f7' }} labelStyle={{ color: '#f5f5f7' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Organiser hosted-events summary */}
      {data.organiser && (
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Stat icon={TrendingUp} accent="#ff4d2e" label="Total events" value={String(hosted?.totalEvents ?? 0)} hint="All-time events" />
          <Stat icon={Zap} accent="#ffcb3c" label="Upcoming" value={String(hosted?.upcoming ?? 0)} hint="Ongoing events" />
          <Stat icon={CheckCircle2} accent="#29e07a" label="Confirmed" value={String(hosted?.confirmed ?? 0)} hint="Reached the hype threshold" />
        </div>
      )}

      {/* Admin platform section */}
      {data.platform && (
        <div className="mt-6">
          <ChartCard title="Top organisers" subtitle="By confirmed tickets across their events">
            {data.platform.topOrganisers.length === 0 ? <Empty text="No organisers yet." /> : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={data.platform.topOrganisers.map((o) => ({ ...o, name: o.name.length > 14 ? o.name.slice(0, 13) + '…' : o.name }))} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="tickets" name="Tickets" fill="#ff4d2e" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="events" name="Events" fill="#4d8dff" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      )}

      {/* Organiser-only profit calculator */}
      {data.organiser && (
        <div className="mt-6">
          <ProfitCalculator events={(events ?? []).filter((e) => e.mine)} />
        </div>
      )}
    </Shell>
  );
}

const tooltipStyle = { background: '#14141b', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 12, color: '#f5f5f7' } as const;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1536px] px-6 py-8">
      <h1 className="mb-6 flex items-center gap-2" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' }}>
        <Ticket size={26} style={{ color: '#ff4d2e' }} /> Analytics
      </h1>
      {children}
    </div>
  );
}

function ChartCard({ title, subtitle, right, children }: { title: React.ReactNode; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h3 style={{ fontWeight: 700 }}>{title}</h3>
          {subtitle && <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{subtitle}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Granularity({ value, onChange }: { value: Gran; onChange: (g: Gran) => void }) {
  const opts: Gran[] = ['day', 'week', 'month'];
  return (
    <div className="flex gap-1 rounded-lg p-1" style={{ background: 'var(--surface-2)' }}>
      {opts.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className="rounded-md px-2.5 py-1 text-xs capitalize transition"
          style={{ background: value === o ? '#ff4d2e' : 'transparent', color: value === o ? '#fff' : 'var(--muted-foreground)', fontWeight: 600 }}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

// Profit calculator. Pick one of your events, set ticket prices/quantities and
// operational costs, and read off profit = total revenue − total cost. A guide for how
// many tickets to sell. Ticket prices here are hypothetical — they never change the
// live event.
function ProfitCalculator({ events }: { events: EventItem[] }) {
  const candidates = events.filter((e) => e.status !== 'cancelled' && e.status !== 'completed');
  const [eventId, setEventId] = useState(candidates[0]?.id ?? '');
  const [state, setState] = useState<CalculatorState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!eventId) { setState(null); return; }
    let ignore = false;
    setLoading(true);
    setSaved(false);
    fetchEventCalculator(eventId)
      .then((r) => { if (!ignore) setState(r.state ?? null); })
      .catch(() => { if (!ignore) setState(null); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [eventId]);

  const econ = useMemo(() => (state ? computeEcon(state) : null), [state]);

  if (candidates.length === 0) return null;

  const edit = (next: CalculatorState) => { setState(next); setSaved(false); };

  async function save() {
    if (!state || saving) return;
    setSaving(true);
    try {
      await saveEventCalculator(eventId, state);
      setSaved(true);
    } catch { /* leave unsaved */ } finally {
      setSaving(false);
    }
  }

  const selector = (
    <Select value={eventId} onValueChange={setEventId}>
      <SelectTrigger size="sm" className="text-xs" style={{ background: 'var(--surface)', maxWidth: 220 }}>
        <SelectValue placeholder="Choose an event" />
      </SelectTrigger>
      <SelectContent>
        {candidates.map((e) => (
          <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <ChartCard
      title={<span className="flex items-center gap-2"><LineChartIcon size={16} style={{ color: '#ff4d2e' }} /> Profit calculator</span>}
      subtitle="Set your ticket prices, quantities and operational costs to see your profit. Prices here are a guide — they don't change the live event."
      right={selector}
    >
      {loading || !state || !econ ? <Empty text={loading ? 'Loading…' : 'Pick an event.'} />
        : (
          <div className="space-y-5">
            <CalcTickets state={state} onChange={edit} />
            <CalcCosts state={state} onChange={edit} />
            <CalcTotals econ={econ} />
            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50"
                style={{ background: '#ff4d2e' }}
              >
                {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save calculator'}
              </button>
              <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Your prices, quantities and costs are saved per event.</span>
            </div>
            <RevenueTipsPanel eventId={eventId} />
          </div>
        )}
    </ChartCard>
  );
}

// ── Profit-calculator math (mirrors backend/services/eventEconomics.js) ──────────
function calcHypeRevenue(base: number, max: number, capacity: number, qty: number): number {
  const cap = Math.max(1, Math.trunc(capacity || 0));
  const n = Math.max(0, Math.trunc(qty || 0));
  if (base <= 0 || max <= 0 || n === 0) return 0;
  const ratio = max / base;
  let total = 0;
  for (let k = 0; k < n; k += 1) total += base * ratio ** Math.min(k / cap, 1);
  return Math.round(total * 100) / 100;
}

function computeEcon(state: CalculatorState) {
  const t = state.tickets;
  let totalRevenue = 0;
  let ticketCount = 0;
  if (t.model === 'hype') {
    ticketCount = Math.max(0, Math.trunc(t.qty || 0));
    totalRevenue = calcHypeRevenue(t.basePrice || 0, t.maxPrice || 0, t.capacity || 0, ticketCount);
  } else {
    for (const tier of t.tiers) {
      const price = Number(tier.price) || 0;
      const qty = Math.max(0, Math.trunc(Number(tier.qty) || 0));
      totalRevenue += price * qty;
      ticketCount += qty;
    }
  }
  const totalCost = (state.costs ?? []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const revenue = Math.round(totalRevenue * 100) / 100;
  const cost = Math.round(totalCost * 100) / 100;
  const avgPrice = ticketCount > 0 ? Math.round((revenue / ticketCount) * 100) / 100 : 0;
  return { totalRevenue: revenue, totalCost: cost, profit: Math.round((revenue - cost) * 100) / 100, ticketCount, avgTicketPrice: avgPrice };
}

// AI revenue-boost tips for the selected event (on-demand).
function RevenueTipsPanel({ eventId }: { eventId: string }) {
  const [tips, setTips] = useState<RevenueTip[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => { setTips(null); setError(false); }, [eventId]);

  async function load() {
    if (!eventId || loading) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetchRevenueTips(eventId);
      if (!res.available) setError(true);
      else setTips(res.tips ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const impactColor = (i: RevenueTip['impact']) => (i === 'high' ? '#29e07a' : i === 'medium' ? '#ffcb3c' : '#8a8a99');

  return (
    <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
      {tips === null ? (
        <div className="flex flex-col gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex w-fit items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50"
            style={{ background: '#ff4d2e' }}
          >
            <Sparkles size={14} /> {loading ? 'Thinking…' : error ? 'Try again' : 'Get AI tips'}
          </button>
          {error && <span className="text-xs" style={{ color: '#ff4d2e' }}>Couldn't generate tips right now — please try again.</span>}
        </div>
      ) : tips.length === 0 ? (
        <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>No tips available right now.</div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
            <Sparkles size={14} style={{ color: '#ff4d2e' }} /> AI revenue tips
          </div>
          {tips.map((t, i) => (
            <div key={i} className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm" style={{ fontWeight: 600, color: 'var(--foreground)' }}>{t.title}</span>
                <span className="text-xs uppercase" style={{ color: impactColor(t.impact), fontWeight: 700 }}>{t.impact}</span>
              </div>
              <div className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>{t.detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// −/+ stepper for a non-negative integer quantity (also directly editable).
function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.max(0, Math.trunc(v || 0)));
  const btn = 'grid size-8 place-items-center rounded-lg text-sm font-bold transition';
  return (
    <div className="flex items-center gap-1.5">
      <button className={btn} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }} onClick={() => set(value - 1)}>−</button>
      <input
        type="number"
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="w-16 rounded-lg px-2 py-1.5 text-center text-sm"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
      />
      <button className={btn} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }} onClick={() => set(value + 1)}>+</button>
    </div>
  );
}

// A $-prefixed numeric field for prices/costs (allows decimals, non-negative).
function MoneyField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex items-center rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <span className="pl-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>$</span>
      <input
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="w-24 rounded-lg px-1.5 py-1.5 text-sm"
        style={{ background: 'transparent', color: 'var(--foreground)' }}
      />
    </div>
  );
}

function CalcRow({ label, children, right }: { label: React.ReactNode; children?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t py-2.5 first:border-t-0" style={{ borderColor: 'var(--border)' }}>
      <span className="min-w-24 text-sm" style={{ color: 'var(--foreground)', fontWeight: 600 }}>{label}</span>
      <div className="flex flex-1 flex-wrap items-center justify-end gap-3">{children}</div>
      {right !== undefined && <span className="w-20 text-right text-sm font-semibold" style={{ color: 'var(--foreground)' }}>{right}</span>}
    </div>
  );
}

// Ticket revenue rows — tiered (early-bird/greenlit) or a hype bonding curve.
function CalcTickets({ state, onChange }: { state: CalculatorState; onChange: (s: CalculatorState) => void }) {
  const t = state.tickets;
  const header = (
    <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
      <Ticket size={14} style={{ color: '#ff4d2e' }} /> Ticket revenue
    </div>
  );

  if (t.model === 'hype') {
    const setHype = (patch: Partial<typeof t>) => onChange({ ...state, tickets: { ...t, ...patch } });
    return (
      <div>
        {header}
        <div className="rounded-xl px-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <CalcRow label="Base price"><MoneyField value={t.basePrice} onChange={(v) => setHype({ basePrice: v })} /></CalcRow>
          <CalcRow label="Max price"><MoneyField value={t.maxPrice} onChange={(v) => setHype({ maxPrice: v })} /></CalcRow>
          <CalcRow label="Capacity"><Stepper value={t.capacity} onChange={(v) => setHype({ capacity: v })} /></CalcRow>
          <CalcRow label="Tickets to sell" right={`$${calcHypeRevenue(t.basePrice, t.maxPrice, t.capacity, t.qty).toFixed(2)}`}>
            <Stepper value={t.qty} onChange={(v) => setHype({ qty: v })} />
          </CalcRow>
        </div>
        <div className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>Hype pricing: each ticket costs more as more sell (base → max along the curve).</div>
      </div>
    );
  }

  const setTier = (i: number, patch: Partial<typeof t.tiers[number]>) =>
    onChange({ ...state, tickets: { ...t, tiers: t.tiers.map((tr, idx) => (idx === i ? { ...tr, ...patch } : tr)) } });
  return (
    <div>
      {header}
      <div className="rounded-xl px-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        {t.tiers.map((tier, i) => (
          <CalcRow key={tier.key} label={tier.label} right={`$${((Number(tier.price) || 0) * (Number(tier.qty) || 0)).toFixed(2)}`}>
            <MoneyField value={tier.price} onChange={(v) => setTier(i, { price: v })} />
            <Stepper value={tier.qty} onChange={(v) => setTier(i, { qty: v })} />
          </CalcRow>
        ))}
      </div>
    </div>
  );
}

// Editable operational-cost line items (add / rename / re-price / delete).
function CalcCosts({ state, onChange }: { state: CalculatorState; onChange: (s: CalculatorState) => void }) {
  const costs: CalcCost[] = state.costs ?? [];
  const setCost = (i: number, patch: Partial<CalcCost>) => onChange({ ...state, costs: costs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  const addCost = () => onChange({ ...state, costs: [...costs, { name: '', amount: 0 }] });
  const removeCost = (i: number) => onChange({ ...state, costs: costs.filter((_, idx) => idx !== i) });
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
          <DollarSign size={14} style={{ color: '#ff4d2e' }} /> Operational costs
        </div>
        <button onClick={addCost} className="rounded-lg px-2.5 py-1 text-xs font-semibold transition" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>+ Add cost</button>
      </div>
      <div className="rounded-xl px-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        {costs.length === 0 ? (
          <div className="py-3 text-xs" style={{ color: 'var(--muted-foreground)' }}>No costs yet — add one.</div>
        ) : costs.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-3 border-t py-2.5 first:border-t-0" style={{ borderColor: 'var(--border)' }}>
            <input
              value={c.name}
              placeholder="Cost name"
              onChange={(e) => setCost(i, { name: e.target.value })}
              className="flex-1 rounded-lg px-2 py-1.5 text-sm"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)', minWidth: 120 }}
            />
            <MoneyField value={c.amount} onChange={(v) => setCost(i, { amount: v })} />
            <button onClick={() => removeCost(i)} className="grid size-8 place-items-center rounded-lg text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: '#ff4d2e' }} aria-label="Delete cost">✕</button>
          </div>
        ))}
      </div>
      <div className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>Costs are paid outside party.fun — the app never charges them.</div>
    </div>
  );
}

// The bottom-line totals (like the IPPT "Total Points" footer).
function CalcTotals({ econ }: { econ: { totalRevenue: number; totalCost: number; profit: number; ticketCount: number; avgTicketPrice: number } }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Mini label="Total revenue" value={`$${econ.totalRevenue.toFixed(2)}`} accent="#29e07a" />
        <Mini label="Total cost" value={`$${econ.totalCost.toFixed(2)}`} accent="#ff4d2e" />
        <Mini label="Profit" value={`$${econ.profit.toFixed(2)}`} accent={econ.profit >= 0 ? '#29e07a' : '#ff4d2e'} />
      </div>
      <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
        Target: {econ.ticketCount} ticket{econ.ticketCount === 1 ? '' : 's'} @ avg ${econ.avgTicketPrice.toFixed(2)}.
        {econ.avgTicketPrice > 0 && ` Break-even ≈ ${Math.ceil(econ.totalCost / econ.avgTicketPrice)} tickets to cover costs.`}
      </div>
    </div>
  );
}


function Mini({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{label}</div>
      <div className="mt-1" style={{ fontSize: 20, fontWeight: 800, color: accent }}>{value}</div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, accent, hint }: { icon: any; label: string; value: string; accent: string; hint?: string }) {
  return (
    <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-center justify-between">
        <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{label}</span>
        <div className="grid size-8 place-items-center rounded-lg" style={{ background: `${accent}20`, color: accent }}><Icon size={15} /></div>
      </div>
      <div className="mt-2" style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>{value}</div>
      {hint && <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{hint}</div>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="grid h-40 place-items-center text-sm" style={{ color: 'var(--muted-foreground)' }}>{text}</div>;
}
