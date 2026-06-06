import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from './ui/button';

// Lightweight Yes/No confirmation. Unlike DeleteEventModal it does not require
// typing a confirmation word — used for deleting a booking from the Joined Events tabs.
export function ConfirmDeleteModal({
  eventName,
  onCancel,
  onConfirm,
}: {
  eventName: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border-strong)', background: 'var(--surface)' }}>
        <div className="flex items-start justify-between p-5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-full" style={{ background: 'rgba(255,51,84,0.12)', color: '#ff3354' }}>
              <AlertTriangle size={18} />
            </div>
            <div>
              <h3>Are you sure you want to delete?</h3>
              <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>This action cannot be undone.</p>
            </div>
          </div>
          <button onClick={onCancel} className="rounded-full p-1 hover:bg-white/5" style={{ color: 'var(--muted-foreground)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 pb-5">
          <div className="rounded-lg p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
            <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>You're about to delete</div>
            <div className="mt-1" style={{ fontWeight: 700 }}>{eventName}</div>
          </div>

          <div className="flex gap-2">
            <Button onClick={onCancel} variant="outline" className="flex-1 border-white/15 bg-transparent hover:bg-white/5" style={{ borderRadius: 10, height: 44 }}>
              No
            </Button>
            <Button
              onClick={() => {
                setBusy(true);
                Promise.resolve(onConfirm()).finally(() => setBusy(false));
              }}
              disabled={busy}
              className="flex-1 bg-[#ff3354] text-white hover:bg-[#ff4865] disabled:opacity-40"
              style={{ borderRadius: 10, height: 44 }}
            >
              Yes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
