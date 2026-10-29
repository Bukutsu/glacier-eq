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
    <section className="preamp-card leg:[background:var(--panel)] leg:rounded-[var(--radius-surface)] leg:[box-shadow:none] leg:grid leg:grid-cols-[160px_minmax(0,_1fr)] leg:items-center leg:gap-[var(--space-4)] leg:p-[var(--space-3)_var(--space-4)] leg:min-h-[64px] leg:[border:1px_solid_var(--line-soft)] leg:shrink-0 leg:compact:grid-cols-[minmax(0,_1fr)_auto] leg:compact:h-[auto] leg:compact:min-h-[76px] leg:compact:p-[8px_12px] leg:compact:gap-[0_12px] leg:compact:shrink-0! leg:compact:rounded-[var(--radius-surface)]! leg:compact:[border:1px_solid_var(--line-soft)]! leg:compact:[background:var(--panel)]! leg:compact:overflow-hidden leg:compact:[.mobile-preamp-details_&]:[border:0]! leg:compact:[.mobile-preamp-details_&]:p-[0_0_var(--space-3)]! leg:compact:[.mobile-preamp-details_&]:[background:transparent]!">
      <div className="preamp-meta leg:min-w-[0] leg:flex leg:flex-col leg:gap-[var(--space-2)] leg:compact:contents">
        <strong>{t("preamp.title")}</strong>
        <div className="leg:flex leg:items-center leg:gap-[4px] leg:mt-[0] leg:compact:col-[2] leg:compact:[grid-row:1_/_span_2] leg:compact:[align-self:center]">
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
          <span className="leg:text-[color:var(--muted)] leg:[font-family:var(--font-mono)] leg:text-[length:11px] leg:select-none">dB</span>
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
