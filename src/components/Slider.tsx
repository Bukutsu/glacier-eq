import React, { CSSProperties, InputHTMLAttributes } from "react";

/** CSSProperties has no index signature, so a custom property cannot typecheck
 * without a cast. Naming the shape once keeps that out of every call site. */
type CustomProperties = CSSProperties & Record<`--${string}`, string | number>;

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  onStartChange?: () => void;
  onEndChange?: () => void;
  onReset?: () => void;
}

export function Slider({
  className = "",
  style,
  onStartChange,
  onEndChange,
  onReset,
  ...props
}: SliderProps) {
  const min = Number(props.min ?? 0);
  const max = Number(props.max ?? 100);
  const percent = (value: number) => max > min ? Math.max(0, Math.min(100, (value - min) / (max - min) * 100)) : 0;
  const position = percent(Number(props.value ?? props.defaultValue ?? min));
  const hasZero = min < 0 && max > 0;
  const origin = hasZero ? percent(0) : 0;
  const sliderStyle: CustomProperties = {
    "--slider-fill-start": `${Math.min(origin, position)}%`,
    "--slider-fill-end": `${Math.max(origin, position)}%`,
    "--slider-zero": `${origin}%`,
    ...style,
    // Thumb matches the band's --filter-color where present (band rows set it),
    // falling back to blue elsewhere.
    "--slider-thumb": "var(--filter-color, var(--blue))",
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (onStartChange) onStartChange();
    if (props.onPointerDown) props.onPointerDown(e);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    if (onEndChange) onEndChange();
    if (props.onPointerUp) props.onPointerUp(e);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLInputElement>) => {
    if (onEndChange) onEndChange();
    if (props.onPointerCancel) props.onPointerCancel(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      !e.repeat &&
      onStartChange &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)
    ) {
      onStartChange();
    }

    if (props.onKeyDown) {
      props.onKeyDown(e);
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      onEndChange &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)
    ) {
      onEndChange();
    }

    if (props.onKeyUp) {
      props.onKeyUp(e);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLInputElement>) => {
    if (onReset) {
      onStartChange?.();
      onReset();
      onEndChange?.();
    }
    if (props.onDoubleClick) props.onDoubleClick(e);
  };

  return (
    <div className={`control-slider ${className}`.trim()} style={{ "--slider-zero": `${origin}%` } as CustomProperties}>
      {hasZero && <span className="slider-zero-mark" aria-hidden="true" />}
      <input
        {...props}
        className="control-slider-input"
        style={sliderStyle}
        type="range"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  );
}
