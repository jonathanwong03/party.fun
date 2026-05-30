import { Shield } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthShell } from '../components/AuthShell';
import type { Role, Route } from '../components/types';

export function RegisterAdmin({ go, onLogin }: { go: (r: Route) => void; onLogin: (r: Role) => void }) {
  return (
    <AuthShell
      title="Launch as an organiser"
      subtitle="Spin up events, set hype thresholds and run your CCA's calendar."
      footer={
        <>
          Already an organiser?{' '}
          <button onClick={() => go({ name: 'login' })} className="text-[#ff4d2e]" style={{ fontWeight: 600 }}>
            Login
          </button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onLogin('admin');
        }}
      >
        <Field label="Organisation / CCA name" placeholder="NUS Electronic Music Club" />
        <Field label="Admin name" placeholder="Jamie Tan" />
        <Field label="Email" type="email" placeholder="organiser@u.nus.edu" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password" type="password" placeholder="••••••••" />
          <Field label="Confirm" type="password" placeholder="••••••••" />
        </div>
        <Field label="Contact / Telegram" placeholder="@nus_emc" />
        <Field label="Social link (optional)" placeholder="instagram.com/nus.emc" />

        <div className="flex items-start gap-2 rounded-lg p-3 text-xs"
          style={{ background: 'rgba(41,224,122,0.08)', border: '1px solid rgba(41,224,122,0.25)', color: '#a6f3c8' }}>
          <Shield size={14} className="mt-0.5 shrink-0" />
          <span>Admins can create and manage events. We verify CCAs before greenlighting payouts.</span>
        </div>

        <Button type="submit" className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
          Create admin account
        </Button>
      </form>
    </AuthShell>
  );
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>{label}</Label>
      <Input {...props} style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 42 }} />
    </div>
  );
}
