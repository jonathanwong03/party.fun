import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { TrendingUp, Users, DollarSign, CalendarCheck, Ticket } from 'lucide-react';
import { fetchAnalytics, type AnalyticsData, type DayCount } from '../api';
import type { Role, Route } from '../components/types';

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

export function Analytics({ role }: { role: Role | null; go: (r: Route) => void }) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gran, setGran] = useState<Gran>('day');

  useEffect(() => {
    let ignore = false;
    fetchAnalytics().then((d) => { if (!ignore) setData(d); }).catch((e) => { if (!ignore) setError(e instanceof Error ? e.message : 'Unable to load analytics.'); });
    return () => { ignore = true; };
  }, [role]);

  const pledgeSeries = useMemo(() => (data ? aggregate(data.global.pledgesByDay, gran) : []), [data, gran]);
  const myPledgeSeries = useMemo(() => (data?.organiser ? aggregate(data.organiser.pledgesByDay, gran) : []), [data, gran]);

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
          <Stat icon={CalendarCheck} accent="#ff4d2e" label="Events joined" value={String(data.user.totals.joined)} />
          <Stat icon={TrendingUp} accent="#4d8dff" label="Upcoming" value={String(data.user.totals.upcoming)} />
          <Stat icon={DollarSign} accent="#29e07a" label="Total spent" value={`$${Number(data.user.totals.spent).toFixed(2)}`} />
        </div>
      )}

      {/* Pledges over time toggle */}
      <ChartCard
        title="Pledges over time"
        subtitle="New pledges across all events"
        right={<Granularity value={gran} onChange={setGran} />}
      >
        {pledgeSeries.length === 0 ? <Empty text="No pledges yet." /> : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={pledgeSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="pl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff4d2e" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#ff4d2e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="count" name="Pledges" stroke="#ff4d2e" strokeWidth={2} fill="url(#pl)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

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
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

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

      {/* Organiser-only section */}
      {data.organiser && (
        <>
          <h2 className="mb-4 mt-10" style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>Your events</h2>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Stat icon={CalendarCheck} accent="#ff4d2e" label="Events created" value={String(data.organiser.totals.events)} />
            <Stat icon={Users} accent="#4d8dff" label="Projected attendees" value={String(data.organiser.totals.attendees)} />
            <Stat icon={DollarSign} accent="#29e07a" label="Revenue" value={`$${Number(data.organiser.totals.revenue).toFixed(2)}`} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Revenue by event" subtitle="Net of refunds">
              {data.organiser.perEvent.length === 0 ? <Empty text="No events yet." /> : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data.organiser.perEvent.map((e) => ({ ...e, name: e.title.length > 14 ? e.title.slice(0, 13) + '…' : e.title }))} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="revenue" name="Revenue ($)" fill="#29e07a" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
            <ChartCard title="Projected attendance vs capacity">
              {data.organiser.perEvent.length === 0 ? <Empty text="No events yet." /> : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data.organiser.perEvent.map((e) => ({ ...e, name: e.title.length > 14 ? e.title.slice(0, 13) + '…' : e.title }))} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="projected" name="Projected" fill="#ff4d2e" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="capacity" name="Capacity" fill="#4d8dff" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
          {myPledgeSeries.length > 0 && (
            <div className="mt-6">
              <ChartCard title="Your pledges over time" right={<Granularity value={gran} onChange={setGran} />}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={myPledgeSeries} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="count" name="Pledges" fill="#ff4d2e" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          )}
        </>
      )}

      {/* Personal spend (non-admins) */}
      {!data.platform && data.user.spendByMonth.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-4" style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>Your spending</h2>
          <ChartCard title="Spend by month">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.user.spendByMonth.map((m) => ({ label: m.month, amount: Number(m.amount) }))} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="amount" name="Spent ($)" fill="#29e07a" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
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

function ChartCard({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
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

function Stat({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-center justify-between">
        <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{label}</span>
        <div className="grid size-8 place-items-center rounded-lg" style={{ background: `${accent}20`, color: accent }}><Icon size={15} /></div>
      </div>
      <div className="mt-2" style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>{value}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="grid h-40 place-items-center text-sm" style={{ color: 'var(--muted-foreground)' }}>{text}</div>;
}
