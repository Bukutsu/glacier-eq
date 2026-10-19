import { useTranslation } from "react-i18next";
import { useRef } from "react";
import { Slider } from "@/components/ui/Slider";
import { NumberInput } from "@/components/ui/NumberInput";

export function Preamp({
  value,
  resetValue,
  range,
  integerMode,
  onChange,
  onStartChange,
  onEndChange,
  disabled = false,
}: {
  value: number;
  resetValue?: number;
  range: [number, number];
  integerMode: boolean;
  onChange: (value: number) => void;
  onStartChange: () => void;
  onEndChange?: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("editor");
  const [min, max] = range;
  const safeValue = Math.max(
    min,
    Math.min(max, Number.isFinite(value) ? value : 0),
  );
  const step = integerMode ? 1 : 0.05;
  const precision = integerMode ? 0 : 2;
  const displayValue = integerMode ? Math.round(safeValue) : safeValue;
  const gestureValue = useRef(displayValue);
  const startSliderChange = () => {
    // Native range sanitization can round values to its step before pointerdown.
    gestureValue.current = displayValue;
    onStartChange();
  };

  const handleValueChange = (val: number) => {
    const constrained = Math.max(min, Math.min(max, val));
    onChange(integerMode ? Math.round(constrained) : constrained);
  };

  return (
    <section className="preamp-card">
      <div className="preamp-meta">
        <strong>{t("preamp.title")}</strong>
        <div className="preamp-value-row">
          <NumberInput
            value={displayValue}
            min={min}
            max={max}
            step={step}
            precision={precision}
            onFocus={onStartChange}
            onBlur={onEndChange}
            onChange={handleValueChange}
            disabled={disabled}
            className="preamp-value-stepper"
            aria-label={t("preamp.gain")}
          />
          <span className="preamp-unit">dB</span>
        </div>
      </div>
      <Slider
        aria-label={t("preamp.gain")}
        min={min}
        max={max}
        step={step}
        value={displayValue}
        aria-valuetext={`${displayValue >= 0 ? "+" : ""}${displayValue.toFixed(precision)} dB`}
        onStartChange={startSliderChange}
        onEndChange={onEndChange}
        onCancelChange={() => handleValueChange(gestureValue.current)}
        disabled={disabled}
        onReset={
          resetValue === undefined
            ? undefined
            : () => handleValueChange(resetValue)
        }
        onChange={(event) => handleValueChange(+event.target.value)}
      />
    </section>
  );
}
