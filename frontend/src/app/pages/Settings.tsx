import { useEffect, useRef, useState } from 'react';
import { Moon, Sun, User as UserIcon, Image as ImageIcon, Trash2, AlertTriangle, ChevronLeft, AtSign, Award, Download, GraduationCap, Lock } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { DeleteEventModal } from '../components/DeleteEventModal';
import { PRESET_AVATARS } from '../components/media';
import { UNIVERSITIES, universityLabel } from '../components/universities';
import type { Route } from '../components/types';
import { uploadAvatar, removeAvatar, setAvatar, updateUsernameRequest, updateContactRequest, changeUniversityRequest, fetchLicense, openLicensePdf, type AdminLicense, type AuthUser } from '../api';

// Sentinel for the "I'm not enrolled into a university" option (stored as NULL).

export function Settings({
  user,
  go,
  onChangeUsername,
  onChangeAvatar,
  onChangeContact,
  onChangeUniversity,
  onDeleteAccount,
  theme,
  onToggleTheme,
}: {
  user: AuthUser | null;
  go: (r: Route) => void;
  onChangeUsername: (name: string) => void;
  onChangeAvatar: (url: string | null) => void;
  onChangeContact: (telegram: string | null, phone: string | null) => void;
  onChangeUniversity: (university: string | null) => void;
  onDeleteAccount: () => Promise<void>;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}) {
  const currentName = user?.username ?? '';
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      onChangeAvatar(await uploadAvatar(file));
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Unable to upload picture.');
    } finally {
      setAvatarBusy(false);
    }
  };

  const handlePreset = async (url: string) => {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      onChangeAvatar(await setAvatar(url));
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Unable to set avatar.');
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleAvatarRemove = async () => {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      await removeAvatar();
      onChangeAvatar(null);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Unable to remove picture.');
    } finally {
      setAvatarBusy(false);
    }
  };

  // Username change
  const [newName, setNewName] = useState('');
  const [usernameModal, setUsernameModal] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const trimmed = newName.trim();
  const canStart = trimmed.length > 0 && trimmed !== currentName;

  const applyUsername = async () => {
    setUsernameError(null);
    try {
      await updateUsernameRequest(trimmed);
      onChangeUsername(trimmed);
      setNewName('');
      setSaved(true);
    } catch (err) {
      setUsernameError(err instanceof Error ? err.message : 'Unable to change username.');
    }
  };

  // Contact details (Telegram → socialLink, Phone → contact)
  const [telegram, setTelegram] = useState(user?.telegram ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [contactSaved, setContactSaved] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactBusy, setContactBusy] = useState(false);
  const contactChanged = telegram.trim() !== (user?.telegram ?? '').trim() || phone.trim() !== (user?.phone ?? '').trim();

  const applyContact = async () => {
    setContactError(null);
    setContactBusy(true);
    try {
      await updateContactRequest(telegram, phone);
      onChangeContact(telegram.trim() || null, phone.trim() || null);
      setContactSaved(true);
    } catch (err) {
      setContactError(err instanceof Error ? err.message : 'Unable to save contact details.');
    } finally {
      setContactBusy(false);
    }
  };

  // University (one-time change, attendees only)
  const canChangeUniversity = user?.role === 'user';
  const universityUsed = !!user?.universityChanged;
  const currentUni = user?.university ?? null;
  const [uniChoice, setUniChoice] = useState<string>(currentUni ?? '');
  const [uniModal, setUniModal] = useState(false);
  const [uniError, setUniError] = useState<string | null>(null);
  const [uniSaved, setUniSaved] = useState(false);
  const [uniBusy, setUniBusy] = useState(false);
  // Students only — "not enrolled" is no longer a choice, so a blank pick is a no-op.
  const uniTarget = uniChoice || null;
  const uniDirty = uniTarget !== currentUni;

  const applyUniversity = async () => {
    setUniError(null);
    setUniBusy(true);
    try {
      await changeUniversityRequest(uniTarget);
      onChangeUniversity(uniTarget);
      setUniSaved(true);
    } catch (err) {
      setUniError(err instanceof Error ? err.message : 'Unable to change university.');
    } finally {
      setUniBusy(false);
    }
  };

  // Admin license
  const isAdmin = user?.role === 'admin';
  const [license, setLicense] = useState<AdminLicense | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    fetchLicense().then(setLicense).catch(() => setLicense(null));
  }, [isAdmin]);

  // Delete account
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const applyDelete = async () => {
    setDeleteError(null);
    try {
      await onDeleteAccount();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete account.');
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <button
        onClick={() => go({ name: 'landing' })}
        className="mb-4 inline-flex items-center gap-1 text-sm transition hover:text-foreground"
        style={{ color: 'var(--muted-foreground)' }}
      >
        <ChevronLeft size={14} /> Back to Events
      </button>
      <h1 className="mb-6" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>Settings</h1>

      {/* Profile picture */}
      <section className="mb-6 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="mb-4 flex items-center gap-2">
          <ImageIcon size={18} />
          <h3>Profile picture</h3>
        </div>
        <div className="flex items-center gap-5">
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="Your avatar" referrerPolicy="no-referrer" className="size-20 rounded-full object-cover" style={{ border: '2px solid var(--border)' }} />
          ) : (
            <div className="grid size-20 place-items-center rounded-full text-white" style={{ background: '#ff4d2e', fontSize: 32, fontWeight: 600 }}>
              {(currentName || '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
            <div className="flex gap-2">
              <Button
                onClick={() => fileRef.current?.click()}
                disabled={avatarBusy}
                className="bg-[#ff4d2e] text-white hover:bg-[#ff6647] disabled:opacity-50"
                style={{ borderRadius: 12, height: 40 }}
              >
                {avatarBusy ? 'Working…' : user?.avatarUrl ? 'Replace' : 'Upload'}
              </Button>
              {user?.avatarUrl && (
                <Button
                  onClick={handleAvatarRemove}
                  disabled={avatarBusy}
                  variant="outline"
                  className="border-white/15 bg-transparent hover:bg-white/5 disabled:opacity-50"
                  style={{ borderRadius: 12, height: 40 }}
                >
                  <Trash2 size={15} className="mr-1.5" /> Remove
                </Button>
              )}
            </div>
            <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>PNG, JPG or GIF. Square images look best.</p>
            {avatarError && <p className="text-xs" style={{ color: '#ff9a82' }}>{avatarError}</p>}
          </div>
        </div>

        {/* Preset avatars */}
        <div className="mt-5">
          <Label className="mb-2 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Or pick an avatar</Label>
          <div className="flex flex-wrap gap-3">
            {PRESET_AVATARS.map((url) => {
              const selected = user?.avatarUrl === url;
              return (
                <button
                  key={url}
                  onClick={() => handlePreset(url)}
                  disabled={avatarBusy}
                  className="overflow-hidden rounded-full transition hover:scale-105 disabled:opacity-50"
                  style={{ border: selected ? '2px solid #ff4d2e' : '2px solid transparent' }}
                >
                  <img src={url} alt="Avatar option" className="size-12 object-cover" />
                </button>
              );
            })}
          </div>
        </div>
      </section>

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
          onChange={(e) => { setNewName(e.target.value); setSaved(false); setUsernameError(null); }}
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 44 }}
        />

        <Button
          onClick={() => setUsernameModal(true)}
          disabled={!canStart}
          className="mt-4 bg-[#ff4d2e] text-white hover:bg-[#ff6647] disabled:opacity-50"
          style={{ borderRadius: 12, height: 44 }}
        >
          Change username
        </Button>

        {usernameError && <p className="mt-3 text-sm" style={{ color: '#ff9a82' }}>{usernameError}</p>}
        {saved && <p className="mt-3 text-sm" style={{ color: '#29e07a', fontWeight: 600 }}>Username updated.</p>}
      </section>

      {/* Admin license (admins only) */}
      {isAdmin && (
        <section className="mb-6 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="mb-4 flex items-center gap-2">
            <Award size={18} style={{ color: '#ff4d2e' }} />
            <h3>Administrator license</h3>
          </div>
          <div className="rounded-xl border p-6 text-center" style={{ borderColor: '#ff4d2e', background: 'var(--surface-2)' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#ff4d2e' }}>party.fun</div>
            <div className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>Certificate of Administration</div>
            <div className="mt-4" style={{ fontSize: 20, fontWeight: 700 }}>{license?.username ?? currentName}</div>
            <div className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>Licensed Administrator of party.fun</div>
            <div className="mt-4 space-y-0.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
              <div>License ID: <strong style={{ color: 'var(--foreground)' }}>{license?.licenseId ?? '—'}</strong></div>
              <div>Issued: {license?.issued ?? '—'}</div>
              <div>{license?.validity ?? ''}</div>
            </div>
          </div>
          <Button
            onClick={() => openLicensePdf().catch(() => {})}
            className="mt-4 gap-2 bg-[#ff4d2e] text-white hover:bg-[#ff6647]"
            style={{ borderRadius: 12, height: 44 }}
          >
            <Download size={15} /> Export as PDF
          </Button>
        </section>
      )}

      {/* Contact details */}
      {!isAdmin && (
      <section className="mb-6 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="mb-4 flex items-center gap-2">
          <AtSign size={18} />
          <h3>Contact details</h3>
        </div>
        <p className="mb-4 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Shown on your profile and shared with organisers of events you join. Both are optional.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Telegram</Label>
            <Input
              value={telegram}
              autoComplete="off"
              placeholder="@yourhandle"
              onChange={(e) => { setTelegram(e.target.value); setContactSaved(false); setContactError(null); }}
              style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 44 }}
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Phone number</Label>
            <Input
              value={phone}
              autoComplete="off"
              placeholder="e.g. +65 9123 4567"
              onChange={(e) => { setPhone(e.target.value); setContactSaved(false); setContactError(null); }}
              style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 44 }}
            />
          </div>
        </div>

        <Button
          onClick={applyContact}
          disabled={!contactChanged || contactBusy}
          className="mt-4 bg-[#ff4d2e] text-white hover:bg-[#ff6647] disabled:opacity-50"
          style={{ borderRadius: 12, height: 44 }}
        >
          {contactBusy ? 'Saving…' : 'Save contact details'}
        </Button>

        {contactError && <p className="mt-3 text-sm" style={{ color: '#ff9a82' }}>{contactError}</p>}
        {contactSaved && <p className="mt-3 text-sm" style={{ color: '#29e07a', fontWeight: 600 }}>Contact details updated.</p>}
      </section>
      )}

      {/* University (attendees only, one-time change) */}
      {canChangeUniversity && (
      <section className="mb-6 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="mb-4 flex items-center gap-2">
          <GraduationCap size={18} />
          <h3>University</h3>
        </div>
        <p className="mb-4 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Determines which university-restricted events you can join. You can change this <strong>once only</strong>.
        </p>

        {universityUsed ? (
          <div className="flex items-center gap-2 rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
            <Lock size={15} style={{ color: 'var(--muted-foreground)' }} />
            <span>
              <strong>{currentUni ? universityLabel(currentUni) : 'Not enrolled into a university'}</strong>
              <span style={{ color: 'var(--muted-foreground)' }}> — you've used your one-time change.</span>
            </span>
          </div>
        ) : (
          <>
            <Select value={uniChoice} onValueChange={(v) => { setUniChoice(v); setUniSaved(false); setUniError(null); }}>
              <SelectTrigger style={{ background: 'var(--surface-2)', height: 44 }}><SelectValue placeholder="Select your university" /></SelectTrigger>
              <SelectContent>
                {UNIVERSITIES.map((u) => <SelectItem key={u.code} value={u.code}>{universityLabel(u.code)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              onClick={() => setUniModal(true)}
              disabled={!uniDirty || uniBusy}
              className="mt-4 bg-[#ff4d2e] text-white hover:bg-[#ff6647] disabled:opacity-50"
              style={{ borderRadius: 12, height: 44 }}
            >
              {uniBusy ? 'Saving…' : 'Change university'}
            </Button>
          </>
        )}

        {uniError && <p className="mt-3 text-sm" style={{ color: '#ff9a82' }}>{uniError}</p>}
        {uniSaved && <p className="mt-3 text-sm" style={{ color: '#29e07a', fontWeight: 600 }}>University updated.</p>}
      </section>
      )}

      {/* Appearance */}
      <section className="mb-6 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
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

      {/* Danger zone */}
      {!isAdmin && (
      <section className="rounded-2xl border p-6" style={{ borderColor: 'rgba(255,51,84,0.35)', background: 'var(--surface)' }}>
        <div className="mb-4 flex items-center gap-2" style={{ color: '#ff6b85' }}>
          <AlertTriangle size={18} />
          <h3 style={{ color: '#ff6b85' }}>Danger zone</h3>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Permanently delete your account and all of your data.
          </p>
          <Button
            onClick={() => { setDeleteError(null); setDeleteModal(true); }}
            className="bg-[#ff3354] text-white hover:bg-[#ff4865]"
            style={{ borderRadius: 12, height: 44 }}
          >
            Delete account
          </Button>
        </div>
        {deleteError && <p className="mt-3 text-sm" style={{ color: '#ff9a82' }}>{deleteError}</p>}
      </section>
      )}

      {usernameModal && (
        <DeleteEventModal
          title="Change username?"
          leadIn="You're about to change your username to"
          eventName={trimmed}
          warning="Your current username will be released and can be claimed by others."
          actionLabel="Confirm change"
          confirmWord="CONFIRM"
          onCancel={() => setUsernameModal(false)}
          onConfirm={() => { setUsernameModal(false); applyUsername(); }}
        />
      )}

      {uniModal && (
        <DeleteEventModal
          title="Change university?"
          leadIn="You're about to set your university to"
          eventName={uniTarget ? universityLabel(uniTarget) : 'Not enrolled into a university'}
          warning="You can only change your university once. After this you won't be able to change it again."
          actionLabel="Confirm change"
          confirmWord="CONFIRM"
          onCancel={() => setUniModal(false)}
          onConfirm={() => { setUniModal(false); applyUniversity(); }}
        />
      )}

      {deleteModal && (
        <DeleteEventModal
          title="Delete account?"
          leadIn="You're about to permanently delete"
          eventName={currentName || 'your account'}
          warning="This permanently removes your account and all of your data. This cannot be undone."
          actionLabel="Delete account"
          confirmWord="CONFIRM"
          onCancel={() => setDeleteModal(false)}
          onConfirm={() => { setDeleteModal(false); applyDelete(); }}
        />
      )}
    </div>
  );
}
