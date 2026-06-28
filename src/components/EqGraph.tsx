import { useCallback, useEffect, useRef } from "react";
import { bandResponse, dbToY, formatFreq, freqToX, xToFreq } from "../lib/graph";
import { cssVar, rgbWithAlpha } from "../lib/theme";
import { interpolateMeasurementDb } from "../lib/measurements";
import { filterColorVars } from "../lib/filterColors";
import type { GraphViewMode, MeasurementTrace, PEQData, TargetTrace } from "../types";

const GRAPH_FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const GRAPH_DBS = [-15, -10, -5, 0, 5, 10, 15];
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visibleMeasurements = measurements.filter((trace) => trace.visible);
  const selectedMeasurement = selectedMeasurementId
    ? measurements.find((trace) => trace.id === selectedMeasurementId && trace.visible) ?? null
    : visibleMeasurements.length === 1
      ? visibleMeasurements[0]
      : null;
  const draw = useCallback(() => {
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
    drawCurves(
      ctx,
      width,
      height,
      peq,
      committedPeq,
      selectedMeasurement,
      visibleMeasurements,
      targets,
      viewMode,
    );
  }, [peq, committedPeq, selectedMeasurement, visibleMeasurements, targets, viewMode, theme]);

  useEffect(() => {
    let raf = requestAnimationFrame(draw);
    const canvas = canvasRef.current;
    if (!canvas) return () => cancelAnimationFrame(raf);

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    });
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [draw]);

  return (
    <div className="eq-graph-shell">
      <canvas className="eq-canvas" ref={canvasRef} />
      {(committedPeq || targets.length > 0 || visibleMeasurements.length > 0) && (
        <div className="graph-legend">
          {committedPeq && JSON.stringify(committedPeq) !== JSON.stringify(peq) && (
            <div className="graph-legend-item committed">
              <span className="graph-legend-swatch graph-legend-swatch-dashed" />
              <span>{selectedMeasurement ? `Last pushed + ${selectedMeasurement.name}` : "Last pushed"}</span>
            </div>
          )}
          {targets.map((target) => (
            <div className="graph-legend-item target" key={target.id}>
              <span className="graph-legend-swatch" style={{ backgroundColor: target.color }} />
              <span>{target.name}</span>
            </div>
          ))}
          {visibleMeasurements.map((trace) => (
            <div className="graph-legend-item" key={trace.id}>
              <span className="graph-legend-swatch" style={{ backgroundColor: trace.color }} />
              <span>{trace.name}</span>
            </div>
          ))}
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

function drawCurves(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  peq: PEQData,
  committedPeq: PEQData | null | undefined,
  selectedMeasurement: MeasurementTrace | null,
  measurements: MeasurementTrace[],
  targets: TargetTrace[],
  viewMode: GraphViewMode,
) {
  const freqs = Array.from({ length: width }, (_, x) => xToFreq(x, width));
  const eqResponse = responseValues(peq, freqs, viewMode);

  for (const band of peq.filters.filter((filter) => filter.enabled)) {
    const response = freqs.map((freq) => bandResponse(freq, band));
    drawResponse(ctx, height, response, rgbWithAlpha("--cyan-rgb", 0.22, "rgba(125, 207, 255, 0.22)"), 1);
  }

  for (const target of targets) {
    drawTrace(ctx, width, height, target, 1.6, [2, 6]);
  }

  for (const trace of measurements) {
    drawTrace(ctx, width, height, trace, 1.2, [8, 6], withAlpha(trace.color, 0.44));
  }

  if (measurements.length === 0) {
    const zero = dbToY(0, height);
    ctx.beginPath();
    ctx.moveTo(0, zero);
    eqResponse.forEach((db, x) => ctx.lineTo(x, dbToY(db, height)));
    ctx.lineTo(width, zero);
    ctx.closePath();
    ctx.fillStyle = rgbWithAlpha("--cyan-rgb", 0.15, "rgba(125, 207, 255, 0.15)");
    ctx.fill();

    drawResponse(ctx, height, eqResponse, cssVar("--cyan", "#7dcfff"), 3);
    drawCommittedPreview(ctx, width, height, peq, committedPeq, selectedMeasurement, viewMode);
    drawFilterDots(ctx, width, height, peq, null, viewMode);
    return;
  }

  const measurementOffset = viewMode === "shape" ? -combinedResponseAt(peq, 1000, "shape") : 0;
  measurements.forEach((trace) => {
    drawResponse(ctx, height, measurementResponseValues(eqResponse, freqs, trace, measurementOffset), trace.color, 3);
  });
  drawCommittedPreview(ctx, width, height, peq, committedPeq, selectedMeasurement, viewMode);
  drawFilterDots(ctx, width, height, peq, selectedMeasurement, viewMode);
}

function drawCommittedPreview(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  peq: PEQData,
  committedPeq: PEQData | null | undefined,
  selectedMeasurement: MeasurementTrace | null,
  viewMode: GraphViewMode,
) {
  if (!committedPeq || JSON.stringify(committedPeq) === JSON.stringify(peq)) {
    return;
  }

  const freqs = Array.from({ length: width }, (_, x) => xToFreq(x, width));
  const values = responseValues(committedPeq, freqs, viewMode, selectedMeasurement);
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

function combinedResponseAt(peq: PEQData, freq: number, viewMode: GraphViewMode): number {
  const preamp = viewMode === "level" ? peq.global_gain : 0;
  return preamp + peq.filters.reduce((sum, band) => sum + bandResponse(freq, band), 0);
}

function responseAt(
  peq: PEQData,
  freq: number,
  viewMode: GraphViewMode,
  measurement?: MeasurementTrace | null,
  offset = 0,
): number {
  const db = combinedResponseAt(peq, freq, viewMode) + offset;
  const measured = measurement ? interpolateMeasurementDb(measurement.points, freq) : 0;
  return Number.isFinite(db + measured) ? db + measured : 0;
}

function responseValues(
  peq: PEQData,
  freqs: number[],
  viewMode: GraphViewMode,
  measurement?: MeasurementTrace | null,
): number[] {
  const offset = measurement && viewMode === "shape" ? -combinedResponseAt(peq, 1000, "shape") : 0;
  return freqs.map((freq) => responseAt(peq, freq, viewMode, measurement, offset));
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
  selectedMeasurement: MeasurementTrace | null,
  viewMode: GraphViewMode,
) {
  const text = cssVar("--bg-dark", "#1a1b26");
  const stroke = cssVar("--panel", "#24283b");
  const activeBands = peq.filters.filter((filter) => filter.enabled);
  const measurementOffset = selectedMeasurement && viewMode === "shape"
    ? -combinedResponseAt(peq, 1000, "shape")
    : 0;

  activeBands.forEach((filter) => {
    const x = freqToX(filter.freq, width);
    const dotDb = selectedMeasurement
      ? responseAt(peq, filter.freq, viewMode, selectedMeasurement, measurementOffset)
      : filter.gain;
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
