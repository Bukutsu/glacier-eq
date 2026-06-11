import type { CSSProperties, InputHTMLAttributes } from "react";

type SliderTone = "blue" | "orange";

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  tone?: SliderTone;
}

export function Slider({ className = "", tone = "blue", style, ...props }: SliderProps) {
  const sliderStyle = {
    ...style,
    "--slider-thumb": tone === "orange" ? "var(--orange)" : "var(--blue)",
  } as CSSProperties;

  return (
    <div className={`control-slider ${className}`.trim()}>
      <input
        {...props}
        className="control-slider-input"
        style={sliderStyle}
        type="range"
      />
    </div>
  );
}
