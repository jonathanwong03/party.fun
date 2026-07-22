import { useEffect, useMemo, useState } from 'react';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Convert a 12-hour clock hour + meridiem to 24-hour.
function to24(hour: number, meridiem: string) {
  const h = hour % 12;
  return /pm/i.test(meridiem) ? h + 12 : h;
}

// Parse a deadline string into its target Date. Handles two formats:
//   "10/06/2025, 11:59 PM"  (DD/MM/YYYY, HH:MM AM/PM)
//   "Jun 10, 11:59 PM"      (legacy, no year → current year, rolled forward if already past)
function parse(deadline: string): Date | null {
  const s = deadline.trim();

  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(s);
  if (m) {
    return new Date(+m[3], +m[2] - 1, +m[1], to24(+m[4], m[6]), +m[5], 0, 0);
  }

  m = /^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (month >= 0) {
      const now = new Date();
      const build = (year: number) =>
        new Date(year, month, +m![2], to24(+m![3], m![5]), +m![4], 0, 0);
      let d = build(now.getFullYear());
      if (d.getTime() < now.getTime()) d = build(now.getFullYear() + 1);
      return d;
    }
  }

  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function Countdown({ deadline, targetIso, color = 'var(--status-amber)' }: { deadline?: string; targetIso?: string; color?: string }) {
  const target = useMemo(() => {
    // Prefer a raw ISO timestamp (robust, timezone-correct); fall back to parsing a display string.
    if (targetIso) {
      const d = new Date(targetIso);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return deadline ? parse(deadline) : null;
  }, [targetIso, deadline]);
  const [diff, setDiff] = useState(0);

  useEffect(() => {
    if (!target) {
      setDiff(0);
      return;
    }
    const tick = () => setDiff(Math.max(0, target.getTime() - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  const totalSecs = Math.floor(diff / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  const segments = [
    { label: 'DD', value: pad(days) },
    { label: 'HH', value: pad(hours) },
    { label: 'MM', value: pad(mins) },
    { label: 'SS', value: pad(secs) },
  ];

  return (
    <div className="flex items-end gap-2">
      {segments.map(({ label, value }, i) => (
        <div key={label} className="flex items-end gap-2">
          <div className="flex flex-col items-center">
            <div
              className="tabular-nums rounded-lg px-3 py-2 text-center"
              style={{
                fontWeight: 800,
                fontSize: 22,
                fontVariantNumeric: 'tabular-nums',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border)',
                color,
                minWidth: 52,
                letterSpacing: '0.02em',
              }}
            >
              {value}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-widest" style={{ color: 'var(--muted-foreground)' }}>
              {label}
            </div>
          </div>
          {i < segments.length - 1 && (
            <div className="mb-5 text-lg" style={{ color, opacity: 0.4, fontWeight: 700 }}>:</div>
          )}
        </div>
      ))}
    </div>
  );
}
