import { useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

// A card-expiry field (MM/YY) that shows month + year columns on click.
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

export function MonthYearPicker({
  value,
  onChange,
  placeholder = 'MM/YY',
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const m = /^(\d{1,2})\/(\d{2})$/.exec(value.trim());
  const month = m ? +m[1] : null;
  const year = m ? +m[2] : null;

  const set = (mo: number | null, yy: number | null) =>
    onChange(`${String(mo ?? 1).padStart(2, '0')}/${String(yy ?? new Date().getFullYear() % 100).padStart(2, '0')}`);

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const baseYear = new Date().getFullYear() % 100;
  const years = Array.from({ length: 13 }, (_, i) => baseYear + i);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-[42px] w-full items-center gap-2 rounded-md border px-3 text-left text-sm transition"
          style={{ background: 'var(--surface-2)', borderColor: error ? '#ff4d2e' : 'var(--border)' }}
        >
          <CalendarIcon size={15} style={{ color: 'var(--muted-foreground)' }} />
          <span style={{ color: value ? 'var(--foreground)' : 'var(--muted-foreground)' }}>{value || placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="flex gap-1">
          <Column items={months} selected={month} fmt={(n) => String(n).padStart(2, '0')} onSelect={(mo) => set(mo, year)} />
          <Column items={years} selected={year} fmt={(n) => String(n).padStart(2, '0')} onSelect={(yy) => set(month, yy)} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
