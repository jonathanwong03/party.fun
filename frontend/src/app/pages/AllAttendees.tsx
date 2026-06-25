import { useEffect, useMemo, useState } from 'react';
import { Users, Download, Search } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { fetchAllAttendees, type AttendeeRow } from '../api';

export function AllAttendees() {
  const [rows, setRows] = useState<AttendeeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let ignore = false;
    fetchAllAttendees().then((r) => { if (!ignore) setRows(r); }).catch((e) => { if (!ignore) setError(e instanceof Error ? e.message : 'Unable to load attendees.'); });
    return () => { ignore = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => `${r.eventTitle} ${r.username} ${r.email}`.toLowerCase().includes(term));
  }, [rows, q]);

  const downloadCsv = () => {
    if (!rows?.length) return;
    const header = ['Event', 'Name', 'Email', 'Phone', 'Telegram', 'Tickets', 'Status'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [header.join(',')].concat(
      rows.map((r) => [r.eventTitle, r.username, r.email, r.contact, r.socialLink, r.ticketCount, r.status].map(esc).join(',')),
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'attendees.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-[1536px] px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' }}>
          <Users size={26} style={{ color: '#ff4d2e' }} /> Attendees
        </h1>
        <Button onClick={downloadCsv} disabled={!rows?.length} variant="outline" className="gap-2" style={{ borderRadius: 12, height: 42 }}>
          <Download size={15} /> Export CSV
        </Button>
      </div>

      <div className="relative mb-5 max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search event, name or email…" className="pl-9" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }} />
      </div>

      <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: 'var(--muted-foreground)' }} className="text-left">
              <Th>Event</Th><Th>Name</Th><Th>Email</Th><Th>Phone</Th><Th>Telegram</Th><Th>Tickets</Th><Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                <Td>{r.eventTitle}</Td>
                <Td>{r.username}</Td>
                <Td>{r.email}</Td>
                <Td>{r.contact ?? '—'}</Td>
                <Td>{r.socialLink ?? '—'}</Td>
                <Td>{r.ticketCount}</Td>
                <Td><span className="capitalize">{r.status}</span></Td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && filtered.length === 0 && (
          <div className="px-3 py-12 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
            {error ?? (rows.length === 0 ? 'No attendees yet.' : 'No matches.')}
          </div>
        )}
        {!rows && <div className="px-3 py-12 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>{error ?? 'Loading…'}</div>}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3">{children}</td>;
}
