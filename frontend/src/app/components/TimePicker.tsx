import { useState } from 'react';
import { Clock } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

// A time field that shows hour / minute / AM-PM columns on click. Value/onChange are "H:MM AM/PM".
function parseTime(v: string) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(v.trim());
  if (!m) return null;
  return { hour: +m[1], minute: +m[2], ampm: m[3].toUpperCase() as 'AM' | 'PM' };
}

function Column<T extends string | number>({
  items,
  selected,
  fmt,
  onSelect,
}: {
  items: T[];
  selected: T | null;
  fmt: (v: T) => string;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="flex max-h-[180px] flex-col gap-0.5 overflow-y-auto px-1">
      {items.map((it) => {
        const active = it === selected;
        return (
          <button
            key={String(it)}
            type="button"
            onClick={() => onSelect(it)}
            className="rounded-md px-3 py-1.5 text-sm transition hover:bg-white/5"
            style={{ background: active ? '#ff4d2e' : 'transparent', color: active ? '#fff' : 'var(--foreground)', fontWeight: active ? 700 : 400 }}
          >
            {fmt(it)}
          </button>
        );
      })}
    </div>
  );
}

export function TimePicker({
  value,
  onChange,
  placeholder = 'Select time',
  error,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cur = value ? parseTime(value) : null;
  const hour = cur?.hour ?? null;
  const minute = cur?.minute ?? null;
  const ampm = cur?.ampm ?? null;

  const set = (h: number | null, m: number | null, ap: 'AM' | 'PM' | null) =>
    onChange(`${h ?? 12}:${String(m ?? 0).padStart(2, '0')} ${ap ?? 'PM'}`);

  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="flex h-[42px] w-full items-center gap-2 rounded-md border px-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--surface-2)', borderColor: error ? '#ff4d2e' : 'var(--border)' }}
        >
          <Clock size={15} style={{ color: 'var(--muted-foreground)' }} />
          <span style={{ color: value ? 'var(--foreground)' : 'var(--muted-foreground)' }}>{value || placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="flex gap-1">
          <Column items={hours} selected={hour} fmt={(n) => String(n)} onSelect={(h) => set(h, minute, ampm)} />
          <Column items={minutes} selected={minute} fmt={(n) => String(n).padStart(2, '0')} onSelect={(m) => set(hour, m, ampm)} />
          <Column items={['AM', 'PM'] as const} selected={ampm} fmt={(s) => s} onSelect={(ap) => set(hour, minute, ap)} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
