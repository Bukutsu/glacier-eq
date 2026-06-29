import React, { CSSProperties, InputHTMLAttributes } from "react";

type SliderTone = "blue" | "orange";

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  tone?: SliderTone;
  onStartChange?: () => void;
}

export function Slider({
  className = "",
  tone = "blue",
  style,
  onStartChange,
  ...props
}: SliderProps) {
  const sliderStyle = {
    ...style,
    "--slider-thumb": tone === "orange" ? "var(--orange)" : "var(--blue)",
  } as CSSProperties;

  const handleMouseDown = (e: React.MouseEvent<HTMLInputElement>) => {
    if (onStartChange) onStartChange();
    if (props.onMouseDown) props.onMouseDown(e);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLInputElement>) => {
    if (onStartChange) onStartChange();
    if (props.onTouchStart) props.onTouchStart(e);
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

  return (
    <div className={`control-slider ${className}`.trim()}>
      <input
        {...props}
        className="control-slider-input"
        style={sliderStyle}
        type="range"
        onMouseDown={handleMouseDown}
        onTouchStart={props.onTouchStart ? handleTouchStart : onStartChange ? () => onStartChange() : undefined}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
