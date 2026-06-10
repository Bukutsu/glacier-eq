import { useCallback, useEffect, useRef } from "react";
import { bandResponse, dbToY, formatFreq, freqToX, xToFreq } from "../lib/graph";
import type { PEQData } from "../types";

const GRAPH_FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const GRAPH_DBS = [-15, -10, -5, 0, 5, 10, 15];

export function EqGraph({ peq }: { peq: PEQData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
    drawCurves(ctx, width, height, peq);
  }, [peq]);

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

  return <canvas className="eq-canvas" ref={canvasRef} />;
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#1f2335";
  ctx.fillRect(0, 0, width, height);
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono") || "ui-monospace";
  ctx.strokeStyle = "rgba(128, 128, 128, 0.20)";
  ctx.lineWidth = 1;
  ctx.font = `12px ${mono}`;
  ctx.fillStyle = "#a9b1d6";

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

function drawCurves(ctx: CanvasRenderingContext2D, width: number, height: number, peq: PEQData) {
  const combined = Array.from({ length: width }, (_, x) => {
    const freq = xToFreq(x, width);
    const total = peq.global_gain + peq.filters.reduce((sum, band) => sum + bandResponse(freq, band), 0);
    return Number.isFinite(total) ? total : 0;
  });

  for (const band of peq.filters.filter((filter) => filter.enabled)) {
    const response = Array.from({ length: width }, (_, x) => bandResponse(xToFreq(x, width), band));
    drawResponse(ctx, height, response, "rgba(125, 207, 255, 0.22)", 1);
  }

  const zero = dbToY(0, height);
  ctx.beginPath();
  ctx.moveTo(0, zero);
  combined.forEach((db, x) => ctx.lineTo(x, dbToY(db, height)));
  ctx.lineTo(width, zero);
  ctx.closePath();
  ctx.fillStyle = "rgba(125, 207, 255, 0.15)";
  ctx.fill();

  drawResponse(ctx, height, combined, "#7dcfff", 3);
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
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
