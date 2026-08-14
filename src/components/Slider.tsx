import React, { CSSProperties, InputHTMLAttributes } from "react";

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
  const sliderStyle = {
    ...style,
    // Thumb matches the band's --filter-color where present (band rows set it),
    // falling back to blue elsewhere.
    "--slider-thumb": "var(--filter-color, var(--blue))",
  } as CSSProperties;

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
    <div className={`control-slider ${className}`.trim()}>
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
