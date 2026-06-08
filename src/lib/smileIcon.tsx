// Brand smile icon as JSX for next/og ImageResponse (favicon, apple-touch, PWA icons).
// Blue full-bleed square (no white corners) + cream ring + smile.
export function smileEl(size: number) {
  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', background: '#7dadd4' }}>
      <svg width={Math.round(size * 0.78)} height={Math.round(size * 0.78)} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="37" stroke="#f7eddb" strokeWidth="9" />
        <path d="M34 52 Q50 70 66 52" stroke="#f7eddb" strokeWidth="9" strokeLinecap="round" />
      </svg>
    </div>
  );
}
