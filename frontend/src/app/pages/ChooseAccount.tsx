import { ArrowRight, Ticket, Megaphone } from 'lucide-react';
import { AuthShell } from '../components/AuthShell';
import type { Route } from '../components/types';

export function ChooseAccount({ go }: { go: (r: Route) => void }) {
  return (
    <AuthShell
      title="Join party.fun"
      subtitle="Pick the type of account that fits you. You can always add the other later."
      footer={
        <>
          Already have an account?{' '}
          <button onClick={() => go({ name: 'login' })} className="text-[#ff4d2e]" style={{ fontWeight: 600 }}>
            Login
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Card
          icon={<Ticket size={20} />}
          accent="#ff4d2e"
          title="User"
          desc="Buy tickets, track your events, and join the hype."
          onClick={() => go({ name: 'register-user' })}
        />
        <Card
          icon={<Megaphone size={20} />}
          accent="#29e07a"
          title="Organiser"
          desc="Create, manage, and launch events for your CCA or society."
          onClick={() => go({ name: 'register-organiser' })}
        />
      </div>
    </AuthShell>
  );
}

function Card({ icon, title, desc, onClick, accent }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; accent: string }) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-2xl border p-5 text-left transition hover:-translate-y-0.5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
    >
      <div className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: `${accent}20`, color: accent }}>
        {icon}
      </div>
      <div className="flex-1">
        <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
        <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{desc}</div>
      </div>
      <ArrowRight size={16} className="transition group-hover:translate-x-1" style={{ color: accent }} />
    </button>
  );
}
