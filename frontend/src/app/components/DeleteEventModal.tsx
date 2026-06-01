import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

export function DeleteEventModal({
  eventName,
  onCancel,
  onConfirm,
  confirmWord = 'DELETE',
  title = 'Delete Event?',
  leadIn = "You're about to delete",
  warning = 'All pledges will be voided and any captured funds refunded. Backers will be notified by email.',
  actionLabel = 'Delete Event',
}: {
  eventName: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmWord?: string;
  title?: string;
  leadIn?: string;
  warning?: string;
  actionLabel?: string;
}) {
  const [confirmText, setConfirmText] = useState('');
  const canDelete = confirmText.trim().toLowerCase() === confirmWord.toLowerCase();

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border"
        style={{ borderColor: 'var(--border-strong)', background: 'var(--surface)' }}>
        <div className="flex items-start justify-between p-5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-full" style={{ background: 'rgba(255,51,84,0.12)', color: '#ff3354' }}>
              <AlertTriangle size={18} />
            </div>
            <div>
              <h3>{title}</h3>
              <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>This action cannot be undone.</p>
            </div>
          </div>
          <button onClick={onCancel} className="rounded-full p-1 hover:bg-white/5" style={{ color: 'var(--muted-foreground)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 pb-5">
          <div className="rounded-lg p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
            <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{leadIn}</div>
            <div className="mt-1" style={{ fontWeight: 700 }}>{eventName}</div>
          </div>

          <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(255,51,84,0.08)', border: '1px solid rgba(255,51,84,0.25)', color: '#ff7a93' }}>
            {warning}
          </div>

          <div>
            <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>
              Type <span style={{ color: '#ff3354', fontWeight: 700 }}>{confirmWord}</span> to confirm
            </Label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmWord}
              style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 42 }}
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={onCancel} variant="outline" className="flex-1 border-white/15 bg-transparent hover:bg-white/5" style={{ borderRadius: 10, height: 44 }}>
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              disabled={!canDelete}
              className="flex-1 bg-[#ff3354] text-white hover:bg-[#ff4865] disabled:opacity-40"
              style={{ borderRadius: 10, height: 44 }}
            >
              {actionLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
