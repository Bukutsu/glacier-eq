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
    const adjustKeys = [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
      "Home",
      "End",
    ];

    if (adjustKeys.includes(e.key)) {
      if (!e.repeat && onStartChange) {
        onStartChange();
      }

      const isLargeStep = e.shiftKey || e.key === "PageUp" || e.key === "PageDown";
      if (isLargeStep && (
        e.key === "ArrowLeft" || e.key === "ArrowRight" ||
        e.key === "ArrowUp" || e.key === "ArrowDown" ||
        e.key === "PageUp" || e.key === "PageDown"
      )) {
        e.preventDefault();
        const input = e.currentTarget;
        const currentVal = parseFloat(input.value);
        const minVal = parseFloat(input.min) || 0;
        const maxVal = parseFloat(input.max) || 100;
        const stepVal = parseFloat(input.step) || 1;
        const multiplier = 10;
        
        const direction = (
          e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "PageUp"
        ) ? 1 : -1;
        
        const nextVal = Math.min(
          maxVal,
          Math.max(minVal, currentVal + direction * stepVal * multiplier)
        );
        
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )?.set;
        
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(input, nextVal.toString());
          const event = new Event("input", { bubbles: true });
          input.dispatchEvent(event);
        }
      }
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
