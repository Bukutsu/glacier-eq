// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo } from "react";
import { getFilterModeInfo } from "../lib/dacFilterModes";

export const DacFilterVisual = memo(function DacFilterVisual({
  mode,
}: {
  mode: string;
}) {
  const info = getFilterModeInfo(mode);

  return (
    <div className="dac-filter-card" aria-label={`Filter mode: ${mode}`}>
      <div className="dac-filter-graph-frame">
        <svg
          className="dac-filter-svg"
          viewBox="0 0 160 44"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* Zero baseline */}
          <line x1="0" y1="22" x2="160" y2="22" className="dac-filter-baseline" />
          {/* Impulse response waveform */}
          <path d={info.path} className="dac-filter-curve" />
        </svg>
        <div className="dac-filter-badge">{info.badge}</div>
      </div>
      <div className="dac-filter-meta">
        <span className="dac-filter-tag">{info.tag}</span>
        <p className="dac-filter-desc">{info.description}</p>
      </div>
    </div>
  );
});
