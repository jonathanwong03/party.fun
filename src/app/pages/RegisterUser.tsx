import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthShell } from '../components/AuthShell';
import type { Role, Route } from '../components/types';

export function RegisterUser({ go, onLogin }: { go: (r: Route) => void; onLogin: (r: Role) => void }) {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Track your tickets, get hype updates and refunds in one place."
      footer={
        <>
          Already have an account?{' '}
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
          onLogin('user');
        }}
      >
        <Field label="Username" placeholder="jamiet" />
        <Field label="Email" type="email" placeholder="you@u.nus.edu" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password" type="password" placeholder="********" />
          <Field label="Confirm" type="password" placeholder="********" />
        </div>
        <Field label="Phone / Telegram (optional)" placeholder="@jamiet" />

        <Button type="submit" className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
          Create account
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
