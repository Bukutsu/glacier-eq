// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  getFilterModeMeta,
  getFilterTimeCurve,
  getFilterFreqCurve,
  lerpCurve,
  TIME_RANGE_MS,
  FREQ_RANGE_KHZ,
  DEFAULT_POINTS,
} from "@/features/device/lib/dacFilterModes";

type ViewDomain = "time" | "freq";

const ANIM_DURATION_MS = 160;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

const HEIGHT = 136;
const PAD = { left: 40, right: 14, top: 14, bottom: 22 };
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const DEFAULT_WIDTH = 320;

const TIME_Y = [-0.5, 1.1] as const;
const FREQ_Y = [-60, 0] as const;
const TIME_Y_TICKS = [1.0, 0.5, 0.0, -0.5];
const FREQ_Y_TICKS = [0, -12, -24, -36, -48, -60];
const TIME_X_TICKS = [-0.6, -0.3, 0.0, 0.3, 0.6];
const FREQ_X_TICKS = [10, 14, 18, 20, 22, 24];

const getTarget = (mode: string, domain: ViewDomain) =>
  domain === "time"
    ? getFilterTimeCurve(mode, DEFAULT_POINTS)
    : getFilterFreqCurve(mode, DEFAULT_POINTS);

/** The collapsible "Filter response" row shared by the device screens. */
export function FilterResponse({ mode }: { mode: string }) {
  return (
    <details className="device-filter-details">
      <summary>
        Filter response
        <Icon name="expand_more" className="disclosure-chevron" />
      </summary>
      <DacFilterVisual mode={mode} />
    </details>
  );
}

/**
 * Follows `target`, easing from the curve on screen to the new one. Returns
 * the target at once for reduced motion and on the first render.
 */
function useEasedCurve(target: Float32Array): Float32Array {
  const [curve, setCurve] = useState(target);
  const shownRef = useRef(target);
  shownRef.current = curve;

  useEffect(() => {
    if (shownRef.current === target) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setCurve(target);
      return;
    }
    const from = shownRef.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ANIM_DURATION_MS);
      setCurve(t < 1 ? lerpCurve(from, target, easeOutCubic(t)) : target);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return curve;
}

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export const DacFilterVisual = memo(function DacFilterVisual({
  mode,
}: {
  mode: string;
}) {
  const [domain, setDomain] = useState<ViewDomain>("time");
  const [hover, setHover] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrapperRef);

  const meta = getFilterModeMeta(mode);
  const target = useMemo(() => getTarget(mode, domain), [mode, domain]);
  const curve = useEasedCurve(target);

  const isTime = domain === "time";
  const [yMin, yMax] = isTime ? TIME_Y : FREQ_Y;
  const [xMin, xMax] = isTime ? TIME_RANGE_MS : FREQ_RANGE_KHZ;
  const plotW = width - PAD.left - PAD.right;
  const valToY = (v: number) =>
    PAD.top + PLOT_H * (1 - (v - yMin) / (yMax - yMin));
  const xAt = (fraction: number) => PAD.left + plotW * fraction;
  const tickX = (v: number) => xAt((v - xMin) / (xMax - xMin));

  const last = curve.length - 1;
  const points = Array.from(
    curve,
    (v, i) => `${xAt(i / last).toFixed(1)},${valToY(v).toFixed(1)}`,
  );
  const line = `M${points.join("L")}`;
  const baseY = valToY(isTime ? 0 : -60);
  const area = `${line}L${xAt(1).toFixed(1)},${baseY.toFixed(1)}L${xAt(0).toFixed(1)},${baseY.toFixed(1)}Z`;

  const hoverIndex =
    hover === null ? null : Math.round(Math.min(1, Math.max(0, hover)) * last);
  const hoverValue = hoverIndex === null ? 0 : curve[hoverIndex];
  const hoverX = hover === null ? 0 : xAt(Math.min(1, Math.max(0, hover)));
  let hoverLabel: { x: string; y: string } | null = null;
  if (hover !== null && hoverIndex !== null) {
    const position = xMin + hover * (xMax - xMin);
    hoverLabel = isTime
      ? {
          x: `${position > 0 ? "+" : ""}${position.toFixed(2)} ms`,
          y: `${hoverValue > 0 ? "+" : ""}${hoverValue.toFixed(2)}`,
        }
      : {
          x: `${position.toFixed(1)} kHz`,
          y: `${hoverValue.toFixed(1)} dB`,
        };
  }

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      PAD.left,
      Math.min(PAD.left + plotW, event.clientX - rect.left),
    );
    setHover((x - PAD.left) / plotW);
  };

  return (
    <div className="dac-filter-card" aria-label={`Filter mode: ${mode}`}>
      <div className="dac-filter-header">
        <span className="dac-filter-title">{meta.name}</span>
        <div
          className="dac-filter-toggle"
          role="group"
          aria-label="Graph domain"
        >
          <button
            type="button"
            className={`dac-filter-tab ${domain === "time" ? "active" : ""}`}
            onClick={() => setDomain("time")}
            aria-pressed={domain === "time"}
            aria-label="Impulse (time)"
            title="Impulse response over time"
          >
            Impulse
          </button>
          <button
            type="button"
            className={`dac-filter-tab ${domain === "freq" ? "active" : ""}`}
            onClick={() => setDomain("freq")}
            aria-pressed={domain === "freq"}
            aria-label="Roll-off (frequency)"
            title="Roll-off across frequency"
          >
            Roll-off
          </button>
        </div>
      </div>

      <div className="dac-filter-chart-wrapper" ref={wrapperRef}>
        <svg
          className="dac-filter-svg"
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${meta.name}: ${isTime ? "impulse response" : "roll-off"}`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        >
          {(isTime ? TIME_Y_TICKS : FREQ_Y_TICKS).map((v) => (
            <g key={`y${v}`}>
              <line
                className={v === 0 ? "dac-filter-axis" : "dac-filter-grid"}
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={valToY(v)}
                y2={valToY(v)}
              />
              <text
                className="dac-filter-label"
                x={PAD.left - 6}
                y={valToY(v)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {isTime ? `${v > 0 ? "+" : ""}${v.toFixed(1)}` : `${v}dB`}
              </text>
            </g>
          ))}
          {(isTime ? TIME_X_TICKS : FREQ_X_TICKS).map((v) => (
            <g key={`x${v}`}>
              <line
                className={
                  isTime && v === 0 ? "dac-filter-axis" : "dac-filter-grid"
                }
                x1={tickX(v)}
                x2={tickX(v)}
                y1={PAD.top}
                y2={PAD.top + PLOT_H}
              />
              <text
                className="dac-filter-label"
                x={tickX(v)}
                y={PAD.top + PLOT_H + 12}
                textAnchor="middle"
              >
                {isTime ? `${v > 0 ? "+" : ""}${v.toFixed(1)}ms` : `${v}k`}
              </text>
            </g>
          ))}
          <path className="dac-filter-area" d={area} />
          <path className="dac-filter-line" d={line} />
          {isTime && (
            <circle
              className="dac-filter-dot"
              cx={xAt(0.5)}
              cy={valToY(curve[Math.floor(curve.length / 2)])}
              r={3.5}
            />
          )}
          {hoverIndex !== null && (
            <g className="dac-filter-cursor">
              <line
                x1={hoverX}
                x2={hoverX}
                y1={PAD.top}
                y2={PAD.top + PLOT_H}
              />
              <circle cx={hoverX} cy={valToY(hoverValue)} r={3} />
            </g>
          )}
        </svg>
        {hoverLabel && (
          <div className="dac-filter-hover-pill">
            <span>{hoverLabel.x}</span>
            <span className="dac-filter-hover-val">{hoverLabel.y}</span>
          </div>
        )}
      </div>

      <div className="dac-filter-footer">
        <div className="dac-filter-tags-row">
          <span className="dac-filter-sound">{meta.sound}</span>
          <span className="dac-filter-badge">· {meta.badge}</span>
        </div>
        <p className="dac-filter-desc">{meta.description}</p>
      </div>
    </div>
  );
});
