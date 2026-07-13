

export function Preamp({
  value,
  resetValue,
  integerMode = false,
  onChange,
  onStartChange,
}: {
  value: number;
  resetValue?: number;
  integerMode?: boolean;
  onChange: (value: number) => void;
  onStartChange: () => void;
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const step = integerMode ? 1 : 0.05;
  const precision = integerMode ? 0 : 2;
  const displayValue = integerMode ? Math.round(safeValue) : safeValue;

  const handleValueChange = (val: number) => {
    onChange(integerMode ? Math.round(val) : val);
  };

  return (
    <section className="preamp-card">
      <div className="preamp-meta">
        <strong>Preamp</strong>
        <div className="preamp-value-row">
          <input
            type="number"
            value={displayValue.toFixed(precision)}
            min={-16}
            max={6}
            step={step}
            onFocus={onStartChange}
            onChange={(e) => handleValueChange(+e.target.value)}
            className="preamp-value-stepper"
          />
          <span className="preamp-unit">dB</span>
        </div>
      </div>
      <input
        type="range"
        className="control-slider-input"
        style={{ "--slider-thumb": "var(--blue)" } as any}
        aria-label="Preamp gain"
        min={-16}
        max={6}
        step={step}
        value={displayValue}
        onPointerDown={onStartChange}
        onKeyDown={(e) => {
          if (!e.repeat && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) onStartChange();
        }}
        onDoubleClick={resetValue === undefined ? undefined : () => handleValueChange(resetValue)}
        onChange={(event) => handleValueChange(+event.target.value)}
      />
    </section>
  );
}
