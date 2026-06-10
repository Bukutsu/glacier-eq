export function Preamp({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return (
    <section className="preamp-card">
      <strong>PREAMP: {safeValue} dB</strong>
      <input
        type="range"
        min={-16}
        max={6}
        step={1}
        value={safeValue}
        onChange={(event) => onChange(+event.target.value)}
      />
    </section>
  );
}
