import { type ReactNode, useState } from "react";
import { FILTER_TYPES, TYPE_LABELS } from "../constants";
import type { Filter, PEQData } from "../types";
import { Icon } from "./Icon";
import { Slider } from "./Slider";

interface BandsProps {
  peq: PEQData;
  onFilterChange: (index: number, filter: Filter) => void;
  onStartChange: () => void;
}

export function Bands({ peq, onFilterChange, onStartChange }: BandsProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const columns = [peq.filters.slice(0, 5), peq.filters.slice(5)];

  return (
    <div className="bands-container">
      <button
        className="bands-section-header"
        type="button"
        aria-expanded={!isCollapsed}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <span className="title-text">
          <Icon>tune</Icon>
          <strong>FILTER BANDS</strong>
        </span>
        <span className="collapse-toggle-btn" aria-hidden="true">
          <Icon>{isCollapsed ? "expand_more" : "expand_less"}</Icon>
        </span>
      </button>
      {!isCollapsed && (
        <section className="bands-grid">
          {columns.map((bands, columnIndex) => (
            <div className="bands-card" key={columnIndex}>
              <div className="bands-header">
                <span>BAND</span><span>TYPE</span><span>FREQ (Hz)</span><span>GAIN (dB)</span><span>Q</span>
              </div>
              {bands.map((filter) => (
                <BandRow
                  key={filter.index}
                  filter={filter}
                  onChange={(updated) => onFilterChange(filter.index, updated)}
                  onStartChange={onStartChange}
                />
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function BandRow({
  filter,
  onChange,
  onStartChange,
}: {
  filter: Filter;
  onChange: (filter: Filter) => void;
  onStartChange: () => void;
}) {
  return (
    <div className={`band-row ${filter.enabled ? "" : "muted"}`}>
      <button
        className="band-index"
        aria-label={`${filter.enabled ? "Disable" : "Enable"} band ${filter.index + 1}`}
        onClick={() => {
          onStartChange();
          onChange({ ...filter, enabled: !filter.enabled });
        }}
      >
        <span className="band-index-label">Band</span>
        <strong>{filter.index + 1}</strong>
      </button>
      <BandField label="Type" className="band-type-field">
        <FilterTypeButtons
          filter={filter}
          onChange={(updated) => {
            onStartChange();
            onChange(updated);
          }}
        />
      </BandField>
      <BandField label="Freq" className="band-freq-field">
        <input
          className="num-input freq"
          aria-label={`Band ${filter.index + 1} frequency`}
          inputMode="numeric"
          value={filter.freq}
          onFocus={onStartChange}
          onChange={(event) => onChange({ ...filter, freq: +event.target.value || 20 })}
        />
      </BandField>
      <BandField label="Gain" className="band-gain-field">
        <div className="gain-cell">
          <Slider
            aria-label={`Band ${filter.index + 1} gain`}
            min={-10}
            max={10}
            step={0.01}
            value={filter.gain}
            tone={filter.index >= 5 ? "orange" : "blue"}
            onMouseDown={onStartChange}
            onTouchStart={onStartChange}
            onChange={(event) => onChange({ ...filter, gain: +event.target.value })}
          />
          <input
            className="num-input gain"
            aria-label={`Band ${filter.index + 1} gain value`}
            inputMode="decimal"
            value={filter.gain.toFixed(2)}
            onFocus={onStartChange}
            onChange={(event) => onChange({ ...filter, gain: +event.target.value || 0 })}
          />
        </div>
      </BandField>
      <BandField label="Q" className="band-q-field">
        <input
          className="num-input q"
          aria-label={`Band ${filter.index + 1} Q`}
          inputMode="decimal"
          value={filter.q.toFixed(2)}
          onFocus={onStartChange}
          onChange={(event) => onChange({ ...filter, q: +event.target.value || 0.1 })}
        />
      </BandField>
    </div>
  );
}

function BandField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`band-field ${className ?? ""}`.trim()} data-label={label}>
      {children}
    </div>
  );
}

function FilterTypeButtons({ filter, onChange }: { filter: Filter; onChange: (filter: Filter) => void }) {
  return (
    <div className="type-buttons">
      {FILTER_TYPES.map((type) => (
        <button
          key={type}
          className={filter.filter_type === type ? "selected" : ""}
          aria-label={`Set band ${filter.index + 1} to ${TYPE_LABELS[type]}`}
          onClick={() => onChange({ ...filter, filter_type: type })}
        >
          {TYPE_LABELS[type]}
        </button>
      ))}
    </div>
  );
}
