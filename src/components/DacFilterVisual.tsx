// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo, useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import {
  getFilterModeMeta,
  getFilterTimeData,
  getFilterFreqData,
} from "../lib/dacFilterModes";

type ViewDomain = "time" | "freq";

export const DacFilterVisual = memo(function DacFilterVisual({
  mode,
}: {
  mode: string;
}) {
  const [domain, setDomain] = useState<ViewDomain>("time");
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const meta = getFilterModeMeta(mode);

  const data = domain === "time" ? getFilterTimeData(mode) : getFilterFreqData(mode);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const width = el.clientWidth || 320;
    const height = 130;

    const isTime = domain === "time";
    const opts: uPlot.Options = {
      width,
      height,
      cursor: {
        drag: { x: false, y: false },
        points: { size: 6, width: 2 },
      },
      legend: { show: false },
      scales: {
        x: { time: false },
        y: isTime
          ? { auto: false, range: [-0.55, 1.15] }
          : { auto: false, range: [-65, 5] },
      },
      axes: [
        {
          stroke: "rgba(148, 163, 184, 0.7)",
          grid: {
            stroke: "rgba(255, 255, 255, 0.07)",
            width: 1,
            dash: [3, 3],
          },
          ticks: {
            stroke: "rgba(148, 163, 184, 0.4)",
            width: 1,
            size: 4,
          },
          font: "10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          values: isTime
            ? (_u, splits) => splits.map((v) => `${v > 0 ? "+" : ""}${v}ms`)
            : (_u, splits) => splits.map((v) => `${v}k`),
        },
        {
          stroke: "rgba(148, 163, 184, 0.7)",
          grid: {
            stroke: "rgba(255, 255, 255, 0.07)",
            width: 1,
            dash: [3, 3],
          },
          ticks: {
            stroke: "rgba(148, 163, 184, 0.4)",
            width: 1,
            size: 4,
          },
          font: "10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          size: 44,
          values: isTime
            ? (_u, splits) => splits.map((v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`)
            : (_u, splits) => splits.map((v) => `${v}dB`),
        },
      ],
      series: [
        {},
        {
          stroke: "#38bdf8",
          width: 2,
          fill: "rgba(56, 189, 248, 0.12)",
          points: { show: false },
        },
      ],
    };

    const plot = new uPlot(opts, data, el);
    plotRef.current = plot;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          plot.setSize({ width: Math.floor(entry.contentRect.width), height });
        }
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [domain]);

  // When mode changes within same domain, fast-path update without recreating uPlot instance
  useEffect(() => {
    if (plotRef.current) {
      plotRef.current.setData(data);
    }
  }, [data]);

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

      <div className="dac-filter-chart-wrapper" ref={containerRef} />

      <div className="dac-filter-footer">
        <span className="dac-filter-badge">{meta.badge}</span>
        <p className="dac-filter-desc">{meta.description}</p>
      </div>
    </div>
  );
});
