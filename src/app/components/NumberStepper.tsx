import { Minus, Plus } from 'lucide-react';

export function NumberStepper({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const clamp = (n: number) => {
    if (Number.isNaN(n)) return min;
    if (typeof min === 'number' && n < min) return min;
    if (typeof max === 'number' && n > max) return max;
    return n;
  };

  return (
    <div
      className="flex items-center justify-center gap-3 rounded-md bg-black px-3"
      style={{ height: 42, opacity: disabled ? 0.5 : 1 }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(clamp(value - step))}
        aria-label="Decrease"
        className="grid size-6 place-items-center rounded-[5px] disabled:cursor-not-allowed"
        style={{ color: '#ffffff' }}
      >
        <Minus size={14} strokeWidth={2} />
      </button>
      <input
        type="number"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clamp(+e.target.value))}
        className="w-full min-w-0 flex-1 bg-transparent text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        style={{ color: '#fff' }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(clamp(value + step))}
        aria-label="Increase"
        className="grid size-6 place-items-center rounded-[5px] disabled:cursor-not-allowed"
        style={{ color: '#ffffff' }}
      >
        <Plus size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
