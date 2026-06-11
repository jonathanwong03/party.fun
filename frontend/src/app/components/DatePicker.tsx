import { useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { format, parse, isValid } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';

// A date field that shows a calendar menu on click. Value/onChange are DD/MM/YYYY strings.
export function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
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
  const parsed = value ? parse(value, 'dd/MM/yyyy', new Date()) : undefined;
  const selected = parsed && isValid(parsed) ? parsed : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="flex h-[42px] w-full items-center gap-2 rounded-md border px-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--surface-2)', borderColor: error ? '#ff4d2e' : 'var(--border)' }}
        >
          <CalendarIcon size={15} style={{ color: 'var(--muted-foreground)' }} />
          <span style={{ color: value ? 'var(--foreground)' : 'var(--muted-foreground)' }}>{value || placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (d) {
              onChange(format(d, 'dd/MM/yyyy'));
              setOpen(false);
            }
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
