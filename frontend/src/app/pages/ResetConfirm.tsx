import { ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/button';
import { AuthShell } from '../components/AuthShell';
import type { Route } from '../components/types';

export function ResetConfirm({ go, email, code }: { go: (r: Route) => void; email: string; code: string }) {
  return (
    <AuthShell
      maxWidthClass="max-w-xl"
      title="Code verified"
      subtitle="Your identity is confirmed. Continue to set a new password for your account."
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-xl p-4" style={{ background: 'rgba(41,224,122,0.08)', border: '1px solid rgba(41,224,122,0.25)' }}>
          <ShieldCheck size={20} style={{ color: 'var(--status-green)' }} />
          <span className="text-sm" style={{ color: 'var(--status-green)' }}>You can now reset your password.</span>
        </div>
        <Button onClick={() => go({ name: 'reset-password', email, code })} className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
          Confirm
        </Button>
      </div>
    </AuthShell>
  );
}
