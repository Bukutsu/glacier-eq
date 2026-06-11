import { Slider } from "./Slider";

export function Preamp({
  value,
  onChange,
  onStartChange,
}: {
  value: number;
  onChange: (value: number) => void;
  onStartChange: () => void;
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return (
    <section className="preamp-card">
      <div className="preamp-meta">
        <strong>Preamp</strong>
        <span>{safeValue} dB</span>
      </div>
      <Slider
        aria-label="Preamp gain"
        min={-16}
        max={6}
        step={1}
        value={safeValue}
        onMouseDown={onStartChange}
        onTouchStart={onStartChange}
        onChange={(event) => onChange(+event.target.value)}
      />
    </section>
  );
}
