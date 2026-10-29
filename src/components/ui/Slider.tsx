import React, {
  type CSSProperties,
  type InputHTMLAttributes,
  useEffect,
  useRef,
} from "react";

/** CSSProperties has no index signature, so a custom property cannot typecheck
 * without a cast. Naming the shape once keeps that out of every call site. */
type CustomProperties = CSSProperties & Record<`--${string}`, string | number>;

interface SliderProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  onStartChange?: () => void;
  onEndChange?: () => void;
  onReset?: () => void;
  onCancelChange?: (value: number) => void;
}

export function Slider({
  className = "",
  style,
  onStartChange,
  onEndChange,
  onReset,
  onCancelChange,
  ...props
}: SliderProps) {
  const min = Number(props.min ?? 0);
  const max = Number(props.max ?? 100);
  const percent = (value: number) =>
    max > min
      ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
      : 0;
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

  const gesture = useRef<{
    value: number;
    pointerId?: number;
    cleanup: () => void;
  } | null>(null);
  const callbacks = useRef({ onEndChange, onCancelChange });
  callbacks.current = { onEndChange, onCancelChange };

  const finish = (cancel = false) => {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    active.cleanup();
    if (cancel) callbacks.current.onCancelChange?.(active.value);
    callbacks.current.onEndChange?.();
  };

  // Window listeners observe termination only; native range/scroll routing stays native.
  const start = (input: HTMLInputElement, pointerId?: number) => {
    if (props.disabled || gesture.current) return;
    const win = input.ownerDocument.defaultView;
    const pointerEnd = (event: PointerEvent) => {
      if (event.pointerId === gesture.current?.pointerId)
        finish(event.type === "pointercancel");
    };
    const windowBlur = () => finish();
    gesture.current = {
      value: Number(input.value),
      pointerId,
      cleanup: () => {
        win?.removeEventListener("pointerup", pointerEnd);
        win?.removeEventListener("pointercancel", pointerEnd);
        win?.removeEventListener("blur", windowBlur);
      },
    };
    if (pointerId !== undefined) {
      win?.addEventListener("pointerup", pointerEnd);
      win?.addEventListener("pointercancel", pointerEnd);
    }
    win?.addEventListener("blur", windowBlur);
    onStartChange?.();
  };

  useEffect(() => () => finish(), []);
  useEffect(() => {
    if (props.disabled) finish();
  }, [props.disabled]);

  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (e.isPrimary !== false && e.button === 0)
      start(e.currentTarget, e.pointerId);
    props.onPointerDown?.(e);
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    if (gesture.current?.pointerId === e.pointerId) finish();
    props.onPointerUp?.(e);
  };
  const handlePointerCancel = (e: React.PointerEvent<HTMLInputElement>) => {
    if (gesture.current?.pointerId === e.pointerId) finish(true);
    props.onPointerCancel?.(e);
  };
  const adjustmentKeys = [
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "PageUp",
    "PageDown",
    "Home",
    "End",
  ];
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (adjustmentKeys.includes(e.key)) start(e.currentTarget);
    if (e.key === "Escape") finish(true);
    props.onKeyDown?.(e);
  };
  const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      adjustmentKeys.includes(e.key) &&
      gesture.current?.pointerId === undefined
    )
      finish();
    props.onKeyUp?.(e);
  };
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    finish();
    props.onBlur?.(e);
  };
  const handleDoubleClick = (e: React.MouseEvent<HTMLInputElement>) => {
    if (!props.disabled && onReset) {
      finish();
      start(e.currentTarget);
      onReset();
      finish();
    }
    props.onDoubleClick?.(e);
  };

  return (
    <div
      className={`control-slider ${className}`.trim()}
      style={{ "--slider-zero": `${origin}%` } as CustomProperties}
    >
      {hasZero && <span className="cmp:compact:hidden cmp:compact:[.mobile-workspace_&]:block cmp:compact:[.mobile-workspace_&]:absolute cmp:compact:[.mobile-workspace_&]:left-[clamp(10px,_var(--slider-zero),_calc(100%_-_10px))] cmp:compact:[.mobile-workspace_&]:top-[calc(50%_-_5px)] cmp:compact:[.mobile-workspace_&]:h-[10px] cmp:compact:[.mobile-workspace_&]:w-[2px] cmp:compact:[.mobile-workspace_&]:[background:var(--muted-foreground)] cmp:compact:[.mobile-workspace_&]:pointer-events-none" aria-hidden="true" />}
      <input
        {...props}
        className="control-slider-input leg:[appearance:none] leg:w-[100%] leg:min-w-[0] leg:h-[20px] leg:m-[0] leg:[background:transparent] leg:[outline:0] leg:[touch-action:pan-y] leg:pointer-coarse:min-h-[44px] leg:pointer-coarse:h-[44px] cmp:compact:[.mobile-workspace_&]:min-h-[var(--touch-md)] cmp:compact:[.mobile-workspace_&]:[--slider-thumb:var(--foreground)]! cmp:compact:[.mobile-workspace_&::-webkit-slider-thumb]:[background:var(--foreground)]! cmp:compact:[.mobile-workspace_&::-webkit-slider-thumb]:[box-shadow:none]! cmp:compact:[.mobile-workspace_&::-moz-range-thumb]:[background:var(--foreground)]! cmp:compact:[.mobile-workspace_&::-moz-range-thumb]:[box-shadow:none]! cmp:compact:[.mobile-workspace_&::-webkit-slider-thumb]:w-[20px] cmp:compact:[.mobile-workspace_&::-webkit-slider-thumb]:h-[20px] cmp:compact:[.mobile-workspace_&::-webkit-slider-thumb]:mt-[-9px] cmp:compact:[.mobile-workspace_&::-moz-range-thumb]:w-[20px] cmp:compact:[.mobile-workspace_&::-moz-range-thumb]:h-[20px] cmp:compact:[.mobile-workspace_&]:[touch-action:pan-y] cmp:compact:[.mobile-workspace_&]:relative cmp:compact:[.mobile-workspace_&]:z-[1] cmp:compact:[.mobile-workspace_&::-webkit-slider-runnable-track]:[background:linear-gradient(to_right,_var(--surface)_var(--slider-fill-start),_var(--muted-foreground)_var(--slider-fill-start),_var(--muted-foreground)_var(--slider-fill-end),_var(--surface)_var(--slider-fill-end))]! cmp:compact:[.mobile-workspace_&::-moz-range-track]:[background:linear-gradient(to_right,_var(--surface)_var(--slider-fill-start),_var(--muted-foreground)_var(--slider-fill-start),_var(--muted-foreground)_var(--slider-fill-end),_var(--surface)_var(--slider-fill-end))]!"
        style={sliderStyle}
        type="range"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={handleBlur}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  );
}
