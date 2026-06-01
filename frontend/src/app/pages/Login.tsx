import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthShell } from '../components/AuthShell';
import type { Role, Route } from '../components/types';

export function Login({ go, onLogin }: { go: (r: Route) => void; onLogin: (role: Role) => void }) {
  return (
    <AuthShell
      maxWidthClass="max-w-xl"
      title="Welcome back"
      subtitle="Sign in to track your tickets and manage your events."
      footer={
        <>
          New to party.fun?{' '}
          <button onClick={() => go({ name: 'choose-account' })} className="text-[#ff4d2e]" style={{ fontWeight: 600 }}>
            Create an account
          </button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value;
          const nextRole = email.toLowerCase().includes('admin') ? 'admin' : 'user';
          onLogin(nextRole);
        }}
      >
        <div>
          <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Email or username</Label>
          <Input name="email" defaultValue="jamie@u.nus.edu" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 44 }} />
          <p className="mt-1 text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
            Tip: emails containing "admin" log in as an organiser.
          </p>
        </div>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <Label className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Password</Label>
            <button type="button" className="text-xs text-[#ff4d2e]">Forgot?</button>
          </div>
          <Input name="password" type="password" defaultValue="••••••••" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 44 }} />
        </div>
        <Button type="submit" className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
          Login
        </Button>
      </form>
    </AuthShell>
  );
}
