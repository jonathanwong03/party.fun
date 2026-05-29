import type { ReactNode } from 'react';
import { Logo } from './Logo';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-12">
      {/* glow */}
      <div className="pointer-events-none absolute -top-32 left-1/2 size-[680px] -translate-x-1/2 rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgba(255,77,46,0.18), transparent 70%)' }} />
      <div className="pointer-events-none absolute bottom-0 right-0 size-[420px] rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgba(41,224,122,0.10), transparent 70%)' }} />

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo size={32} />
        </div>
        <div
          className="rounded-2xl border p-8"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div className="mb-6">
            <h1>{title}</h1>
            {subtitle && (
              <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                {subtitle}
              </p>
            )}
          </div>
          {children}
        </div>
        {footer && <div className="mt-6 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>{footer}</div>}
      </div>
    </div>
  );
}
