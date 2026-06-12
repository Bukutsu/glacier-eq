import { Slider } from "./Slider";
import { NumberInput } from "./NumberInput";

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
        <div className="preamp-value-row">
          <NumberInput
            value={safeValue}
            min={-16}
            max={6}
            step={0.5}
            precision={1}
            onFocus={onStartChange}
            onChange={onChange}
            className="preamp-value-stepper"
          />
          <span className="preamp-unit">dB</span>
        </div>
      </div>
      <Slider
        aria-label="Preamp gain"
        min={-16}
        max={6}
        step={0.5}
        value={safeValue}
        onMouseDown={onStartChange}
        onTouchStart={onStartChange}
        onChange={(event) => onChange(+event.target.value)}
      />
    </section>
  );
}
