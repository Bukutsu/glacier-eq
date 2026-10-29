import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("device");

  return (
    <details className="device-filter-details leg:[border-bottom:1px_solid_var(--line-subtle)] cmp:[.configuration-layout_&]:m-[0] cmp:[.configuration-layout_&]:p-[var(--space-3)_0]">
      <summary>
        {t("dacFilterVisual.filterResponse")}
        <Icon name="expand_more" className="leg:flex-[0_0_auto] leg:text-[color:var(--muted)] leg:[transition:transform_var(--motion-duration)_var(--motion-ease)] leg:[details[open]>summary_&]:[transform:rotate(180deg)] leg:[.add-trace-cache_summary_&]:ml-[auto]" />
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
  const { t } = useTranslation("device");

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
    <div
      className="leg:flex leg:flex-col leg:gap-[10px] leg:p-[10px_12px] leg:[background:var(--bg-dark)] leg:[border:1px_solid_var(--line-soft)] leg:rounded-[var(--radius-card,_0)] leg:mt-[4px]"
      aria-label={t("dacFilterVisual.filterMode", { mode: mode })}
    >
      <div className="leg:flex leg:items-center leg:justify-between leg:gap-[8px] leg:flex-wrap cmp:max-[480px]:items-stretch">
        <span className="leg:text-[length:var(--type-small)] leg:font-semibold leg:text-[color:var(--text)]">{meta.name}</span>
        <div
          className="dac-filter-toggle cmp:inline-flex cmp:flex-[0_0_auto] cmp:items-center cmp:gap-[2px] cmp:p-[3px] cmp:[border:1px_solid_var(--border)] cmp:rounded-[var(--control-radius)] cmp:[background:var(--accent)] cmp:max-[480px]:w-[100%] cmp:max-[480px]:box-border"
          role="group"
          aria-label={t("dacFilterVisual.graphDomain")}
        >
          <button
            type="button"
            className={`cmp:[.dac-filter-toggle>&]:inline-flex cmp:[.dac-filter-toggle>&]:items-center cmp:[.dac-filter-toggle>&]:justify-center cmp:[.dac-filter-toggle>&]:min-w-[80px] cmp:[.dac-filter-toggle>&]:min-h-[32px] cmp:[.dac-filter-toggle>&]:m-[0] cmp:[.dac-filter-toggle>&]:p-[0_var(--space-3)] cmp:[.dac-filter-toggle>&]:[border:0] cmp:[.dac-filter-toggle>&]:rounded-[var(--control-radius)] cmp:[.dac-filter-toggle>&]:[background:transparent] cmp:[.dac-filter-toggle>&]:text-[color:var(--muted-foreground)] cmp:[.dac-filter-toggle>&]:[font:500_var(--type-label)/1.2_var(--font-ui)] cmp:[.dac-filter-toggle>&]:[box-shadow:none] cmp:[.dac-filter-toggle>&:hover]:text-[color:var(--foreground)] cmp:[.dac-filter-toggle>&[aria-pressed='true']]:[background:var(--popover)] cmp:[.dac-filter-toggle>&&[aria-pressed='true']]:text-[color:var(--foreground)] cmp:[.dac-filter-toggle>&[aria-pressed='true']]:[box-shadow:var(--shadow-sm)] cmp:[.dac-filter-toggle>&:focus-visible]:[outline:2px_solid_var(--ring)] cmp:[.dac-filter-toggle>&:focus-visible]:[outline-offset:-2px] cmp:touchy:[.dac-filter-toggle>&&]:min-h-[44px] cmp:max-[480px]:[.dac-filter-toggle>&]:flex-[1] cmp:max-[480px]:[.dac-filter-toggle>&&]:min-w-[0] cmp:compact:[.dac-filter-toggle>&&&]:min-h-[48px] ${domain === "time" ? "active" : ""}`}
            onClick={() => setDomain("time")}
            aria-pressed={domain === "time"}
            aria-label={t("dacFilterVisual.impulseTime")}
            title={t("dacFilterVisual.impulseResponseOverTime")}
          >
            {t("dacFilterVisual.impulse")}
          </button>
          <button
            type="button"
            className={`cmp:[.dac-filter-toggle>&]:inline-flex cmp:[.dac-filter-toggle>&]:items-center cmp:[.dac-filter-toggle>&]:justify-center cmp:[.dac-filter-toggle>&]:min-w-[80px] cmp:[.dac-filter-toggle>&]:min-h-[32px] cmp:[.dac-filter-toggle>&]:m-[0] cmp:[.dac-filter-toggle>&]:p-[0_var(--space-3)] cmp:[.dac-filter-toggle>&]:[border:0] cmp:[.dac-filter-toggle>&]:rounded-[var(--control-radius)] cmp:[.dac-filter-toggle>&]:[background:transparent] cmp:[.dac-filter-toggle>&]:text-[color:var(--muted-foreground)] cmp:[.dac-filter-toggle>&]:[font:500_var(--type-label)/1.2_var(--font-ui)] cmp:[.dac-filter-toggle>&]:[box-shadow:none] cmp:[.dac-filter-toggle>&:hover]:text-[color:var(--foreground)] cmp:[.dac-filter-toggle>&[aria-pressed='true']]:[background:var(--popover)] cmp:[.dac-filter-toggle>&&[aria-pressed='true']]:text-[color:var(--foreground)] cmp:[.dac-filter-toggle>&[aria-pressed='true']]:[box-shadow:var(--shadow-sm)] cmp:[.dac-filter-toggle>&:focus-visible]:[outline:2px_solid_var(--ring)] cmp:[.dac-filter-toggle>&:focus-visible]:[outline-offset:-2px] cmp:touchy:[.dac-filter-toggle>&&]:min-h-[44px] cmp:max-[480px]:[.dac-filter-toggle>&]:flex-[1] cmp:max-[480px]:[.dac-filter-toggle>&&]:min-w-[0] cmp:compact:[.dac-filter-toggle>&&&]:min-h-[48px] ${domain === "freq" ? "active" : ""}`}
            onClick={() => setDomain("freq")}
            aria-pressed={domain === "freq"}
            aria-label={t("dacFilterVisual.rollOffFrequency")}
            title={t("dacFilterVisual.rollOffAcrossFrequency")}
          >
            {t("dacFilterVisual.rollOff")}
          </button>
        </div>
      </div>

      <div className="leg:relative leg:w-[100%] leg:h-[136px] leg:[background:var(--panel,_#16161e)] leg:[border:1px_solid_var(--line-subtle)] leg:rounded-[var(--radius-card,_0)] leg:overflow-hidden leg:[touch-action:none]" ref={wrapperRef}>
        <svg
          className="leg:block leg:[cursor:crosshair] leg:overflow-hidden leg:[font-family:var(--font-mono)] leg:text-[length:10px] leg:font-medium"
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={t(
            isTime
              ? "dacFilterVisual.impulseLabel"
              : "dacFilterVisual.rollOffLabel",
            { name: meta.name },
          )}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        >
          {(isTime ? TIME_Y_TICKS : FREQ_Y_TICKS).map((v) => (
            <g key={`y${v}`}>
              <line
                className={v === 0 ? "leg:[stroke:var(--line-soft,_rgba(255,_255,_255,_0.15))] leg:[&&]:[stroke-width:1]" : "leg:[stroke:var(--canvas-grid,_rgba(65,_72,_104,_0.22))] leg:[&&]:[stroke-width:1]"}
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={valToY(v)}
                y2={valToY(v)}
              />
              <text
                className="leg:[fill:var(--muted,_#787c99)]"
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
                  isTime && v === 0 ? "leg:[stroke:var(--line-soft,_rgba(255,_255,_255,_0.15))] leg:[&&]:[stroke-width:1]" : "leg:[stroke:var(--canvas-grid,_rgba(65,_72,_104,_0.22))] leg:[&&]:[stroke-width:1]"
                }
                x1={tickX(v)}
                x2={tickX(v)}
                y1={PAD.top}
                y2={PAD.top + PLOT_H}
              />
              <text
                className="leg:[fill:var(--muted,_#787c99)]"
                x={tickX(v)}
                y={PAD.top + PLOT_H + 12}
                textAnchor="middle"
              >
                {isTime ? `${v > 0 ? "+" : ""}${v.toFixed(1)}ms` : `${v}k`}
              </text>
            </g>
          ))}
          <path className="leg:[fill:var(--cyan,_#7dcfff)] leg:[&&]:[fill-opacity:0.1]" d={area} />
          <path className="leg:[fill:none] leg:[stroke:var(--cyan,_#7dcfff)] leg:[&&]:[stroke-width:1.75] leg:[&&]:[stroke-linecap:round] leg:[&&]:[stroke-linejoin:round]" d={line} />
          {isTime && (
            <circle
              className="leg:[fill:var(--cyan,_#7dcfff)] leg:[stroke:var(--panel,_#16161e)] leg:[&&]:[stroke-width:1.5]"
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
          <div className="leg:absolute leg:top-[6px] leg:right-[8px] leg:inline-flex leg:items-center leg:gap-[6px] leg:[font-family:var(--font-mono)] leg:text-[length:var(--type-micro)] leg:[background:var(--panel,_#16161e)] leg:[border:1px_solid_var(--line-soft)] leg:p-[2px_6px] leg:text-[color:var(--muted)] leg:pointer-events-none">
            <span>{hoverLabel.x}</span>
            <span className="leg:text-[color:var(--link-foreground)] leg:font-semibold">{hoverLabel.y}</span>
          </div>
        )}
      </div>

      <div className="leg:flex leg:flex-col leg:gap-[3px]">
        <div className="leg:flex leg:items-baseline leg:gap-[6px] leg:flex-wrap">
          <span className="leg:text-[length:var(--type-small)] leg:font-bold leg:text-[color:var(--text)]">{meta.sound}</span>
          <span className="leg:text-[length:var(--type-micro)] leg:[font-family:var(--font-mono)] leg:font-semibold leg:tracking-[0.04em] leg:text-[color:var(--link-foreground)] leg:whitespace-nowrap">· {meta.badge}</span>
        </div>
        <p className="leg:m-[0] leg:text-[length:var(--type-small)] leg:text-[color:var(--comment)] leg:leading-[1.35]">{meta.description}</p>
      </div>
    </div>
  );
});
