import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { TrendingUp, Users, DollarSign, CalendarCheck, Ticket, Zap, CheckCircle2, Sparkles, LineChart as LineChartIcon } from 'lucide-react';
import { fetchAnalytics, fetchHostedSummary, fetchRevenueForecast, fetchRevenueTips, type AnalyticsData, type DayCount, type HostedSummary, type RevenueForecast, type RevenueTip } from '../api';
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

      {/* Organiser-only forecast */}
      {data.organiser && (
        <div className="mt-6">
          <RevenueForecast events={(events ?? []).filter((e) => e.mine)} />
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

// Ticket revenue forecast. Pick one of your events to see projected daily sales and revenue.
function RevenueForecast({ events }: { events: EventItem[] }) {
  const candidates = events.filter((e) => e.status !== 'cancelled' && e.status !== 'completed');
  const [eventId, setEventId] = useState(candidates[0]?.id ?? '');
  const [fc, setFc] = useState<RevenueForecast | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!eventId) { setFc(null); return; }
    let ignore = false;
    setLoading(true);
    fetchRevenueForecast(eventId)
      .then((r) => { if (!ignore) setFc(r); })
      .catch(() => { if (!ignore) setFc({ available: false }); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [eventId]);

  if (candidates.length === 0) return null;

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
      title={<span className="flex items-center gap-2"><LineChartIcon size={16} style={{ color: '#ff4d2e' }} /> Expected ticket revenue</span>}
      subtitle="Forecast daily sales and ticket revenue. Operational costs are outside party.fun."
      right={selector}
    >
      {loading ? <Empty text="Forecasting…" />
        : !fc || fc.available === false ? <Empty text="Forecast unavailable." />
        : <><ForecastBody fc={fc} /><RevenueTipsPanel eventId={eventId} /></>}
    </ChartCard>
  );
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

type FcMetric = 'tickets' | 'revenue';

// Group the day-offset forecast into day / week (7) / month (30) buckets, summing
// tickets and revenue, so the chart can be viewed at coarser horizons.
function bucketForecast(
  sales: { dayOffset: number; tickets: number }[],
  revenue: { dayOffset: number; revenue: number }[],
  horizon: Gran,
): { label: string; tickets: number; revenue: number }[] {
  const revByOffset = new Map(revenue.map((d) => [d.dayOffset, d.revenue]));
  const rows = sales.map((d) => ({ offset: d.dayOffset, tickets: d.tickets, revenue: revByOffset.get(d.dayOffset) ?? 0 }));
  if (horizon === 'day') return rows.map((r) => ({ label: `D${r.offset}`, tickets: r.tickets, revenue: r.revenue }));
  const size = horizon === 'week' ? 7 : 30;
  const prefix = horizon === 'week' ? 'W' : 'M';
  const out: { label: string; tickets: number; revenue: number }[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    out.push({
      label: `${prefix}${Math.floor(i / size) + 1}`,
      tickets: chunk.reduce((s, r) => s + r.tickets, 0),
      revenue: Math.round(chunk.reduce((s, r) => s + r.revenue, 0) * 100) / 100,
    });
  }
  return out;
}

function ForecastBody({ fc }: { fc: RevenueForecast }) {
  const [metric, setMetric] = useState<FcMetric>('tickets');
  const [horizon, setHorizon] = useState<Gran>('day');
  const costs = fc.operationalCosts ?? [];
  const totalCost = fc.totalOperationalCost ?? costs.reduce((sum, c) => sum + c.cost, 0);
  const profit = fc.estimatedNet ?? ((fc.projectedRevenue ?? 0) - totalCost);
  const series = bucketForecast(fc.dailySales ?? [], fc.dailyRevenue ?? [], horizon);
  const isRevenue = metric === 'revenue';
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Mini label="Projected revenue" value={`$${(fc.projectedRevenue ?? 0).toFixed(2)}`} accent="#29e07a" />
        <Mini label="Projected profit" value={`$${profit.toFixed(2)}`} accent={profit >= 0 ? '#29e07a' : '#ff4d2e'} />
        <Mini label="Projected tickets" value={`${fc.projectedTicketsSold ?? 0}`} accent="#4d8dff" />
      </div>
      <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
        Projected {fc.projectedTicketsSold ?? 0} tickets sold @ avg ${(fc.avgTicketPrice ?? 0).toFixed(2)}.
      </div>
      {fc.benchmark && (
        <div className="flex items-start gap-2 rounded-xl p-3 text-xs" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>
          <TrendingUp size={14} style={{ marginTop: 1, flexShrink: 0, color: '#4d8dff' }} />
          <span>
            Benchmark: {fc.benchmark.similarCount} similar past event{fc.benchmark.similarCount === 1 ? '' : 's'} sold about{' '}
            <strong>{fc.benchmark.avgSellThroughPct}%</strong> of capacity
            {fc.benchmark.examples?.length ? ` (e.g. ${fc.benchmark.examples.map((x) => `${x.title} ${x.sellThroughPct}%`).join(', ')})` : ''}.
          </span>
        </div>
      )}
      {costs.length > 0 && (
        <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
            Estimated operational costs outside party.fun
          </div>
          <div className="mt-3 grid gap-1.5">
            {costs.map(({ category, cost }) => (
              <div key={category} className="flex items-center justify-between gap-3 text-sm">
                <span style={{ color: 'var(--foreground)' }}>{category}</span>
                <span style={{ color: 'var(--foreground)', fontWeight: 600 }}>${cost.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t pt-2 text-sm" style={{ borderColor: 'var(--border)' }}>
            <span className="font-semibold" style={{ color: 'var(--foreground)' }}>Total operational cost</span>
            <span className="font-semibold" style={{ color: '#ff4d2e' }}>${totalCost.toFixed(2)}</span>
          </div>
        </div>
      )}
      {series.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SegToggle
              value={metric}
              onChange={setMetric}
              opts={[{ v: 'tickets', label: 'Tickets' }, { v: 'revenue', label: 'Revenue' }]}
            />
            <Granularity value={horizon} onChange={setHorizon} />
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="fctickets" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4d8dff" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#4d8dff" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="fcrevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#29e07a" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#29e07a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={!isRevenue} tick={AXIS} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={isRevenue ? (v: number) => `$${Number(v).toFixed(2)}` : undefined} />
              <Area
                type="monotone"
                dataKey={isRevenue ? 'revenue' : 'tickets'}
                name={isRevenue ? 'Revenue ($)' : 'Projected sales'}
                stroke={isRevenue ? '#29e07a' : '#4d8dff'}
                strokeWidth={2}
                fill={isRevenue ? 'url(#fcrevenue)' : 'url(#fctickets)'}
              />
            </AreaChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}

function SegToggle<T extends string>({ value, onChange, opts }: { value: T; onChange: (v: T) => void; opts: { v: T; label: string }[] }) {
  return (
    <div className="flex gap-1 rounded-lg p-1" style={{ background: 'var(--surface-2)' }}>
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className="rounded-md px-2.5 py-1 text-xs transition"
          style={{ background: value === o.v ? '#ff4d2e' : 'transparent', color: value === o.v ? '#fff' : 'var(--muted-foreground)', fontWeight: 600 }}
        >
          {o.label}
        </button>
      ))}
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
