import { useState } from 'react';
import { Moon, Sun, User as UserIcon } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import type { AuthUser } from '../api';

export function Settings({
  user,
  onChangeUsername,
  theme,
  onToggleTheme,
}: {
  user: AuthUser | null;
  onChangeUsername: (name: string) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}) {
  const currentName = user?.username ?? '';
  const [newName, setNewName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [saved, setSaved] = useState(false);

  const trimmed = newName.trim();
  const canStart = trimmed.length > 0 && trimmed !== currentName;
  const canConfirm = confirmText === 'CONFIRM';

  const startConfirm = () => {
    if (!canStart) return;
    setSaved(false);
    setConfirming(true);
  };

  const applyChange = () => {
    if (!canConfirm) return;
    onChangeUsername(trimmed);
    setConfirming(false);
    setConfirmText('');
    setNewName('');
    setSaved(true);
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="mb-6" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>Settings</h1>

      {/* Change username */}
      <section className="mb-6 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="mb-4 flex items-center gap-2">
          <UserIcon size={18} />
          <h3>Username</h3>
        </div>
        <div className="mb-4 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Current username: <strong style={{ color: 'var(--foreground)' }}>{currentName || '—'}</strong>
        </div>

        <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>New username</Label>
        <Input
          value={newName}
          autoComplete="off"
          placeholder="Enter a new username"
          onChange={(e) => { setNewName(e.target.value); setConfirming(false); setConfirmText(''); setSaved(false); }}
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 44 }}
        />

        {!confirming ? (
          <Button
            onClick={startConfirm}
            disabled={!canStart}
            className="mt-4 bg-[#ff4d2e] text-white hover:bg-[#ff6647] disabled:opacity-50"
            style={{ borderRadius: 12, height: 44 }}
          >
            Change username
          </Button>
        ) : (
          <div className="mt-4 rounded-xl p-4" style={{ background: 'rgba(255,51,84,0.08)', border: '1px solid rgba(255,51,84,0.4)' }}>
            <p className="mb-2 text-sm" style={{ color: '#ff6b85', fontWeight: 600 }}>
              Type <strong>CONFIRM</strong> to change your username to "{trimmed}".
            </p>
            <Input
              value={confirmText}
              autoComplete="off"
              placeholder="CONFIRM"
              onChange={(e) => setConfirmText(e.target.value)}
              style={{ background: 'var(--surface-2)', borderColor: '#ff3354', height: 44 }}
            />
            <div className="mt-3 flex gap-2">
              <Button
                onClick={applyChange}
                disabled={!canConfirm}
                className="bg-[#ff0a0a] text-white hover:bg-[#ff2a2a] disabled:opacity-50"
                style={{ borderRadius: 12, height: 42, fontWeight: 700 }}
              >
                Confirm change
              </Button>
              <Button
                onClick={() => { setConfirming(false); setConfirmText(''); }}
                variant="outline"
                className="border-white/15 bg-transparent hover:bg-white/5"
                style={{ borderRadius: 12, height: 42 }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {saved && (
          <p className="mt-3 text-sm" style={{ color: '#29e07a', fontWeight: 600 }}>Username updated.</p>
        )}
      </section>

      {/* Appearance */}
      <section className="rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="mb-4 flex items-center gap-2">
          {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
          <h3>Appearance</h3>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div style={{ fontWeight: 600 }}>Dark mode</div>
            <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              {theme === 'dark' ? 'Dark theme is on.' : 'Light theme is on.'}
            </div>
          </div>
          <Switch checked={theme === 'dark'} onCheckedChange={onToggleTheme} />
        </div>
      </section>
    </div>
  );
}
