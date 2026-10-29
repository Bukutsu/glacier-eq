import "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "./Button";
import { parseNumericInput } from "@/lib/numericInput";
import { useToastStore } from "@/stores/toastStore";

interface NumberInputProps {
  id?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  onChange: (value: number) => void;
  /** Step from the committed value or a valid draft, e.g. along a snapped grid. */
  onStep?: (direction: 1 | -1, largeStep: boolean, value: number) => void;
  disabled?: boolean;
  className?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  "aria-label"?: string;
}

export function NumberInput({
  id,
  value,
  min = 0,
  max = 100,
  step = 1,
  precision = 0,
  onChange,
  onStep,
  disabled = false,
  className = "",
  onFocus,
  onBlur,
  "aria-label": ariaLabel,
}: NumberInputProps) {
  const { t } = useTranslation("shell");
  // Draft keeps the raw string while typing (e.g. "1." for an in-progress
  // decimal) so the field isn't reformatted on every keystroke; the value is
  // parsed/clamped and committed on blur or Enter.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    const parsed = parseNumericInput(raw);
    if (parsed !== null) {
      const clamped = Math.max(min, Math.min(max, parsed));
      onChange(Number(clamped.toFixed(precision)));
    } else {
      useToastStore.getState().setStatus(t("number.invalid"), "error");
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
  };

  const handleBlur = () => {
    if (draft !== null) commit(draft);
    setDraft(null);
    onBlur?.();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Blur owns the commit, including validation and the editing boundary.
      e.preventDefault();
      e.currentTarget.blur();
    } else if (["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(e.key)) {
      e.preventDefault();
      stepValue(
        e.key === "ArrowUp" || e.key === "PageUp" ? 1 : -1,
        e.key === "PageUp" || e.key === "PageDown",
      );
    }
  };

  const stepValue = (direction: 1 | -1, largeStep: boolean) => {
    if (disabled) return;
    const parsed = draft === null ? value : parseNumericInput(draft);
    if (parsed === null) {
      useToastStore.getState().setStatus(t("number.invalid"), "error");
      return;
    }
    const current = Number(
      Math.max(min, Math.min(max, parsed)).toFixed(precision),
    );
    onFocus?.();
    setDraft(null);
    if (onStep) {
      onStep(direction, largeStep, current);
    } else {
      const next = Math.max(
        min,
        Math.min(max, current + direction * step * (largeStep ? 10 : 1)),
      );
      onChange(Number(next.toFixed(precision)));
    }
    onBlur?.();
  };

  const displayValue = draft ?? value.toFixed(precision);

  return (
    <div
      className={`custom-number-input leg:[&.preamp-value-stepper]:w-[128px] leg:[.freq-cell_&.band-freq-stepper]:w-[100%] leg:[.gain-cell_&&.band-gain-stepper]:w-[100%] leg:[.q-cell_&&&.band-q-stepper]:w-[100%] leg:compact:[&.preamp-value-stepper]:w-[160px]! leg:compact:[&.preamp-value-stepper]:h-[48px] leg:compact:[&&.band-freq-stepper]:w-[100%] leg:compact:[&&&.band-gain-stepper]:w-[100%] leg:compact:[&&&&.band-q-stepper]:w-[100%] leg:[@media(min-width:_769px)_and_(max-width:_1150px)]:[.freq-cell_&&&&.band-freq-stepper]:w-[100%] leg:[@media(min-width:_769px)_and_(max-width:_1150px)]:[.gain-cell_&&&&&.band-gain-stepper]:w-[100%] leg:[@media(min-width:_769px)_and_(max-width:_1150px)]:[.q-cell_&&&&&&.band-q-stepper]:w-[100%] cmp:[--number-step-size:34px] cmp:flex cmp:items-center cmp:box-border cmp:min-w-[0] cmp:h-[40px] cmp:p-[2px] cmp:[border:1px_solid_var(--input-border)] cmp:rounded-[var(--control-radius)] cmp:[background:var(--input-bg)] cmp:overflow-hidden cmp:[&:hover:not(.disabled)]:[border-color:var(--line-strong)] cmp:[&&:focus-within:not(.disabled)]:[border-color:var(--ring)] cmp:[&:focus-within:not(.disabled)]:[box-shadow:0_0_0_2px_color-mix(in_srgb,_var(--ring)_18%,_transparent)] cmp:[&.disabled]:opacity-[0.5] cmp:touchy:[--number-step-size:44px] cmp:touchy:h-[48px] cmp:touchy:p-[1px] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:absolute cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:right-[0] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:top-[0] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:w-[152px]! cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:min-w-[152px] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:h-[44px] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:[background:var(--control)] cmp:compact:[.mobile-workspace_.mobile-filter-card_&&&]:[border-color:var(--input)] ${disabled ? "disabled" : ""} ${className}`}
    >
      <Button
        variant="ghost"
        size="icon"
        className="stepper-btn leg:compact:[.custom-number-input_&]:min-w-[44px] leg:compact:[.custom-number-input_&]:w-[44px] leg:compact:[.custom-number-input_&]:flex-[0_0_44px] leg:pointer-coarse:[.custom-number-input_&&]:min-w-[44px] leg:pointer-coarse:[.custom-number-input_&&]:w-[44px] leg:pointer-coarse:[.custom-number-input_&&]:flex-[0_0_44px] cmp:[.custom-number-input_&]:inline-flex cmp:[.custom-number-input_&]:flex-[0_0_var(--number-step-size)] cmp:[.custom-number-input_&]:min-w-[var(--number-step-size)] cmp:[.custom-number-input_&]:min-h-[var(--number-step-size)] cmp:[.custom-number-input_&]:p-[0] cmp:[.custom-number-input_&]:[border:0] cmp:[.custom-number-input_&]:[outline:none] cmp:[.custom-number-input_&]:[background:transparent] cmp:[.custom-number-input_&]:text-[color:var(--muted)] cmp:[.custom-number-input_&]:[filter:none] cmp:[.custom-number-input_&:disabled]:opacity-[0.35] cmp:[.custom-number-input_&:hover:not(:disabled)]:text-[color:var(--text)] cmp:[.custom-number-input_&:hover:not(:disabled)]:[background:var(--accent)] cmp:touchy:[.custom-number-input_&]:h-[44px] decrement"
        onClick={() => stepValue(-1, false)}
        disabled={disabled || value <= min}
        aria-label={
          ariaLabel
            ? t("number.decrease", { label: ariaLabel })
            : t("number.decrement")
        }
      >
        <Minus aria-hidden="true" />
      </Button>
      <input
        id={id}
        type="text"
        role="spinbutton"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number.isFinite(value) ? value : min}
        aria-valuetext={displayValue}
        inputMode={precision > 0 ? "decimal" : "numeric"}
        enterKeyHint="done"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        min={min}
        max={max}
        step={step}
        value={displayValue}
        onChange={handleInputChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onFocus={onFocus}
        aria-label={ariaLabel}
        disabled={disabled}
        className="cmp:[.custom-number-input_&]:[appearance:textfield] cmp:[.custom-number-input_&]:box-border cmp:[.custom-number-input_&]:flex-[1_1_0] cmp:[.custom-number-input_&]:w-[0] cmp:[.custom-number-input_&]:min-w-[0] cmp:[.custom-number-input_&]:h-[100%] cmp:[.custom-number-input_&]:p-[0_var(--space-1)] cmp:[.custom-number-input_&]:[border:0] cmp:[.custom-number-input_&]:rounded-[0] cmp:[.custom-number-input_&]:[outline:none] cmp:[.custom-number-input_&]:[background:transparent] cmp:[.custom-number-input_&]:text-[color:var(--text)] cmp:[.custom-number-input_&]:[font:400_var(--type-label)/1_var(--font-mono)] cmp:[.custom-number-input_&&]:[font-variant-numeric:tabular-nums] cmp:[.custom-number-input_&]:text-center cmp:[.custom-number-input_&:focus-visible]:[outline:none] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:min-w-[56px] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:text-[length:14px]"
      />
      <Button
        variant="ghost"
        size="icon"
        className="stepper-btn leg:compact:[.custom-number-input_&]:min-w-[44px] leg:compact:[.custom-number-input_&]:w-[44px] leg:compact:[.custom-number-input_&]:flex-[0_0_44px] leg:pointer-coarse:[.custom-number-input_&&]:min-w-[44px] leg:pointer-coarse:[.custom-number-input_&&]:w-[44px] leg:pointer-coarse:[.custom-number-input_&&]:flex-[0_0_44px] cmp:[.custom-number-input_&]:inline-flex cmp:[.custom-number-input_&]:flex-[0_0_var(--number-step-size)] cmp:[.custom-number-input_&]:min-w-[var(--number-step-size)] cmp:[.custom-number-input_&]:min-h-[var(--number-step-size)] cmp:[.custom-number-input_&]:p-[0] cmp:[.custom-number-input_&]:[border:0] cmp:[.custom-number-input_&]:[outline:none] cmp:[.custom-number-input_&]:[background:transparent] cmp:[.custom-number-input_&]:text-[color:var(--muted)] cmp:[.custom-number-input_&]:[filter:none] cmp:[.custom-number-input_&:disabled]:opacity-[0.35] cmp:[.custom-number-input_&:hover:not(:disabled)]:text-[color:var(--text)] cmp:[.custom-number-input_&:hover:not(:disabled)]:[background:var(--accent)] cmp:touchy:[.custom-number-input_&]:h-[44px] increment"
        onClick={() => stepValue(1, false)}
        disabled={disabled || value >= max}
        aria-label={
          ariaLabel
            ? t("number.increase", { label: ariaLabel })
            : t("number.increment")
        }
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}
