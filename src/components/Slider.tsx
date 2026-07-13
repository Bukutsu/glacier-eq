import React, { CSSProperties, InputHTMLAttributes } from "react";

type SliderTone = "blue" | "orange";

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  tone?: SliderTone;
  onStartChange?: () => void;
  onReset?: () => void;
}

export function Slider({
  className = "",
  tone = "blue",
  style,
  onStartChange,
  onReset,
  ...props
}: SliderProps) {
  const sliderStyle = {
    ...style,
    "--slider-thumb": tone === "orange" ? "var(--orange)" : "var(--blue)",
  } as CSSProperties;

  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (onStartChange) onStartChange();
    if (props.onPointerDown) props.onPointerDown(e);
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

  const handleDoubleClick = (e: React.MouseEvent<HTMLInputElement>) => {
    if (onReset) {
      onReset();
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
        onKeyDown={handleKeyDown}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  );
}
