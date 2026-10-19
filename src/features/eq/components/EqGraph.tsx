import { useTranslation } from "react-i18next";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  Fragment,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  dbToY,
  formatFreq,
  freqToX,
  getFreqGrid,
  peqResponseAndBandValues,
  peqResponseValues,
  snapFreqToIsoSync,
  xToFreq,
  yToDb,
} from "@/features/eq/lib/graph";
import { cssVar, rgbWithAlpha } from "@/features/settings/lib/theme";
import {
  plotTraceColor,
  traceDisplayColor,
} from "@/features/traces/lib/traceColor";
import { useThemeVarsRevision } from "@/features/settings/hooks/useThemeVarsRevision";
import { interpolateMeasurementDb } from "@/features/traces/lib/measurements";
import { filterColorVars } from "@/features/eq/lib/filterColors";
import { peqEquals } from "@/features/eq/lib/peq";
import type {
  DeviceCapabilities,
  ResponseModel,
  Filter,
  GraphViewMode,
  MeasurementTrace,
  PEQData,
  TargetTrace,
} from "@/types";
import { Icon } from "@/components/ui/Icon";

/** CSSProperties has no index signature, so a custom property cannot typecheck
 * without a cast. Naming the shape once keeps that out of every call site. */
type CustomProperties = CSSProperties & Record<`--${string}`, string | number>;

const GRAPH_FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const GRAPH_DBS = [-18, -12, -6, 0, 6, 12, 18];

function graphDbLabels(height: number): number[] {
  // The ±18 dB lines sit on the plot edges, where a label cannot keep the
  // same placement as the others. The mobile graph is deliberately short,
  // so label only the center and the ±12 dB lines there.
  return height < 220 ? [-12, 0, 12] : [-12, -6, 0, 6, 12];
}

function clampHandlePosition(percent: number): string {
  // The handle is transformed around its center. Keep the full touch target
  // inside the graph when a band sits at the edge of the frequency/gain range.
  // eslint-disable-next-line i18next/no-literal-string -- CSS expression, not UI text.
  return `clamp(14px, ${percent}%, calc(100% - 14px))`;
}

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
  const { t } = useTranslation("editor");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const drawSerialRef = useRef(0);
  const pointerGestureRef = useRef<{
    x: number;
    y: number;
    q: number;
    freq: number;
    gain: number;
    shift: boolean;
    filter: Filter;
  } | null>(null);
  const wheelGestureRef = useRef<{ index: number; filter: Filter } | null>(
    null,
  );
  const wheelGestureTimerRef = useRef<number | undefined>(undefined);
  const wheelHandlerRef = useRef<(event: WheelEvent, index: number) => void>(
    () => {},
  );
  const editable = Boolean(
    capabilities && onActiveBandChange && onStartChange && onFilterChange,
  );
  // Repaint when theme CSS vars change outside React (Material You apply).
  const themeVarsRevision = useThemeVarsRevision();
  const visibleMeasurements = useMemo(
    () => measurements.filter((trace) => trace.visible),
    [measurements],
  );
  // A legend with only the EQ curve explains nothing.
  const hasLegend =
    targets.length > 0 ||
    visibleMeasurements.length > 0 ||
    (!!committedPeq && !peqEquals(committedPeq, peq));
  const selectedMeasurement = useMemo(() => {
    if (selectedMeasurementId) {
      return (
        measurements.find(
          (trace) => trace.id === selectedMeasurementId && trace.visible,
        ) ?? null
      );
    }
    return visibleMeasurements.length === 1 ? visibleMeasurements[0] : null;
  }, [measurements, selectedMeasurementId, visibleMeasurements]);
  const draw = useCallback(
    async (peqOverride?: PEQData) => {
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
        capabilities?.response_model ?? "CanonicalQ",
        () => drawSerial === drawSerialRef.current,
      );
      // Labels go on top so the curve never runs through them.
      if (drawSerial === drawSerialRef.current) drawDbLabels(ctx, height);
    },
    [
      peq,
      committedPeq,
      selectedMeasurement,
      visibleMeasurements,
      targets,
      viewMode,
      theme,
      themeVarsRevision,
      editable,
      capabilities?.dsp_sample_rate,
      capabilities?.response_model,
    ],
  );

  const displayPeqRef = useRef(peq);
  const targetPeqRef = useRef(peq);
  const fromPeqRef = useRef(peq);
  const fromTimeRef = useRef(0);
  const durationRef = useRef(DEFAULT_MOTION_MS);
  const animRafRef = useRef(0);
  const animationTokenRef = useRef(0);
  const animatingRef = useRef(false);
  const pendingRedrawRef = useRef(false);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const tick = useCallback((token: number) => {
    if (token !== animationTokenRef.current) return;

    const t =
      durationRef.current <= 0
        ? 1
        : Math.min(
            1,
            (performance.now() - fromTimeRef.current) / durationRef.current,
          );
    displayPeqRef.current = lerpPeq(
      fromPeqRef.current,
      targetPeqRef.current,
      easeOutCubic(t),
    );
    drawRef
      .current(displayPeqRef.current)
      .then(() => {
        if (token !== animationTokenRef.current) return;
        if (t < 1) {
          animRafRef.current = requestAnimationFrame(() => tick(token));
        } else {
          animatingRef.current = false;
          if (pendingRedrawRef.current) {
            // A non-PEQ change landed mid-animation; catch up now that the
            // animation is done.
            pendingRedrawRef.current = false;
            requestAnimationFrame(() => {
              void drawRef
                .current(displayPeqRef.current)
                .catch((error) =>
                  console.error("EqGraph redraw failed:", error),
                );
            });
          }
        }
      })
      .catch((err) => {
        console.error("EqGraph canvas draw failed:", err);
        animatingRef.current = false;
      });
  }, []);

  const beginAnim = useCallback(
    (next: PEQData) => {
      const token = ++animationTokenRef.current;
      targetPeqRef.current = next;
      fromPeqRef.current = displayPeqRef.current;
      fromTimeRef.current = performance.now();
      durationRef.current = Number(
        cssVar("--motion-duration-ms", String(DEFAULT_MOTION_MS)),
      );
      animatingRef.current = true;
      cancelAnimationFrame(animRafRef.current);
      animRafRef.current = requestAnimationFrame(() => tick(token));
    },
    [tick],
  );

  // Ease the EQ curve toward the latest PEQ whenever it changes.
  useEffect(() => {
    beginAnim(peq);
  }, [peq, beginAnim]);

  // Immediate redraw for non-PEQ changes (measurements, targets, view, theme).
  useEffect(() => {
    if (animatingRef.current) {
      // Don't race the running animation; tick() chains a trailing redraw.
      pendingRedrawRef.current = true;
      return;
    }
    const raf = requestAnimationFrame(() => {
      void drawRef
        .current(displayPeqRef.current)
        .catch((error) => console.error("EqGraph redraw failed:", error));
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
        void drawRef
          .current(displayPeqRef.current)
          .catch((error) =>
            console.error("EqGraph resize redraw failed:", error),
          );
      });
    });
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  // Cancel any in-flight animation frame on unmount.
  useEffect(
    () => () => {
      animationTokenRef.current++;
      cancelAnimationFrame(animRafRef.current);
      window.clearTimeout(wheelGestureTimerRef.current);
    },
    [],
  );

  const updateFromPointer = (
    event: PointerEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (
      !event.currentTarget.hasPointerCapture(event.pointerId) ||
      !capabilities ||
      !onFilterChange
    )
      return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;

    const gesture = pointerGestureRef.current;
    if (!gesture) return;
    if (event.shiftKey !== gesture.shift) {
      gesture.shift = event.shiftKey;
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      gesture.q = gesture.filter.q;
      gesture.freq = gesture.filter.freq;
      gesture.gain = gesture.filter.gain;
      return;
    }
    if (event.shiftKey) {
      // One octave of Q per 100 CSS pixels; keep frequency and gain fixed.
      const q = Number(
        Math.max(
          capabilities.q_range[0],
          Math.min(
            capabilities.q_range[1],
            gesture.q * 2 ** ((gesture.y - event.clientY) / 100),
          ),
        ).toFixed(2),
      );
      gesture.filter = { ...gesture.filter, q };
      onFilterChange(index, gesture.filter);
      return;
    }

    const rawFreq = Math.round(
      xToFreq(
        freqToX(gesture.freq, rect.width) + event.clientX - gesture.x,
        rect.width,
      ),
    );
    const snappedFreq = snapToIso ? snapFreqToIsoSync(rawFreq) : rawFreq;
    const freq = Math.max(
      capabilities.freq_range[0],
      Math.min(capabilities.freq_range[1], snappedFreq),
    );
    const gain = Number(
      Math.max(
        capabilities.band_gain_range[0],
        Math.min(
          capabilities.band_gain_range[1],
          yToDb(
            dbToY(gesture.gain, rect.height) + event.clientY - gesture.y,
            rect.height,
          ),
        ),
      ).toFixed(2),
    );
    gesture.filter = { ...gesture.filter, freq, gain };
    onFilterChange(index, gesture.filter);
  };

  const updateFromWheel = (
    event: WheelEvent,
    index: number,
    filter: Filter,
  ) => {
    if (!capabilities || !onFilterChange) return;
    const delta = event.deltaY || event.deltaX;
    if (!delta) return;

    event.preventDefault();
    event.stopPropagation();
    onActiveBandChange?.(index);

    const current =
      wheelGestureRef.current?.index === index
        ? wheelGestureRef.current.filter
        : filter;
    const direction = delta < 0 ? 1 : -1;
    const next = event.shiftKey
      ? {
          ...current,
          q: Number(
            Math.max(
              capabilities.q_range[0],
              Math.min(
                capabilities.q_range[1],
                current.q * 2 ** (direction / 12),
              ),
            ).toFixed(2),
          ),
        }
      : {
          ...current,
          gain: Number(
            Math.max(
              capabilities.band_gain_range[0],
              Math.min(
                capabilities.band_gain_range[1],
                current.gain + direction * 0.1,
              ),
            ).toFixed(2),
          ),
        };

    if (next.q === current.q && next.gain === current.gain) return;
    if (!wheelGestureRef.current || wheelGestureRef.current.index !== index)
      onStartChange?.();
    wheelGestureRef.current = { index, filter: next };
    window.clearTimeout(wheelGestureTimerRef.current);
    wheelGestureTimerRef.current = window.setTimeout(() => {
      wheelGestureRef.current = null;
    }, 250);
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
      const handle =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(".eq-filter-handle")
          : null;
      if (handle)
        wheelHandlerRef.current(event, Number(handle.dataset.filterIndex));
    };
    shell.addEventListener("wheel", handleWheel, { passive: false });
    return () => shell.removeEventListener("wheel", handleWheel);
  }, []);

  const updateFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    filter: Filter,
  ) => {
    if (
      !capabilities ||
      !onFilterChange ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    onActiveBandChange?.(index);
    if (!event.repeat) onStartChange?.();

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const scaled = Math.round(filter.freq * 2 ** (direction / 48));
      const stepped =
        direction < 0
          ? Math.min(scaled, filter.freq - 1)
          : Math.max(scaled, filter.freq + 1);
      let snapped = snapToIso ? snapFreqToIsoSync(stepped) : stepped;
      if (snapToIso) {
        // At an ISO center the ±1/48-octave step snaps straight back
        // (1000 → 1015 → 1000), leaving the band stuck; widen the step until
        // the snapped value actually moves.
        const current = snapFreqToIsoSync(filter.freq);
        let candidate = stepped;
        while (snapped === current) {
          const next = Math.round(candidate * 2 ** (direction / 48));
          const bounded =
            direction < 0
              ? Math.min(next, filter.freq - 1)
              : Math.max(next, filter.freq + 1);
          if (bounded === candidate) break; // pinned against the range edge
          candidate = bounded;
          snapped = snapFreqToIsoSync(candidate);
        }
      }
      const freq = Math.max(
        capabilities.freq_range[0],
        Math.min(capabilities.freq_range[1], snapped),
      );
      onFilterChange(index, { ...filter, freq });
      return;
    }

    const delta =
      (event.shiftKey ? 1 : 0.1) * (event.key === "ArrowUp" ? 1 : -1);
    const gain = Number(
      Math.max(
        capabilities.band_gain_range[0],
        Math.min(capabilities.band_gain_range[1], filter.gain + delta),
      ).toFixed(2),
    );
    onFilterChange(index, { ...filter, gain });
  };

  return (
    <div className={`eq-graph-layout${showMobileLegend ? " legend-open" : ""}`}>
      <div className="eq-graph-shell" ref={shellRef}>
        <canvas
          className="eq-canvas"
          ref={canvasRef}
          role="img"
          aria-label={t("graph.description")}
        >
          <p>{t("graph.description")}</p>
        </canvas>
        {editable &&
          capabilities &&
          peq.filters.slice(0, capabilities.num_bands).map((filter) => {
            if (!filter.enabled) return null;
            const [color, rgb] = filterColorVars(filter.index);
            const valueText = `${filter.freq} Hz, ${filter.gain >= 0 ? "+" : ""}${filter.gain.toFixed(1)} dB, Q ${filter.q.toFixed(2)}`;
            const handleStyle: CustomProperties = {
              "--filter-color": `var(${color})`,
              "--filter-color-rgb": `var(${rgb})`,
              left: clampHandlePosition(freqToX(filter.freq, 100)),
              top: clampHandlePosition(dbToY(filter.gain, 100)),
            };
            return (
              <button
                key={filter.index}
                type="button"
                data-filter-index={filter.index}
                className={`eq-filter-handle${activeBandIndex === filter.index ? " active" : ""}`}
                style={handleStyle}
                aria-label={t("graph.bandHelp", {
                  number: filter.index + 1,
                  value: valueText,
                })}
                aria-current={
                  activeBandIndex === filter.index ? "true" : undefined
                }
                title={t("graph.bandTooltip", {
                  number: filter.index + 1,
                  value: valueText,
                })}
                onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0) return;
                  onActiveBandChange?.(filter.index);
                  onStartChange?.();
                  pointerGestureRef.current = {
                    x: event.clientX,
                    y: event.clientY,
                    q: filter.q,
                    freq: filter.freq,
                    gain: filter.gain,
                    shift: event.shiftKey,
                    filter,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) =>
                  void updateFromPointer(event, filter.index)
                }
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onLostPointerCapture={() => {
                  pointerGestureRef.current = null;
                }}
                onKeyDown={(event) =>
                  void updateFromKeyboard(event, filter.index, filter)
                }
              >
                {filter.index + 1}
              </button>
            );
          })}
        {hasLegend && (
          <button
            type="button"
            className={`mobile-legend-toggle ${showMobileLegend ? "active" : ""}`}
            onClick={() => setShowMobileLegend(!showMobileLegend)}
            title={t("graph.toggleLegend")}
            aria-label={t("graph.toggleLegend")}
            aria-expanded={showMobileLegend}
          >
            <Icon name={showMobileLegend ? "close" : "legend_toggle"} />
          </button>
        )}
      </div>
      {hasLegend && (
        <div
          className={`graph-legend ${showMobileLegend ? "mobile-open" : ""}`}
        >
          {committedPeq && !peqEquals(committedPeq, peq) && (
            <div className="graph-legend-item committed">
              <span className="graph-legend-swatch">
                <svg
                  width="24"
                  height="8"
                  viewBox="0 0 24 8"
                  className="graph-legend-svg"
                >
                  <line
                    x1="0"
                    y1="4"
                    x2="24"
                    y2="4"
                    stroke="var(--bg-dark)"
                    strokeWidth="4"
                    strokeDasharray="6,4"
                  />
                  <line
                    x1="0"
                    y1="4"
                    x2="24"
                    y2="4"
                    stroke="var(--plot-orange)"
                    strokeWidth="2"
                    strokeDasharray="6,4"
                  />
                </svg>
              </span>
              <span>
                {selectedMeasurement
                  ? t("graph.lastWrittenMeasurement", {
                      name: selectedMeasurement.name,
                    })
                  : t("graph.lastWritten")}
              </span>
            </div>
          )}
          {targets.map((target) => (
            <div className="graph-legend-item target" key={target.id}>
              <span className="graph-legend-swatch">
                <svg
                  width="24"
                  height="8"
                  viewBox="0 0 24 8"
                  className="graph-legend-svg"
                >
                  <line
                    x1="0"
                    y1="4"
                    x2="24"
                    y2="4"
                    stroke={resolveColor(target.color)}
                    strokeWidth="2"
                    strokeDasharray="2,4"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <span>{target.name}</span>
            </div>
          ))}
          {visibleMeasurements.map((trace) => (
            <Fragment key={trace.id}>
              <div className="graph-legend-item">
                <span className="graph-legend-swatch">
                  <svg
                    width="24"
                    height="8"
                    viewBox="0 0 24 8"
                    className="graph-legend-svg"
                  >
                    <line
                      x1="0"
                      y1="4"
                      x2="24"
                      y2="4"
                      stroke={resolveColor(trace.color)}
                      strokeWidth="3"
                    />
                  </svg>
                </span>
                <span>{t("graph.eqApplied", { name: trace.name })}</span>
              </div>
              <div className="graph-legend-item raw">
                <span className="graph-legend-swatch">
                  <svg
                    width="24"
                    height="8"
                    viewBox="0 0 24 8"
                    className="graph-legend-svg"
                  >
                    <line
                      x1="0"
                      y1="4"
                      x2="24"
                      y2="4"
                      stroke={resolveColor(trace.color)}
                      strokeWidth="1.2"
                      strokeOpacity="0.44"
                    />
                  </svg>
                </span>
                <span className="raw-label">
                  {t("graph.raw", { name: trace.name })}
                </span>
              </div>
            </Fragment>
          ))}
          {visibleMeasurements.length === 0 && (
            <div className="graph-legend-item eq-curve">
              <span className="graph-legend-swatch">
                <svg
                  width="24"
                  height="8"
                  viewBox="0 0 24 8"
                  className="graph-legend-svg"
                >
                  <line
                    x1="0"
                    y1="4"
                    x2="24"
                    y2="4"
                    stroke="var(--plot-blue)"
                    strokeWidth="3"
                  />
                </svg>
              </span>
              <span>{t("graph.eqCurve")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = cssVar("--panel", "#16161e");
  ctx.fillRect(0, 0, width, height);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
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

function drawDbLabels(ctx: CanvasRenderingContext2D, height: number) {
  ctx.font = `500 12px ${cssVar("--font-mono", "ui-monospace")}`;
  const panel = cssVar("--panel", "#16161e");
  const text = cssVar("--muted", "#787c99");
  for (const db of graphDbLabels(height)) {
    const label = `${db > 0 ? "+" : ""}${db}dB`;
    const y = dbToY(db, height) - 4;
    // A solid backing keeps the label readable where the curve crosses it.
    ctx.fillStyle = panel;
    ctx.fillRect(12, y - 11, ctx.measureText(label).width + 4, 14);
    ctx.fillStyle = text;
    ctx.fillText(label, 14, y);
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
  responseModel: ResponseModel,
  isCurrent: () => boolean,
) {
  const freqs = getFreqGrid(width);
  const offset = await shapeOffset(peq, viewMode, dspSampleRate, responseModel);
  const combinedResponse = await peqResponseAndBandValues(
    peq,
    freqs,
    viewMode === "level",
    dspSampleRate,
    responseModel,
  );
  const enabledFilters = peq.filters.filter((filter) => filter.enabled);
  const eqResponse = new Float32Array(freqs.length);
  for (let index = 0; index < freqs.length; index++) {
    const value = (combinedResponse[index] ?? 0) + offset;
    eqResponse[index] = Number.isFinite(value) ? value : 0;
  }
  const bandResponses = enabledFilters.map((_, index) => {
    const start = (index + 1) * freqs.length;
    return combinedResponse.subarray(start, start + freqs.length);
  });
  if (!isCurrent()) return;

  bandResponses.forEach((response, i) => {
    const [, rgbToken, fallback] = filterColorVars(enabledFilters[i].index);
    drawResponse(
      ctx,
      height,
      response,
      rgbWithAlpha(rgbToken, 0.22, fallback),
      1,
    );
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
    ctx.fillStyle = rgbWithAlpha(
      "--plot-blue-rgb",
      0.15,
      "rgba(122, 162, 247, 0.15)",
    );
    ctx.fill();

    drawResponse(ctx, height, eqResponse, cssVar("--plot-blue", "#7aa2f7"), 3);
    await drawCommittedPreview(
      ctx,
      width,
      height,
      peq,
      committedPeq,
      selectedMeasurement,
      viewMode,
      dspSampleRate,
      responseModel,
      isCurrent,
    );
    if (!isCurrent()) return;
    if (!interactiveHandles) drawFilterDots(ctx, width, height, peq);
    return;
  }

  if (!isCurrent()) return;
  measurements.forEach((trace) => {
    // eqResponse already carries the shape offset from responseValues.
    drawResponse(
      ctx,
      height,
      measurementResponseValues(eqResponse, freqs, trace),
      trace.color,
      3,
    );
  });
  await drawCommittedPreview(
    ctx,
    width,
    height,
    peq,
    committedPeq,
    selectedMeasurement,
    viewMode,
    dspSampleRate,
    responseModel,
    isCurrent,
  );
  if (!interactiveHandles)
    await drawFilterDotsWithMeasurement(
      ctx,
      width,
      height,
      peq,
      selectedMeasurement,
      viewMode,
      dspSampleRate,
      responseModel,
      isCurrent,
    );
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
  responseModel: ResponseModel,
  isCurrent: () => boolean,
) {
  if (!committedPeq || peqEquals(committedPeq, peq)) {
    return;
  }

  const freqs = getFreqGrid(width);
  const values = await responseValues(
    committedPeq,
    freqs,
    viewMode,
    selectedMeasurement,
    dspSampleRate,
    responseModel,
  );
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
    cssVar("--plot-orange", "#ff9e64"),
    isCompact ? 1.5 : 2.5,
    [12, 6],
  );
}

async function combinedResponseAt(
  peq: PEQData,
  freq: number,
  viewMode: GraphViewMode,
  dspSampleRate: number,
  responseModel: ResponseModel,
): Promise<number> {
  return (
    (
      await peqResponseValues(
        peq,
        [freq],
        viewMode === "level",
        dspSampleRate,
        responseModel,
      )
    )[0] ?? 0
  );
}

/** In shape view, curves are drawn relative to the 1 kHz response. */
async function shapeOffset(
  peq: PEQData,
  viewMode: GraphViewMode,
  dspSampleRate: number,
  responseModel: ResponseModel,
): Promise<number> {
  return viewMode === "shape"
    ? -(await combinedResponseAt(
        peq,
        1000,
        "shape",
        dspSampleRate,
        responseModel,
      ))
    : 0;
}

async function responseValues(
  peq: PEQData,
  freqs: Float32Array | number[],
  viewMode: GraphViewMode,
  measurement?: MeasurementTrace | null,
  dspSampleRate = 96000,
  responseModel: ResponseModel = "CanonicalQ",
): Promise<Float32Array> {
  // The 1 kHz normalization applies to the EQ curve itself, so it must also
  // apply when no measurement traces are drawn.
  const offset = await shapeOffset(peq, viewMode, dspSampleRate, responseModel);
  const eqValues = await peqResponseValues(
    peq,
    freqs,
    viewMode === "level",
    dspSampleRate,
    responseModel,
  );
  const result = new Float32Array(freqs.length);
  for (let index = 0; index < freqs.length; index++) {
    const freq = freqs[index];
    const db = (eqValues[index] ?? 0) + offset;
    const measured = measurement
      ? interpolateMeasurementDb(measurement.points, freq)
      : 0;
    const sum = db + measured;
    result[index] = Number.isFinite(sum) ? sum : 0;
  }
  return result;
}

function measurementResponseValues(
  eqResponse: ArrayLike<number>,
  freqs: ArrayLike<number>,
  measurement: MeasurementTrace,
): Float32Array {
  const result = new Float32Array(eqResponse.length);
  for (let x = 0; x < eqResponse.length; x++) {
    result[x] =
      eqResponse[x] + interpolateMeasurementDb(measurement.points, freqs[x]);
  }
  return result;
}

function resolveColor(color: string): string {
  if (color.startsWith("var(")) {
    const varName = plotTraceColor(color).slice(4, -1);
    return cssVar(varName);
  }
  return traceDisplayColor(
    color,
    cssVar("--trace-color-neutral"),
    Number(cssVar("--trace-color-mix", "0")),
  );
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
  // eslint-disable-next-line i18next/no-literal-string -- CSS color, not UI text.
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
  const text = cssVar("--on-accent", "#11111b");
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
  responseModel: ResponseModel,
  isCurrent: () => boolean,
) {
  if (!selectedMeasurement) {
    drawFilterDots(ctx, width, height, peq);
    return;
  }

  const activeBands = peq.filters.filter((filter) => filter.enabled);
  const freqs = activeBands.map((filter) => filter.freq);
  const measurementOffset = await shapeOffset(
    peq,
    viewMode,
    dspSampleRate,
    responseModel,
  );
  const eqValues = await peqResponseValues(
    peq,
    freqs,
    viewMode === "level",
    dspSampleRate,
    responseModel,
  );
  if (!isCurrent()) return;
  const dotValues = freqs.map(
    (freq, index) =>
      (eqValues[index] ?? 0) +
      interpolateMeasurementDb(selectedMeasurement.points, freq) +
      measurementOffset,
  );
  drawFilterDots(ctx, width, height, peq, dotValues);
}
