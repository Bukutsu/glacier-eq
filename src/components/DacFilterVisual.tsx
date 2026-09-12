// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cssVar, rgbWithAlpha } from "../lib/theme";
import { useThemeVarsRevision } from "../lib/materialYou";
import {
  getFilterModeMeta,
  getFilterTimeCurve,
  getFilterFreqCurve,
  lerpCurve,
  TIME_RANGE_MS,
  FREQ_RANGE_KHZ,
  DEFAULT_POINTS,
} from "../lib/dacFilterModes";

type ViewDomain = "time" | "freq";

const ANIM_DURATION_MS = 160;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export const DacFilterVisual = memo(function DacFilterVisual({
  mode,
}: {
  mode: string;
}) {
  const [domain, setDomain] = useState<ViewDomain>("time");
  const [hoverInfo, setHoverInfo] = useState<{ xLabel: string; yLabel: string } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const meta = getFilterModeMeta(mode);

  // Animation state refs
  const targetCurveRef = useRef<Float32Array>(getFilterTimeCurve(mode, DEFAULT_POINTS));
  const displayCurveRef = useRef<Float32Array>(getFilterTimeCurve(mode, DEFAULT_POINTS));
  const fromCurveRef = useRef<Float32Array>(getFilterTimeCurve(mode, DEFAULT_POINTS));
  const animStartTimeRef = useRef(0);
  const animRafRef = useRef(0);
  const isAnimatingRef = useRef(false);
  const hoverFractionRef = useRef<number | null>(null);

  const getTarget = useCallback((m: string, d: ViewDomain) => {
    return d === "time" ? getFilterTimeCurve(m, DEFAULT_POINTS) : getFilterFreqCurve(m, DEFAULT_POINTS);
  }, []);

  // Repaint when theme CSS vars change outside React (Material You apply).
  const themeVarsRevision = useThemeVarsRevision();

  const draw = useCallback((curve: Float32Array) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = container.clientWidth || 320;
    const height = 136;
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
    ctx.clearRect(0, 0, width, height);

    // Fill background matching EqGraph
    const panelBg = cssVar("--panel", "#16161e");
    ctx.fillStyle = panelBg;
    ctx.fillRect(0, 0, width, height);

    const padLeft = 40;
    const padRight = 14;
    const padTop = 14;
    const padBottom = 22;

    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const isTime = domain === "time";

    // Value to Y coordinate
    const valToY = (val: number) => {
      if (isTime) {
        // Time domain range: [-0.5, 1.1]
        const norm = (val - (-0.5)) / (1.1 - (-0.5));
        return padTop + plotH * (1 - norm);
      } else {
        // Freq domain range: [-60, 0] dB
        const norm = (val - (-60)) / (0 - (-60));
        return padTop + plotH * (1 - norm);
      }
    };

    const mono = cssVar("--font-mono", "ui-monospace");
    const gridColor = cssVar("--canvas-grid", "rgba(65, 72, 104, 0.22)");
    const mutedColor = cssVar("--muted", "#787c99");
    const curveColor = cssVar("--cyan", "#7dcfff");

    // ── 1. Draw Grid and Axes (matches EqGraph style) ─────────────────────────
    ctx.save();
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.font = `500 10px ${mono}`;
    ctx.fillStyle = mutedColor;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const yTicks = isTime ? [1.0, 0.5, 0.0, -0.5] : [0, -12, -24, -36, -48, -60];
    for (const yVal of yTicks) {
      const y = valToY(yVal);
      ctx.beginPath();
      if (yVal === 0) {
        ctx.strokeStyle = cssVar("--line-soft", "rgba(255, 255, 255, 0.15)");
      } else {
        ctx.strokeStyle = gridColor;
      }
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();

      const label = isTime ? `${yVal > 0 ? "+" : ""}${yVal.toFixed(1)}` : `${yVal}dB`;
      ctx.fillText(label, padLeft - 6, y);
    }

    ctx.strokeStyle = gridColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    if (isTime) {
      const [startMs, endMs] = TIME_RANGE_MS;
      const xTicks = [-0.6, -0.3, 0.0, 0.3, 0.6];
      for (const tVal of xTicks) {
        const xNorm = (tVal - startMs) / (endMs - startMs);
        const x = padLeft + plotW * xNorm;

        ctx.beginPath();
        if (tVal === 0.0) {
          ctx.strokeStyle = cssVar("--line-soft", "rgba(255, 255, 255, 0.15)");
        } else {
          ctx.strokeStyle = gridColor;
        }
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + plotH);
        ctx.stroke();

        const label = `${tVal > 0 ? "+" : ""}${tVal.toFixed(1)}ms`;
        ctx.fillText(label, x, padTop + plotH + 4);
      }
    } else {
      const [startKhz, endKhz] = FREQ_RANGE_KHZ;
      const xTicks = [10, 14, 18, 20, 22, 24];
      for (const fVal of xTicks) {
        const xNorm = (fVal - startKhz) / (endKhz - startKhz);
        const x = padLeft + plotW * xNorm;

        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + plotH);
        ctx.stroke();

        ctx.fillText(`${fVal}k`, x, padTop + plotH + 4);
      }
    }
    ctx.restore();

    // ── 2. Draw Area Fill & Clean Trace (No Glow) ────────────────────────────
    const numPoints = curve.length;
    if (numPoints > 1) {
      const baseY = valToY(isTime ? 0 : -60);

      // Area fill
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < numPoints; i++) {
        const x = padLeft + plotW * (i / (numPoints - 1));
        const y = valToY(curve[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(padLeft + plotW, baseY);
      ctx.lineTo(padLeft, baseY);
      ctx.closePath();

      const fillColor = rgbWithAlpha("--cyan-rgb", 0.1, "#7dcfff");
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.restore();

      // Clean trace line
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < numPoints; i++) {
        const x = padLeft + plotW * (i / (numPoints - 1));
        const y = valToY(curve[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = curveColor;
      ctx.lineWidth = 1.75;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();

      // Center impulse marker in time mode (matches EqGraph filter dot style)
      if (isTime) {
        const centerIdx = Math.floor(numPoints / 2);
        const centerX = padLeft + plotW * 0.5;
        const centerY = valToY(curve[centerIdx]);

        ctx.beginPath();
        ctx.arc(centerX, centerY, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = curveColor;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = panelBg;
        ctx.stroke();
      }
    }

    // ── 3. Hover Crosshair Cursor ─────────────────────────────────────────────
    if (hoverFractionRef.current !== null) {
      const frac = hoverFractionRef.current;
      const hoverX = padLeft + plotW * frac;
      const sampleIdx = Math.min(numPoints - 1, Math.max(0, Math.round(frac * (numPoints - 1))));
      const hoverY = valToY(curve[sampleIdx]);

      ctx.save();
      ctx.strokeStyle = cssVar("--line-soft", "rgba(255, 255, 255, 0.2)");
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);

      ctx.beginPath();
      ctx.moveTo(hoverX, padTop);
      ctx.lineTo(hoverX, padTop + plotH);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(hoverX, hoverY, 3, 0, Math.PI * 2);
      ctx.fillStyle = curveColor;
      ctx.fill();
      ctx.restore();
    }
  }, [domain, themeVarsRevision]);

  // Smooth animation loop when curve changes (mode switch or domain switch)
  const animateTo = useCallback((nextCurve: Float32Array) => {
    targetCurveRef.current = nextCurve;
    fromCurveRef.current = displayCurveRef.current;
    animStartTimeRef.current = performance.now();
    isAnimatingRef.current = true;

    if (animRafRef.current) {
      cancelAnimationFrame(animRafRef.current);
    }

    const tick = (now: number) => {
      const elapsed = now - animStartTimeRef.current;
      const t = Math.min(1, elapsed / ANIM_DURATION_MS);
      const eased = easeOutCubic(t);

      const interpolated = lerpCurve(fromCurveRef.current, targetCurveRef.current, eased);
      displayCurveRef.current = interpolated;
      draw(interpolated);

      if (t < 1) {
        animRafRef.current = requestAnimationFrame(tick);
      } else {
        isAnimatingRef.current = false;
        displayCurveRef.current = targetCurveRef.current;
        draw(targetCurveRef.current);
      }
    };

    animRafRef.current = requestAnimationFrame(tick);
  }, [draw]);

  useEffect(() => {
    const target = getTarget(mode, domain);
    animateTo(target);

    return () => {
      if (animRafRef.current) cancelAnimationFrame(animRafRef.current);
    };
  }, [mode, domain, getTarget, animateTo]);

  // Handle pointer hover / touch over the canvas
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = canvas.getBoundingClientRect();
    const width = container.clientWidth || 320;
    const padLeft = 40;
    const padRight = 14;
    const plotW = width - padLeft - padRight;

    const clientX = e.clientX - rect.left;
    const clampedX = Math.max(padLeft, Math.min(padLeft + plotW, clientX));
    const fraction = (clampedX - padLeft) / plotW;
    hoverFractionRef.current = fraction;

    const curve = displayCurveRef.current;
    const numPoints = curve.length;
    const idx = Math.min(numPoints - 1, Math.max(0, Math.round(fraction * (numPoints - 1))));
    const val = curve[idx];

    if (domain === "time") {
      const [startMs, endMs] = TIME_RANGE_MS;
      const t = startMs + fraction * (endMs - startMs);
      setHoverInfo({
        xLabel: `${t > 0 ? "+" : ""}${t.toFixed(2)} ms`,
        yLabel: `${val > 0 ? "+" : ""}${val.toFixed(2)}`,
      });
    } else {
      const [startKhz, endKhz] = FREQ_RANGE_KHZ;
      const f = startKhz + fraction * (endKhz - startKhz);
      setHoverInfo({
        xLabel: `${f.toFixed(1)} kHz`,
        yLabel: `${val.toFixed(1)} dB`,
      });
    }

    draw(displayCurveRef.current);
  };

  const handlePointerLeave = () => {
    hoverFractionRef.current = null;
    setHoverInfo(null);
    draw(displayCurveRef.current);
  };

  // ResizeObserver to smoothly resize canvas
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      draw(displayCurveRef.current);
    });
    ro.observe(el);

    return () => ro.disconnect();
  }, [draw]);

  return (
    <div className="dac-filter-card" aria-label={`Filter mode: ${mode}`}>
      <div className="dac-filter-header">
        <span className="dac-filter-title">{meta.name}</span>
        <div className="dac-filter-toggle" role="group" aria-label="Graph domain">
          <button
            type="button"
            className={`dac-filter-tab ${domain === "time" ? "active" : ""}`}
            onClick={() => setDomain("time")}
          >
            Impulse (Time)
          </button>
          <button
            type="button"
            className={`dac-filter-tab ${domain === "freq" ? "active" : ""}`}
            onClick={() => setDomain("freq")}
          >
            Roll-off (Freq)
          </button>
        </div>
      </div>

      <div className="dac-filter-chart-wrapper" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="dac-filter-canvas"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        />
        {hoverInfo && (
          <div className="dac-filter-hover-pill">
            <span>{hoverInfo.xLabel}</span>
            <span className="dac-filter-hover-val">{hoverInfo.yLabel}</span>
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
