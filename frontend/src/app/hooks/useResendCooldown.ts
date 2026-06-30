import { useEffect, useState } from 'react';

// Countdown for "resend code" buttons. start() begins a `seconds`-long cooldown;
// `remaining` ticks down to 0 once per second. While remaining > 0 the button stays disabled.
export function useResendCooldown(seconds = 30) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => (r <= 1 ? 0 : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  const start = () => setRemaining(seconds);
  return { remaining, start };
}
