export function Logo({ size = 28 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="grid place-items-center rounded-lg"
        style={{
          width: size,
          height: size,
          background: 'linear-gradient(135deg, #ff4d2e 0%, #ffcb3c 100%)',
        }}
      >
        <span className="text-black" style={{ fontWeight: 800, fontSize: size * 0.55 }}>
          p
        </span>
      </div>
      <span
        style={{
          fontFamily: 'Space Grotesk, Inter, sans-serif',
          fontWeight: 700,
          fontSize: 18,
          letterSpacing: '-0.02em',
        }}
      >
        party<span className="text-[#ff4d2e]">.fun</span>
      </span>
    </div>
  );
}
