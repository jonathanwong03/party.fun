import { useEffect, useState } from 'react';
import { ChevronLeft, Mail } from 'lucide-react';
import { type EventItem, type Route } from '../components/types';
import { fetchAttendees, fetchAttendeeDetails, type Attendee, type AttendeeDetail } from '../api';

const AVATAR_COLORS = ['#ec2727', '#91e357', '#a1b3e0', '#dbe12b', '#30b2ea', '#ff8a3d', '#b07cff'];
function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  if (url) {
    return <img src={url} alt={name} referrerPolicy="no-referrer" className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <div
      className="grid place-items-center rounded-full text-white"
      style={{ width: size, height: size, background: colorFor(name), fontSize: size * 0.45, fontWeight: 600 }}
    >
      {initial}
    </div>
  );
}

export function Attendees({ id, go, events }: { id: string; go: (r: Route) => void; events: EventItem[] }) {
  const event = events.find((e) => e.id === id);
  const canViewDetails = !!(event?.canViewAttendees ?? event?.mine);
  const [basic, setBasic] = useState<Attendee[] | null>(null);
  const [detailed, setDetailed] = useState<AttendeeDetail[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);
    const load = canViewDetails
      ? fetchAttendeeDetails(id).then((d) => { if (!ignore) setDetailed(d); })
      : fetchAttendees(id).then((d) => { if (!ignore) setBasic(d); });
    load
      .catch((e) => { if (!ignore) setError(e instanceof Error ? e.message : 'Unable to load attendees.'); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [id, canViewDetails]);

  const count = detailed?.length ?? basic?.length ?? 0;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <button
        onClick={() => go({ name: 'event', id, ...(canViewDetails ? { fromOrganiser: true } : {}) })}
        className="mb-4 inline-flex items-center gap-1 text-sm hover:text-foreground"
        style={{ color: 'var(--muted-foreground)' }}
      >
        <ChevronLeft size={14} /> Back to event
      </button>

      <div className="mb-6">
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>Who's going</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          {event ? event.title : 'Event'} · {count} {count === 1 ? 'person' : 'people'}
          {canViewDetails && <span className="ml-2 rounded-full px-2 py-0.5 text-xs" style={{ background: 'rgba(255,203,60,0.16)', color: '#ffcb3c' }}>Organiser view</span>}
        </p>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>Loading attendees…</div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm" style={{ background: 'rgba(255,77,46,0.08)', border: '1px solid rgba(255,77,46,0.25)', color: '#ff9a82' }}>{error}</div>
      ) : count === 0 ? (
        <div className="py-16 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>No one has locked in yet.</div>
      ) : canViewDetails ? (
        <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
                <th className="px-4 py-3 text-left">Attendee</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Telegram / Phone</th>
              </tr>
            </thead>
            <tbody>
              {detailed!.map((a) => (
                <tr key={a.username + a.email} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={a.username} url={a.avatarUrl} size={36} />
                      <span style={{ fontWeight: 600 }}>{a.username}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <a href={`mailto:${a.email}`} className="inline-flex items-center gap-1.5 hover:underline" style={{ color: 'var(--foreground)' }}>
                      <Mail size={13} style={{ color: 'var(--muted-foreground)' }} /> {a.email}
                    </a>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--muted-foreground)' }}>
                    {a.socialLink || a.contact ? (
                      <div className="flex flex-col gap-1">
                        {a.socialLink && <span><span style={{ color: 'var(--foreground)', fontWeight: 600 }}>Telegram:</span> {a.socialLink}</span>}
                        {a.contact && <span><span style={{ color: 'var(--foreground)', fontWeight: 600 }}>Phone:</span> {a.contact}</span>}
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {basic!.map((a) => (
            <div key={a.username} className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <Avatar name={a.name || a.username} url={a.avatarUrl} size={40} />
              <span style={{ fontWeight: 600 }}>{a.username}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
