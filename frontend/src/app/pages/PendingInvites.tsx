import { useEffect, useMemo, useState } from 'react';
import { Check, X, UserPlus, Clock3 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { acceptCoOrganiserInviteRequest, declineCoOrganiserInviteRequest, fetchCoOrganiserInvites, type CoOrganiserInvite } from '../api';
import type { Route } from '../components/types';

export function PendingInvites({ go, onChanged }: { go: (r: Route) => void; onChanged: () => Promise<void> }) {
  const [invites, setInvites] = useState<CoOrganiserInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setInvites(await fetchCoOrganiserInvites());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load co-organiser invites.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const incoming = useMemo(() => invites.filter((i) => i.direction === 'incoming' && i.status === 'pending'), [invites]);
  const history = useMemo(() => invites.filter((i) => i.direction === 'outgoing' || i.status !== 'pending'), [invites]);

  const respond = async (inviteId: string, action: 'accept' | 'decline') => {
    setBusyId(inviteId);
    setError(null);
    try {
      if (action === 'accept') await acceptCoOrganiserInviteRequest(inviteId);
      else await declineCoOrganiserInviteRequest(inviteId);
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to respond to invite.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="mx-auto max-w-[1100px] px-6 py-8">
      <div className="mb-8">
        <h1 className="flex items-center gap-2" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' }}>
          <UserPlus size={26} style={{ color: '#ff4d2e' }} /> Pending invites
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Accept an invite to edit event details, view attendees, and check in tickets.
        </p>
      </div>

      {error && (
        <div className="mb-5 rounded-xl p-4 text-sm" style={{ background: 'rgba(255,77,46,0.08)', border: '1px solid rgba(255,77,46,0.25)', color: '#ff9a82' }}>
          {error}
        </div>
      )}

      <section className="mb-8 rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800 }}>Incoming invites</h2>
        </div>
        {loading ? (
          <Empty text="Loading invites..." />
        ) : incoming.length === 0 ? (
          <Empty text="No pending invites right now." />
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {incoming.map((invite) => (
              <InviteRow
                key={invite.id}
                invite={invite}
                action={
                  <div className="flex gap-2">
                    <Button disabled={busyId === invite.id} onClick={() => respond(invite.id, 'accept')} className="gap-2 bg-[#29e07a] text-black hover:bg-[#5cf09a]" style={{ borderRadius: 12 }}>
                      <Check size={15} /> Accept
                    </Button>
                    <Button disabled={busyId === invite.id} onClick={() => respond(invite.id, 'decline')} variant="outline" className="gap-2" style={{ borderRadius: 12 }}>
                      <X size={15} /> Decline
                    </Button>
                  </div>
                }
                go={go}
              />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800 }}>Invite history</h2>
        </div>
        {loading ? (
          <Empty text="Loading history..." />
        ) : history.length === 0 ? (
          <Empty text="No sent or completed invites yet." />
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {history.map((invite) => (
              <InviteRow
                key={invite.id}
                invite={invite}
                action={<StatusPill status={invite.status} />}
                go={go}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function InviteRow({ invite, action, go }: { invite: CoOrganiserInvite; action: React.ReactNode; go: (r: Route) => void }) {
  const counterpart = invite.direction === 'incoming' ? invite.ownerUsername : invite.inviteeUsername;
  const label = invite.direction === 'incoming' ? 'Invited by' : 'Invited';
  return (
    <div className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between">
      <div>
        <button type="button" onClick={() => go({ name: 'event', id: invite.eventId, fromOrganiser: invite.status === 'accepted' })} className="text-left hover:underline" style={{ fontWeight: 800 }}>
          {invite.eventTitle}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--muted-foreground)' }}>
          <span>{label}: {counterpart}</span>
          <span className="inline-flex items-center gap-1"><Clock3 size={12} /> {new Date(invite.invitedAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
      </div>
      {action}
    </div>
  );
}

function StatusPill({ status }: { status: CoOrganiserInvite['status'] }) {
  const styles: Record<CoOrganiserInvite['status'], React.CSSProperties> = {
    pending: { background: 'rgba(255,203,60,0.16)', color: '#ffcb3c' },
    accepted: { background: 'rgba(41,224,122,0.14)', color: '#29e07a' },
    declined: { background: 'rgba(255,77,46,0.14)', color: '#ff8a70' },
    revoked: { background: 'rgba(255,255,255,0.06)', color: 'var(--muted-foreground)' },
  };
  return <span className="rounded-full px-3 py-1 text-xs capitalize" style={{ ...styles[status], fontWeight: 700 }}>{status}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="px-5 py-12 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>{text}</div>;
}
