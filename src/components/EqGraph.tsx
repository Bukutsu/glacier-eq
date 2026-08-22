import { memo, useCallback, useEffect, useRef, Fragment, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { dbToY, filterResponseValues, formatFreq, freqToX, getFreqGrid, peqResponseValues, snapFreqToIsoSync, xToFreq, yToDb } from "../lib/graph";
import { cssVar, rgbWithAlpha } from "../lib/theme";
import { interpolateMeasurementDb } from "../lib/measurements";
import { filterColorVars } from "../lib/filterColors";
import { peqEquals } from "../lib/peq";
import type { DeviceCapabilities, Filter, GraphViewMode, MeasurementTrace, PEQData, TargetTrace } from "../types";
import { Icon } from "./Icon";

const GRAPH_FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const GRAPH_DBS = [-18, -12, -6, 0, 6, 12, 18];

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

export const EqGraph = memo(function EqGraph({
  peq,
  committedPeq,
  selectedMeasurementId,
  measurements,
  targets,
  viewMode,
  theme,
  capabilities,
  activeBandIndex,
  onActiveBandChange,
  onStartChange,
  onFilterChange,
  snapToIso,
}: {
  peq: PEQData;
  committedPeq?: PEQData | null;
  selectedMeasurementId?: string | null;
  measurements: MeasurementTrace[];
  targets: TargetTrace[];
  viewMode: GraphViewMode;
  theme?: string;
  capabilities?: DeviceCapabilities;
  activeBandIndex?: number | null;
  onActiveBandChange?: (index: number) => void;
  onStartChange?: () => void;
  onFilterChange?: (index: number, filter: Filter) => void;
  snapToIso?: boolean;
}) {
  const [showMobileLegend, setShowMobileLegend] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const drawSerialRef = useRef(0);
  const wheelGestureRef = useRef<{ index: number; filter: Filter } | null>(null);
  const wheelGestureTimerRef = useRef<number | undefined>(undefined);
  const wheelHandlerRef = useRef<(event: WheelEvent, index: number) => void>(() => {});
  const editable = Boolean(capabilities && onActiveBandChange && onStartChange && onFilterChange);
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

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
      editable,
      capabilities?.dsp_sample_rate ?? 96000,
      () => drawSerial === drawSerialRef.current,
    );
  }, [peq, committedPeq, selectedMeasurement, visibleMeasurements, targets, viewMode, theme, editable, capabilities?.dsp_sample_rate]);

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
    drawRef.current(displayPeqRef.current)
      .then(() => {
        if (token !== animationTokenRef.current) return;
        if (t < 1) {
          animRafRef.current = requestAnimationFrame(() => tick(token));
        } else {
          animatingRef.current = false;
        }
      })
      .catch((err) => {
        console.error("EqGraph canvas draw failed:", err);
        animatingRef.current = false;
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
    const raf = requestAnimationFrame(() => {
      void drawRef.current(displayPeqRef.current).catch((error) => console.error("EqGraph redraw failed:", error));
    });
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // Redraw on container resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        void drawRef.current(displayPeqRef.current).catch((error) => console.error("EqGraph resize redraw failed:", error));
      });
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
    window.clearTimeout(wheelGestureTimerRef.current);
  }, []);

  const updateFromPointer = (event: PointerEvent<HTMLButtonElement>, index: number, filter: Filter) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !capabilities || !onFilterChange) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;

    const rawFreq = Math.round(xToFreq(event.clientX - rect.left, rect.width));
    const snappedFreq = snapToIso ? snapFreqToIsoSync(rawFreq) : rawFreq;
    const freq = Math.max(capabilities.freq_range[0], Math.min(capabilities.freq_range[1], snappedFreq));
    const gain = Number(Math.max(capabilities.band_gain_range[0], Math.min(capabilities.band_gain_range[1], yToDb(event.clientY - rect.top, rect.height))).toFixed(2));
    onFilterChange(index, { ...filter, freq, gain });
  };

  const updateFromWheel = (event: WheelEvent, index: number, filter: Filter) => {
    if (!capabilities || !onFilterChange) return;
    const delta = event.deltaY || event.deltaX;
    if (!delta) return;

    event.preventDefault();
    event.stopPropagation();
    onActiveBandChange?.(index);

    const current = wheelGestureRef.current?.index === index ? wheelGestureRef.current.filter : filter;
    const direction = delta < 0 ? 1 : -1;
    const next = event.shiftKey
      ? {
          ...current,
          q: Number(Math.max(capabilities.q_range[0], Math.min(capabilities.q_range[1], current.q * 2 ** (direction / 12))).toFixed(2)),
        }
      : {
          ...current,
          gain: Number(Math.max(capabilities.band_gain_range[0], Math.min(capabilities.band_gain_range[1], current.gain + direction * 0.1)).toFixed(2)),
        };

    if (next.q === current.q && next.gain === current.gain) return;
    if (!wheelGestureRef.current || wheelGestureRef.current.index !== index) onStartChange?.();
    wheelGestureRef.current = { index, filter: next };
    window.clearTimeout(wheelGestureTimerRef.current);
    wheelGestureTimerRef.current = window.setTimeout(() => { wheelGestureRef.current = null; }, 250);
    onFilterChange(index, next);
  };

  wheelHandlerRef.current = (event, index) => {
    const filter = peq.filters[index];
    if (filter) updateFromWheel(event, index, filter);
  };

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const handleWheel = (event: WheelEvent) => {
      const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>(".eq-filter-handle");
      if (handle) wheelHandlerRef.current(event, Number(handle.dataset.filterIndex));
    };
    shell.addEventListener("wheel", handleWheel, { passive: false });
    return () => shell.removeEventListener("wheel", handleWheel);
  }, []);

  const updateFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number, filter: Filter) => {
    if (!capabilities || !onFilterChange || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    onActiveBandChange?.(index);
    if (!event.repeat) onStartChange?.();

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const scaled = Math.round(filter.freq * 2 ** (direction / 48));
      const stepped = direction < 0 ? Math.min(scaled, filter.freq - 1) : Math.max(scaled, filter.freq + 1);
      let snapped = snapToIso ? snapFreqToIsoSync(stepped) : stepped;
      if (snapToIso) {
        // At an ISO center the ±1/48-octave step snaps straight back
        // (1000 → 1015 → 1000), leaving the band stuck; widen the step until
        // the snapped value actually moves.
        const current = snapFreqToIsoSync(filter.freq);
        let candidate = stepped;
        while (snapped === current) {
          const next = Math.round(candidate * 2 ** (direction / 48));
          const bounded = direction < 0 ? Math.min(next, filter.freq - 1) : Math.max(next, filter.freq + 1);
          if (bounded === candidate) break; // pinned against the range edge
          candidate = bounded;
          snapped = snapFreqToIsoSync(candidate);
        }
      }
      const freq = Math.max(capabilities.freq_range[0], Math.min(capabilities.freq_range[1], snapped));
      onFilterChange(index, { ...filter, freq });
      return;
    }

    const delta = (event.shiftKey ? 1 : 0.1) * (event.key === "ArrowUp" ? 1 : -1);
    const gain = Number(Math.max(capabilities.band_gain_range[0], Math.min(capabilities.band_gain_range[1], filter.gain + delta)).toFixed(2));
    onFilterChange(index, { ...filter, gain });
  };

  return (
    <div className="eq-graph-shell" ref={shellRef}>
      <canvas
        className="eq-canvas"
        ref={canvasRef}
        role="img"
        aria-label="Equalizer frequency response graph displaying live parametric filter curves, measurements, and targets"
      >
        <p>Interactive frequency response graph displaying active parametric EQ filters and measurements.</p>
      </canvas>
      {editable && capabilities && peq.filters.slice(0, capabilities.num_bands).map((filter) => {
        if (!filter.enabled) return null;
        const [color, rgb] = filterColorVars(filter.index);
        const valueText = `${filter.freq} Hz, ${filter.gain >= 0 ? "+" : ""}${filter.gain.toFixed(1)} dB, Q ${filter.q.toFixed(2)}`;
        return (
          <button
            key={filter.index}
            type="button"
            data-filter-index={filter.index}
            className={`eq-filter-handle${activeBandIndex === filter.index ? " active" : ""}`}
            style={{
              "--filter-color": `var(${color})`,
              "--filter-color-rgb": `var(${rgb})`,
              left: `${freqToX(filter.freq, 100)}%`,
              top: `${dbToY(filter.gain, 100)}%`,
            } as CSSProperties}
            aria-label={`Band ${filter.index + 1}: ${valueText}. Drag or use arrow keys to adjust frequency and gain. Use the mouse wheel for gain or Shift plus mouse wheel for Q.`}
            aria-current={activeBandIndex === filter.index ? "true" : undefined}
            title={`Band ${filter.index + 1}: ${valueText} · Wheel: gain · Shift+wheel: Q`}
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              onActiveBandChange?.(filter.index);
              onStartChange?.();
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => void updateFromPointer(event, filter.index, filter)}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => void updateFromKeyboard(event, filter.index, filter)}
          >
            {filter.index + 1}
          </button>
        );
      })}
      {(committedPeq || targets.length > 0 || visibleMeasurements.length > 0) && (
        <button
          className={`mobile-legend-toggle ${showMobileLegend ? "active" : ""}`}
          onClick={() => setShowMobileLegend(!showMobileLegend)}
          title="Toggle legend"
          aria-label="Toggle legend"
          aria-expanded={showMobileLegend}
        >
          <Icon>{showMobileLegend ? "close" : "legend_toggle"}</Icon>
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
                  <line x1="0" y1="4" x2="24" y2="4" stroke="var(--blue)" strokeWidth="3" />
                </svg>
              </span>
              <span>EQ Curve</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = cssVar("--panel", "#16161e");
  ctx.fillRect(0, 0, width, height);
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const mono = cssVar("--font-mono", "ui-monospace");
  ctx.strokeStyle = cssVar("--canvas-grid", "rgba(65, 72, 104, 0.22)");
  ctx.lineWidth = 1;
  ctx.font = `500 12px ${mono}`;
  ctx.fillStyle = cssVar("--muted", "#787c99");

  for (const freq of GRAPH_FREQS) {
    const x = freqToX(freq, width);
    ctx.beginPath();
    ctx.moveTo(x, 18);
    ctx.lineTo(x, height - 18);
    ctx.stroke();
  }

  for (const db of GRAPH_DBS) {
    const y = dbToY(db, height);
    ctx.beginPath();
    ctx.moveTo(14, y);
    ctx.lineTo(width - 14, y);
    ctx.stroke();
    const labelY = y <= 12 ? y + 12 : y - 4;
    // Prevent drawing lowest dB label if it falls into bottom frequency label area
    if (labelY < height - 16) {
      ctx.fillText(`${db > 0 ? "+" : ""}${db}dB`, 14, labelY);
    }
  }

  const isNarrow = width < 540;
  const freqsToLabel = isNarrow
    ? [50, 200, 1000, 5000, 20000]
    : [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

  for (const freq of freqsToLabel) {
    const x = freqToX(freq, width);
    if (freq >= 20000) {
      ctx.textAlign = "right";
      ctx.fillText(formatFreq(freq), width - 8, height - 4);
      ctx.textAlign = "left";
    } else {
      ctx.fillText(formatFreq(freq), x + 4, height - 4);
    }
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
  interactiveHandles: boolean,
  dspSampleRate: number,
  isCurrent: () => boolean,
) {
  const freqs = getFreqGrid(width);
  const eqResponse = await responseValues(peq, freqs, viewMode, undefined, dspSampleRate);
  const enabledFilters = peq.filters.filter((filter) => filter.enabled);
  const bandResponses = await Promise.all(
    enabledFilters.map((band) => filterResponseValues(band, freqs, dspSampleRate)),
  );
  if (!isCurrent()) return;

  bandResponses.forEach((response, i) => {
    const [, rgbToken, fallback] = filterColorVars(enabledFilters[i].index);
    drawResponse(ctx, height, response, rgbWithAlpha(rgbToken, 0.22, fallback), 1);
  });

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
    for (let x = 0; x < eqResponse.length; x++) {
      ctx.lineTo(x, dbToY(eqResponse[x], height));
    }
    ctx.lineTo(width, zero);
    ctx.closePath();
    ctx.fillStyle = rgbWithAlpha("--blue-rgb", 0.15, "rgba(122, 162, 247, 0.15)");
    ctx.fill();

    drawResponse(ctx, height, eqResponse, cssVar("--blue", "#7aa2f7"), 3);
    await drawCommittedPreview(ctx, width, height, peq, committedPeq, selectedMeasurement, viewMode, dspSampleRate, isCurrent);
    if (!isCurrent()) return;
    if (!interactiveHandles) drawFilterDots(ctx, width, height, peq);
    return;
  }

  const measurementOffset = await shapeOffset(peq, viewMode, dspSampleRate);
  if (!isCurrent()) return;
  measurements.forEach((trace) => {
    drawResponse(ctx, height, measurementResponseValues(eqResponse, freqs, trace, measurementOffset), trace.color, 3);
  });
  await drawCommittedPreview(ctx, width, height, peq, committedPeq, selectedMeasurement, viewMode, dspSampleRate, isCurrent);
  if (!interactiveHandles) await drawFilterDotsWithMeasurement(ctx, width, height, peq, selectedMeasurement, viewMode, dspSampleRate, isCurrent);
}

async function drawCommittedPreview(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  peq: PEQData,
  committedPeq: PEQData | null | undefined,
  selectedMeasurement: MeasurementTrace | null,
  viewMode: GraphViewMode,
  dspSampleRate: number,
  isCurrent: () => boolean,
) {
  if (!committedPeq || peqEquals(committedPeq, peq)) {
    return;
  }

  const freqs = getFreqGrid(width);
  const values = await responseValues(committedPeq, freqs, viewMode, selectedMeasurement, dspSampleRate);
  if (!isCurrent()) return;
  const isCompact = width < 520;

  drawResponse(
    ctx,
    height,
    values,
    cssVar("--bg-dark", "#16161e"),
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

async function combinedResponseAt(peq: PEQData, freq: number, viewMode: GraphViewMode, dspSampleRate: number): Promise<number> {
  return (await peqResponseValues(peq, [freq], viewMode === "level", dspSampleRate))[0] ?? 0;
}

/** In shape view, curves are drawn relative to the 1 kHz response. */
async function shapeOffset(peq: PEQData, viewMode: GraphViewMode, dspSampleRate: number): Promise<number> {
  return viewMode === "shape" ? -(await combinedResponseAt(peq, 1000, "shape", dspSampleRate)) : 0;
}

async function responseValues(
  peq: PEQData,
  freqs: Float32Array | number[],
  viewMode: GraphViewMode,
  measurement?: MeasurementTrace | null,
  dspSampleRate = 96000,
): Promise<Float32Array> {
  const offset = measurement ? await shapeOffset(peq, viewMode, dspSampleRate) : 0;
  const eqValues = await peqResponseValues(peq, freqs, viewMode === "level", dspSampleRate);
  const result = new Float32Array(freqs.length);
  for (let index = 0; index < freqs.length; index++) {
    const freq = freqs[index];
    const db = (eqValues[index] ?? 0) + offset;
    const measured = measurement ? interpolateMeasurementDb(measurement.points, freq) : 0;
    const sum = db + measured;
    result[index] = Number.isFinite(sum) ? sum : 0;
  }
  return result;
}

function measurementResponseValues(
  eqResponse: ArrayLike<number>,
  freqs: ArrayLike<number>,
  measurement: MeasurementTrace,
  offset: number,
): Float32Array {
  const result = new Float32Array(eqResponse.length);
  for (let x = 0; x < eqResponse.length; x++) {
    result[x] = eqResponse[x] + interpolateMeasurementDb(measurement.points, freqs[x]) + offset;
  }
  return result;
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
  values: ArrayLike<number>,
  color: string,
  width = 1,
  dash: number[] = [],
) {
  ctx.beginPath();
  for (let x = 0; x < values.length; x++) {
    const y = dbToY(values[x], height);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
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
  const text = cssVar("--bg-dark", "#16161e");
  const stroke = cssVar("--panel", "#16161e");
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
  dspSampleRate: number,
  isCurrent: () => boolean,
) {
  if (!selectedMeasurement) {
    drawFilterDots(ctx, width, height, peq);
    return;
  }

  const activeBands = peq.filters.filter((filter) => filter.enabled);
  const freqs = activeBands.map((filter) => filter.freq);
  const measurementOffset = await shapeOffset(peq, viewMode, dspSampleRate);
  const eqValues = await peqResponseValues(peq, freqs, viewMode === "level", dspSampleRate);
  if (!isCurrent()) return;
  const dotValues = freqs.map((freq, index) =>
    (eqValues[index] ?? 0) + interpolateMeasurementDb(selectedMeasurement.points, freq) + measurementOffset
  );
  drawFilterDots(ctx, width, height, peq, dotValues);
}
