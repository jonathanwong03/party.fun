import { useEffect, useMemo, useRef, useState } from 'react';
import { Ticket, CheckCircle2, ScanLine, Camera, CameraOff } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { fetchEventTickets, checkInTicket, type EventTicket, type CheckInResult } from '../api';
import type { EventItem, Role } from '../components/types';

export function CheckIn({ role, events }: { role: Role | null; events: EventItem[] }) {
  // Admins can check in any event; organisers can check in owned + accepted co-organised events.
  // Only events that are CURRENTLY taking place are checkable: greenlit (not early-bird/cancelled/
  // completed) AND with "now" inside the event's start–end window. The backend still enforces
  // too_early/too_late on the actual check-in; this just narrows the picker.
  const mine = useMemo(() => {
    const now = Date.now();
    const owned = role === 'admin' ? events : events.filter((e) => e.canCheckIn ?? e.mine);
    return owned.filter((e) =>
      e.status === 'greenlit'
      && e.startsAt && e.endsAt
      && Date.parse(e.startsAt) <= now && now <= Date.parse(e.endsAt),
    );
  }, [events, role]);
  const [eventId, setEventId] = useState<string>('');
  const [tickets, setTickets] = useState<EventTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = (id: string) => {
    if (!id) return;
    setLoading(true);
    fetchEventTickets(id).then(setTickets).catch(() => setTickets([])).finally(() => setLoading(false));
  };

  useEffect(() => { if (eventId) load(eventId); }, [eventId]);

  const total = tickets.length;
  const checkedIn = tickets.filter((t) => t.status === 'used').length;

  const describe = (res: CheckInResult): { kind: 'ok' | 'err'; text: string } => {
    if (res.status === 'ok') {
      const n = res.checkedIn ?? 1;
      return { kind: 'ok', text: `Checked in ${n} ticket${n === 1 ? '' : 's'}${res.attendee ? ` for ${res.attendee}` : ''} ✓` };
    }
    const map: Record<string, string> = {
      already_used: `${res.attendee ?? 'This ticket'} is already checked in.`,
      nothing_to_check_in: 'No active tickets left on this booking.',
      not_found: 'No matching ticket for this event/organiser.',
      refunded: 'That ticket was cancelled/refunded — not valid.',
      given_away: 'That ticket was given away — not valid.',
      too_early: 'Too early — check-in opens when the event starts.',
      too_late: 'Too late — the event has ended.',
    };
    return { kind: 'err', text: map[res.error ?? ''] ?? 'Could not check in this code.' };
  };

  const doCheckIn = async (raw: string) => {
    const value = raw.trim();
    if (!value || !eventId) return;
    setMsg(null);
    try {
      const res = await checkInTicket(value);
      setMsg(describe(res));
      if (res.status === 'ok') { setCode(''); load(eventId); }
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Check-in failed.' });
    }
  };

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
      <h1 className="mb-6 flex items-center gap-2" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' }}>
        <Ticket size={26} style={{ color: '#ff4d2e' }} /> Ticket check-in
      </h1>

      <div className="mb-5 max-w-md">
        <label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Event</label>
        <Select value={eventId} onValueChange={(v) => { setScanning(false); setMsg(null); setEventId(v); }}>
          <SelectTrigger style={{ background: 'var(--surface-2)' }}>
            <SelectValue placeholder="Choose an event to check in" />
          </SelectTrigger>
          <SelectContent>
            {mine.map((e) => <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}
          </SelectContent>
        </Select>
        {mine.length === 0 && (
          <p className="mt-1.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
            No events are taking place right now — check-in opens during an event's start–end window.
          </p>
        )}
      </div>

      {eventId && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-4">
            <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <span className="text-2xl" style={{ fontWeight: 800 }}>{checkedIn}</span>
              <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}> / {total} checked in</span>
            </div>
            <Button onClick={() => setScanning((s) => !s)} variant="outline" className="gap-2" style={{ borderRadius: 12 }}>
              {scanning ? <><CameraOff size={15} /> Stop camera</> : <><Camera size={15} /> Scan with camera</>}
            </Button>
          </div>

          {scanning && (
            <div className="mb-5 rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <QrScanner onScan={doCheckIn} />
              <p className="mt-2 text-center text-xs" style={{ color: 'var(--muted-foreground)' }}>Point the camera at a booking or ticket QR code.</p>
            </div>
          )}

          {/* Manual code entry */}
          <div className="mb-5 flex max-w-xl gap-2">
            <div className="relative flex-1">
              <ScanLine size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doCheckIn(code); }}
                placeholder="Enter ticket / booking code"
                className="pl-9"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
              />
            </div>
            <Button onClick={() => doCheckIn(code)} className="bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12 }}>Check in</Button>
          </div>

          {msg && (
            <div className="mb-5 max-w-xl rounded-lg p-3 text-sm" style={msg.kind === 'ok'
              ? { background: 'rgba(41,224,122,0.10)', border: '1px solid rgba(41,224,122,0.3)', color: 'var(--status-green)' }
              : { background: 'rgba(255,77,46,0.10)', border: '1px solid rgba(255,77,46,0.3)', color: 'var(--status-red)' }}>
              {msg.text}
            </div>
          )}

          {/* Ticket list */}
          <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr style={{ color: 'var(--muted-foreground)' }} className="text-left">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Code</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Attendee</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.qrCode} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-3 font-mono text-xs">{t.qrCode}</td>
                    <td className="px-4 py-3">{t.username}</td>
                    <td className="px-4 py-3">
                      {t.status === 'used'
                        ? <span className="inline-flex items-center gap-1" style={{ color: 'var(--status-green)', fontWeight: 600 }}><CheckCircle2 size={14} /> Checked in</span>
                        : <span style={{ color: 'var(--muted-foreground)' }}>Not yet</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {t.status !== 'used' && (
                        <Button onClick={() => doCheckIn(t.qrCode)} variant="outline" className="h-8 text-xs" style={{ borderRadius: 10 }}>Check in</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && tickets.length === 0 && (
              <div className="px-3 py-12 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>No tickets for this event yet.</div>
            )}
            {loading && <div className="px-3 py-12 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>Loading…</div>}
          </div>
        </>
      )}
    </div>
  );
}

// Camera QR scanner (html5-qrcode). Debounces repeat reads so one physical scan = one check-in.
function QrScanner({ onScan }: { onScan: (text: string) => void }) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    let scanner: any = null;
    let cancelled = false;
    const last = { code: '', t: 0 };
    const SCANNING = 2; // Html5QrcodeScannerState.SCANNING

    // Stop the camera safely — only when actually scanning, and never let a
    // (sometimes synchronous) throw from html5-qrcode escape.
    const teardown = () => {
      if (!scanner) return;
      try {
        if (typeof scanner.getState === 'function' && scanner.getState() === SCANNING) {
          Promise.resolve(scanner.stop()).then(() => { try { scanner.clear(); } catch { /* ignore */ } }).catch(() => {});
        } else {
          try { scanner.clear(); } catch { /* ignore */ }
        }
      } catch { /* not running — nothing to stop */ }
    };

    (async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (cancelled) return;
      scanner = new Html5Qrcode('qr-reader');
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 250 },
          (decoded: string) => {
            const now = Date.now();
            if (decoded === last.code && now - last.t < 2500) return;
            last.code = decoded; last.t = now;
            onScanRef.current(decoded);
          },
          () => {},
        );
        if (cancelled) teardown(); // unmounted while the camera was starting
      } catch { /* camera unavailable / denied */ }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, []);

  return <div id="qr-reader" className="mx-auto" style={{ width: '100%', maxWidth: 360 }} />;
}
