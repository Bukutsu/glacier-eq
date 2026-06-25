import { useCallback, useEffect, useRef } from "react";
import { bandResponse, dbToY, formatFreq, freqToX, xToFreq } from "../lib/graph";
import { cssVar, rgbWithAlpha } from "../lib/theme";
import { interpolateMeasurementDb } from "../lib/measurements";
import type { GraphViewMode, MeasurementTrace, PEQData, TargetTrace } from "../types";

const GRAPH_FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const GRAPH_DBS = [-15, -10, -5, 0, 5, 10, 15];

export function EqGraph({
  peq,
  measurements,
  targets,
  viewMode,
  theme,
}: {
  peq: PEQData;
  measurements: MeasurementTrace[];
  targets: TargetTrace[];
  viewMode: GraphViewMode;
  theme?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visibleMeasurements = measurements.filter((trace) => trace.visible);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    if (width < 2 || height < 2) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground(ctx, width, height);
    drawGrid(ctx, width, height);
    drawCurves(ctx, width, height, peq, visibleMeasurements, targets, viewMode);
  }, [peq, visibleMeasurements, targets, viewMode, theme]);

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
      {(targets.length > 0 || visibleMeasurements.length > 0) && (
        <div className="graph-legend">
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
  measurements: MeasurementTrace[],
  targets: TargetTrace[],
  viewMode: GraphViewMode,
) {
  const eqResponse = Array.from({ length: width }, (_, x) => {
    const freq = xToFreq(x, width);
    const preamp = viewMode === "level" ? peq.global_gain : 0;
    const total = preamp + peq.filters.reduce((sum, band) => sum + bandResponse(freq, band), 0);
    return Number.isFinite(total) ? total : 0;
  });

  for (const band of peq.filters.filter((filter) => filter.enabled)) {
    const response = Array.from({ length: width }, (_, x) => bandResponse(xToFreq(x, width), band));
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
    return;
  }

  const eqAnchorOffset = viewMode === "shape" ? -combinedResponseAt(peq, 1000, "shape") : 0;
  measurements.forEach((trace) => {
    const adjusted = Array.from({ length: width }, (_, x) => {
      const freq = xToFreq(x, width);
      return interpolateMeasurementDb(trace.points, freq) + eqResponse[x] + eqAnchorOffset;
    });
    drawResponse(ctx, height, adjusted, trace.color, 3);
  });
}

function combinedResponseAt(peq: PEQData, freq: number, viewMode: GraphViewMode): number {
  const preamp = viewMode === "level" ? peq.global_gain : 0;
  return preamp + peq.filters.reduce((sum, band) => sum + bandResponse(freq, band), 0);
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
) {
  ctx.beginPath();
  values.forEach((db, x) => {
    const y = dbToY(db, height);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = resolveColor(color);
  ctx.lineWidth = width;
  ctx.stroke();
}
