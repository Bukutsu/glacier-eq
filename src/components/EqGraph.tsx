import { useCallback, useEffect, useRef, Fragment, useState } from "react";
import { dbToY, filterResponseValues, formatFreq, freqToX, peqResponseValues, xToFreq } from "../lib/graph";
import { filterColorVars, cssVar } from "../lib/theme";
import { interpolateMeasurementDb } from "../lib/measurements";

import { peqEquals } from "../lib/peq";
import type { GraphViewMode, MeasurementTrace, PEQData, TargetTrace } from "../types";

const GRAPH_FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const GRAPH_DBS = [-15, -10, -5, 0, 5, 10, 15];

const DEFAULT_MOTION_MS = 160;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

function lerpPeq(a: PEQData, b: PEQData, t: number): PEQData {
  return {
    global_gain: lerp(a.global_gain, b.global_gain, t),
    filters: b.filters.map((fb, index) => {
      const fa = a.filters[index] ?? fb;
      return {
        ...(t < 0.5 ? fa : fb),
        freq: Math.round(lerp(fa.freq, fb.freq, t)),
        gain: lerp(fa.gain, fb.gain, t),
        q: lerp(fa.q, fb.q, t),
      };
    }),
  };
}

export function EqGraph({
  peq,
  committedPeq,
  selectedMeasurementId,
  measurements,
  targets,
  viewMode,
  theme,
}: {
  peq: PEQData;
  committedPeq?: PEQData | null;
  selectedMeasurementId?: string | null;
  measurements: MeasurementTrace[];
  targets: TargetTrace[];
  viewMode: GraphViewMode;
  theme?: string;
}) {
  const [showMobileLegend, setShowMobileLegend] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawSerialRef = useRef(0);
  const visibleMeasurements = measurements.filter((trace) => trace.visible);
  const selectedMeasurement = selectedMeasurementId
    ? measurements.find((trace) => trace.id === selectedMeasurementId && trace.visible) ?? null
    : visibleMeasurements.length === 1
      ? visibleMeasurements[0]
      : null;
  const draw = useCallback(async (peqOverride?: PEQData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    if (width < 2 || height < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = Math.floor(width * dpr);
    const canvasHeight = Math.floor(height * dpr);
    if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground(ctx, width, height);
    drawGrid(ctx, width, height);
    const drawSerial = ++drawSerialRef.current;
    await drawCurves(
      ctx,
      width,
      height,
      peqOverride ?? peq,
      committedPeq,
      selectedMeasurement,
      visibleMeasurements,
      targets,
      viewMode,
      () => drawSerial === drawSerialRef.current,
    );
  }, [peq, committedPeq, selectedMeasurement, visibleMeasurements, targets, viewMode, theme]);

  const displayPeqRef = useRef(peq);
  const targetPeqRef = useRef(peq);
  const fromPeqRef = useRef(peq);
  const fromTimeRef = useRef(0);
  const durationRef = useRef(DEFAULT_MOTION_MS);
  const animRafRef = useRef(0);
  const animationTokenRef = useRef(0);
  const animatingRef = useRef(false);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const tick = useCallback((token: number) => {
    if (token !== animationTokenRef.current) return;

    const t = durationRef.current <= 0
      ? 1
      : Math.min(1, (performance.now() - fromTimeRef.current) / durationRef.current);
    displayPeqRef.current = lerpPeq(fromPeqRef.current, targetPeqRef.current, easeOutCubic(t));
    void drawRef.current(displayPeqRef.current).then(() => {
      if (token !== animationTokenRef.current) return;
      if (t < 1) {
        animRafRef.current = requestAnimationFrame(() => tick(token));
      } else {
        animatingRef.current = false;
      }
    });
  }, []);

  const beginAnim = useCallback((next: PEQData) => {
    const token = ++animationTokenRef.current;
    targetPeqRef.current = next;
    fromPeqRef.current = displayPeqRef.current;
    fromTimeRef.current = performance.now();
    durationRef.current = Number(cssVar("--motion-duration-ms", String(DEFAULT_MOTION_MS)));
    animatingRef.current = true;
    cancelAnimationFrame(animRafRef.current);
    animRafRef.current = requestAnimationFrame(() => tick(token));
  }, [tick]);

  // Ease the EQ curve toward the latest PEQ whenever it changes.
  useEffect(() => { beginAnim(peq); }, [peq, beginAnim]);

  // Immediate redraw for non-PEQ changes (measurements, targets, view, theme).
  useEffect(() => {
    if (animatingRef.current) return;
    const raf = requestAnimationFrame(() => void drawRef.current(displayPeqRef.current));
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // Redraw on container resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => void drawRef.current(displayPeqRef.current));
    });
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  // Cancel any in-flight animation frame on unmount.
  useEffect(() => () => {
    animationTokenRef.current++;
    cancelAnimationFrame(animRafRef.current);
  }, []);

  return (
    <div className="eq-graph-shell">
      <canvas className="eq-canvas" ref={canvasRef} />
      {(committedPeq || targets.length > 0 || visibleMeasurements.length > 0) && (
        <button
          className={`mobile-legend-toggle ${showMobileLegend ? "active" : ""}`}
          onClick={() => setShowMobileLegend(!showMobileLegend)}
          title="Toggle legend"
          aria-label="Toggle legend"
        >
          <span className="material-symbols-outlined">{showMobileLegend ? "close" : "legend_toggle"}</span>
        </button>
      )}
      {(committedPeq || targets.length > 0 || visibleMeasurements.length > 0) && (
        <div className={`graph-legend ${showMobileLegend ? "mobile-open" : ""}`}>
          {committedPeq && !peqEquals(committedPeq, peq) && (
            <div className="graph-legend-item committed">
              <span className="graph-legend-swatch">
                <svg width="24" height="8" viewBox="0 0 24 8" className="graph-legend-svg">
                  <line x1="0" y1="4" x2="24" y2="4" stroke="var(--bg-dark)" strokeWidth="4" strokeDasharray="6,4" />
                  <line x1="0" y1="4" x2="24" y2="4" stroke="var(--orange)" strokeWidth="2" strokeDasharray="6,4" />
                </svg>
              </span>
              <span>{selectedMeasurement ? `Last pushed + ${selectedMeasurement.name}` : "Last pushed"}</span>
            </div>
          )}
          {targets.map((target) => (
            <div className="graph-legend-item target" key={target.id}>
              <span className="graph-legend-swatch">
                <svg width="24" height="8" viewBox="0 0 24 8" className="graph-legend-svg">
                  <line x1="0" y1="4" x2="24" y2="4" stroke={resolveColor(target.color)} strokeWidth="2" strokeDasharray="2,4" strokeLinecap="round" />
                </svg>
              </span>
              <span>{target.name}</span>
            </div>
          ))}
          {visibleMeasurements.map((trace) => (
            <Fragment key={trace.id}>
              <div className="graph-legend-item">
                <span className="graph-legend-swatch">
                  <svg width="24" height="8" viewBox="0 0 24 8" className="graph-legend-svg">
                    <line x1="0" y1="4" x2="24" y2="4" stroke={resolveColor(trace.color)} strokeWidth="3" />
                  </svg>
                </span>
                <span>{trace.name} (EQ applied)</span>
              </div>
              <div className="graph-legend-item raw">
                <span className="graph-legend-swatch">
                  <svg width="24" height="8" viewBox="0 0 24 8" className="graph-legend-svg">
                    <line x1="0" y1="4" x2="24" y2="4" stroke={resolveColor(trace.color)} strokeWidth="1.2" strokeOpacity="0.44" />
                  </svg>
                </span>
                <span className="raw-label">{trace.name} (raw)</span>
              </div>
            </Fragment>
          ))}
          {visibleMeasurements.length === 0 && (
            <div className="graph-legend-item eq-curve">
              <span className="graph-legend-swatch">
                <svg width="24" height="8" viewBox="0 0 24 8" className="graph-legend-svg">
                  <line x1="0" y1="4" x2="24" y2="4" stroke="var(--cyan)" strokeWidth="3" />
                </svg>
              </span>
              <span>EQ Curve</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = cssVar("--panel", "#24283b");
  ctx.fillRect(0, 0, width, height);
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const mono = cssVar("--font-mono", "ui-monospace");
  ctx.strokeStyle = cssVar("--canvas-grid", "rgba(128, 128, 128, 0.20)");
  ctx.lineWidth = 1;
  ctx.font = `12px ${mono}`;
  ctx.fillStyle = cssVar("--muted", "#a9b1d6");

  for (const freq of GRAPH_FREQS) {
    const x = freqToX(freq, width);
    ctx.beginPath();
    ctx.moveTo(x, 18);
    ctx.lineTo(x, height - 18);
    ctx.stroke();
    ctx.fillText(formatFreq(freq), x + 4, height - 4);
  }

  for (const db of GRAPH_DBS) {
    const y = dbToY(db, height);
    ctx.beginPath();
    ctx.moveTo(14, y);
    ctx.lineTo(width - 14, y);
    ctx.stroke();
    ctx.fillText(`${db > 0 ? "+" : ""}${db}dB`, 18, y - 4);
  }
}

async function drawCurves(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  peq: PEQData,
  committedPeq: PEQData | null | undefined,
  selectedMeasurement: MeasurementTrace | null,
  measurements: MeasurementTrace[],
  targets: TargetTrace[],
  viewMode: GraphViewMode,
  isCurrent: () => boolean,
) {
  const freqs = Array.from({ length: width }, (_, x) => xToFreq(x, width));
  const eqResponse = await responseValues(peq, freqs, viewMode);
  const bandResponses = await Promise.all(
    peq.filters
      .filter((filter) => filter.enabled)
      .map((band) => filterResponseValues(band, freqs)),
  );
  if (!isCurrent()) return;

  for (const response of bandResponses) {
    drawResponse(ctx, height, response, "color-mix(in srgb, var(--cyan) 22%, transparent)", 1);
  }

  for (const target of targets) {
    drawTrace(ctx, width, height, target, 1.6, [2, 6]);
  }

  for (const trace of measurements) {
    drawTrace(ctx, width, height, trace, 1.2, [], withAlpha(trace.color, 0.44));
  }

  if (measurements.length === 0) {
    const zero = dbToY(0, height);
    ctx.beginPath();
    ctx.moveTo(0, zero);
    eqResponse.forEach((db, x) => ctx.lineTo(x, dbToY(db, height)));
    ctx.lineTo(width, zero);
    ctx.closePath();
    ctx.fillStyle = "color-mix(in srgb, var(--cyan) 15%, transparent)";
    ctx.fill();

    drawResponse(ctx, height, eqResponse, cssVar("--cyan", "#7dcfff"), 3);
    await drawCommittedPreview(ctx, width, height, peq, committedPeq, selectedMeasurement, viewMode, isCurrent);
    if (!isCurrent()) return;
    drawFilterDots(ctx, width, height, peq);
    return;
  }

  const measurementOffset = viewMode === "shape" ? -(await combinedResponseAt(peq, 1000, "shape")) : 0;
  if (!isCurrent()) return;
  measurements.forEach((trace) => {
    drawResponse(ctx, height, measurementResponseValues(eqResponse, freqs, trace, measurementOffset), trace.color, 3);
  });
  await drawCommittedPreview(ctx, width, height, peq, committedPeq, selectedMeasurement, viewMode, isCurrent);
  await drawFilterDotsWithMeasurement(ctx, width, height, peq, selectedMeasurement, viewMode, isCurrent);
}

async function drawCommittedPreview(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  peq: PEQData,
  committedPeq: PEQData | null | undefined,
  selectedMeasurement: MeasurementTrace | null,
  viewMode: GraphViewMode,
  isCurrent: () => boolean,
) {
  if (!committedPeq || peqEquals(committedPeq, peq)) {
    return;
  }

  const freqs = Array.from({ length: width }, (_, x) => xToFreq(x, width));
  const values = await responseValues(committedPeq, freqs, viewMode, selectedMeasurement);
  if (!isCurrent()) return;
  const isCompact = width < 520;

  drawResponse(
    ctx,
    height,
    values,
    cssVar("--bg-dark", "#1b1e2e"),
    isCompact ? 3 : 4,
    [12, 6],
  );
  drawResponse(
    ctx,
    height,
    values,
    cssVar("--orange", "#ff9e64"),
    isCompact ? 1.5 : 2.5,
    [12, 6],
  );
}

async function combinedResponseAt(peq: PEQData, freq: number, viewMode: GraphViewMode): Promise<number> {
  return (await peqResponseValues(peq, [freq], viewMode === "level"))[0] ?? 0;
}

async function responseValues(
  peq: PEQData,
  freqs: number[],
  viewMode: GraphViewMode,
  measurement?: MeasurementTrace | null,
): Promise<number[]> {
  const offset = measurement && viewMode === "shape" ? -(await combinedResponseAt(peq, 1000, "shape")) : 0;
  const eqValues = await peqResponseValues(peq, freqs, viewMode === "level");
  return freqs.map((freq, index) => {
    const db = (eqValues[index] ?? 0) + offset;
    const measured = measurement ? interpolateMeasurementDb(measurement.points, freq) : 0;
    return Number.isFinite(db + measured) ? db + measured : 0;
  });
}

function measurementResponseValues(
  eqResponse: number[],
  freqs: number[],
  measurement: MeasurementTrace,
  offset: number,
): number[] {
  return eqResponse.map((db, x) => db + interpolateMeasurementDb(measurement.points, freqs[x]) + offset);
}

function resolveColor(color: string): string {
  if (color.startsWith("var(")) {
    const varName = color.slice(4, -1);
    return cssVar(varName);
  }
  return color;
}

function drawTrace(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  trace: MeasurementTrace | TargetTrace,
  lineWidth: number,
  dash: number[],
  color = trace.color,
) {
  ctx.beginPath();
  trace.points.forEach((point, index) => {
    const x = freqToX(point.freq, width);
    const y = dbToY(point.db, height);
    index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = resolveColor(color);
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dash);
  ctx.stroke();
  ctx.setLineDash([]);
}

function withAlpha(color: string, alpha: number): string {
  const hex = resolveColor(color);
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return color;

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function drawResponse(
  ctx: CanvasRenderingContext2D,
  height: number,
  values: number[],
  color: string,
  width = 1,
  dash: number[] = [],
) {
  ctx.beginPath();
  values.forEach((db, x) => {
    const y = dbToY(db, height);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = resolveColor(color);
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawFilterDots(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  peq: PEQData,
  dotValues?: number[],
) {
  const text = cssVar("--bg-dark", "#1a1b26");
  const stroke = cssVar("--panel", "#24283b");
  const activeBands = peq.filters.filter((filter) => filter.enabled);

  activeBands.forEach((filter, index) => {
    const x = freqToX(filter.freq, width);
    const dotDb = dotValues?.[index] ?? filter.gain;
    const y = dbToY(dotDb, height);
    const [token, , fallback] = filterColorVars(filter.index);
    const color = cssVar(token, fallback);

    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.stroke();

    ctx.fillStyle = text;
    ctx.font = `10px ${cssVar("--font-mono", "ui-monospace")}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(filter.index + 1), x, y + 0.5);
  });

  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

async function drawFilterDotsWithMeasurement(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  peq: PEQData,
  selectedMeasurement: MeasurementTrace | null,
  viewMode: GraphViewMode,
  isCurrent: () => boolean,
) {
  if (!selectedMeasurement) {
    drawFilterDots(ctx, width, height, peq);
    return;
  }

  const activeBands = peq.filters.filter((filter) => filter.enabled);
  const freqs = activeBands.map((filter) => filter.freq);
  const measurementOffset = viewMode === "shape" ? -(await combinedResponseAt(peq, 1000, "shape")) : 0;
  const eqValues = await peqResponseValues(peq, freqs, viewMode === "level");
  if (!isCurrent()) return;
  const dotValues = freqs.map((freq, index) =>
    (eqValues[index] ?? 0) + interpolateMeasurementDb(selectedMeasurement.points, freq) + measurementOffset
  );
  drawFilterDots(ctx, width, height, peq, dotValues);
}
