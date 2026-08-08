import { Slider } from "./Slider";
import { NumberInput } from "./NumberInput";

export function Preamp({
  value,
  resetValue,
  range,
  integerMode,
  onChange,
  onStartChange,
}: {
  value: number;
  resetValue?: number;
  range: [number, number];
  integerMode: boolean;
  onChange: (value: number) => void;
  onStartChange: () => void;
}) {
  const [min, max] = range;
  const safeValue = Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
  const step = integerMode ? 1 : 0.05;
  const precision = integerMode ? 0 : 2;
  const displayValue = integerMode ? Math.round(safeValue) : safeValue;

  const handleValueChange = (val: number) => {
    const constrained = Math.max(min, Math.min(max, val));
    onChange(integerMode ? Math.round(constrained) : constrained);
  };

  return (
    <section className="preamp-card">
      <div className="preamp-meta">
        <strong>Preamp</strong>
        <div className="preamp-value-row">
          <NumberInput
            value={displayValue}
            min={min}
            max={max}
            step={step}
            precision={precision}
            onFocus={onStartChange}
            onChange={handleValueChange}
            className="preamp-value-stepper"
          />
          <span className="preamp-unit">dB</span>
        </div>
      </div>
      <Slider
        aria-label="Preamp gain"
        min={min}
        max={max}
        step={step}
        value={displayValue}
        onStartChange={onStartChange}
        onReset={resetValue === undefined ? undefined : () => handleValueChange(resetValue)}
        onChange={(event) => handleValueChange(+event.target.value)}
      />
    </section>
  );
}
