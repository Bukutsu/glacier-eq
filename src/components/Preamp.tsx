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
  const clamped = Math.max(-16, Math.min(6, safeValue));
  return (
    <section className="preamp-card">
      <div className="preamp-meta">
        <strong>Preamp</strong>
        <input
          className="num-input preamp-value"
          type="text"
          inputMode="decimal"
          aria-label="Preamp gain value"
          value={`${clamped}`}
          onFocus={onStartChange}
          onChange={(event) => {
            const parsed = parseFloat(event.target.value);
            if (!Number.isNaN(parsed)) {
              onChange(Math.max(-16, Math.min(6, parsed)));
            }
          }}
        />
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
