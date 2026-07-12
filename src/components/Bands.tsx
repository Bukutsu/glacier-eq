import { type CSSProperties, type ReactNode, useState } from "react";
import type { Filter, FilterType, PEQData } from "../types";
import { Slider } from "./Slider";
import { NumberInput } from "./NumberInput";
import { filterColorVars } from "../lib/filterColors";
import initWasm, { snap_freq_to_iso } from "../wasm_pkg/glacier_core";

const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const FREQ_SLIDER_STEPS = 1000;
const Q_MIN = 0.1;
const Q_MAX = 20;
const Q_SLIDER_STEPS = 1000;
const FILTER_TYPES: FilterType[] = ["Peak", "HighShelf", "LowShelf", "HighPass", "LowPass"];
const TYPE_LABELS: Record<FilterType, string> = {
  Peak: "PK",
  HighShelf: "HS",
  LowShelf: "LS",
  HighPass: "HP",
  LowPass: "LP",
};

let wasmReady: Promise<unknown> | null = null;

async function snapToIsoFreq(freq: number): Promise<number> {
  wasmReady ??= initWasm();
  await wasmReady;
  return snap_freq_to_iso(freq);
}

function filterColorStyle(index: number) {
  const [color, rgb] = filterColorVars(index);
  return {
    "--filter-color": `var(${color})`,
    "--filter-color-rgb": `var(${rgb})`,
  } as CSSProperties;
}

interface BandsProps {
  peq: PEQData;
  committedPeq?: PEQData | null;
  maxBands: number;
  onFilterChange: (index: number, filter: Filter) => void;
  onStartChange: () => void;
  activeBandIndex?: number | null;
  onActiveBandChange?: (index: number) => void;
  snapToIso?: boolean;
}

function freqToSlider(freq: number) {
  const min = Math.log10(FREQ_MIN);
  const max = Math.log10(FREQ_MAX);
  return Math.round(((Math.log10(Math.max(FREQ_MIN, Math.min(FREQ_MAX, freq))) - min) / (max - min)) * FREQ_SLIDER_STEPS);
}

function sliderToFreq(value: number) {
  const min = Math.log10(FREQ_MIN);
  const max = Math.log10(FREQ_MAX);
  return Math.round(10 ** (min + (value / FREQ_SLIDER_STEPS) * (max - min)));
}

function qToSlider(q: number) {
  const min = Math.log10(Q_MIN);
  const max = Math.log10(Q_MAX);
  const clamped = Math.max(Q_MIN, Math.min(Q_MAX, q));
  return Math.round(((Math.log10(clamped) - min) / (max - min)) * Q_SLIDER_STEPS);
}

function sliderToQ(value: number) {
  const min = Math.log10(Q_MIN);
  const max = Math.log10(Q_MAX);
  return Number((10 ** (min + (value / Q_SLIDER_STEPS) * (max - min))).toFixed(2));
}

export function Bands({ peq, committedPeq, maxBands, onFilterChange, onStartChange, activeBandIndex, onActiveBandChange, snapToIso }: BandsProps) {
  const availableFilters = peq.filters.slice(0, maxBands);
  const visibleFilters = availableFilters.filter((filter) => filter.enabled);
  const canAddFilter = visibleFilters.length < availableFilters.length;
  const selectedFilter = visibleFilters.find((filter) => filter.index === activeBandIndex) ?? visibleFilters[0];
  const [collapsed, setCollapsed] = useState(false);
  const addFilter = () => {
    const next = availableFilters.find((filter) => !filter.enabled);
    if (!next) return;
    onActiveBandChange?.(next.index);
    onStartChange();
    onFilterChange(next.index, { ...next, enabled: true });
  };

  return (
    <div className={`bands-container${collapsed ? " collapsed" : ""}`}>
      <button
        type="button"
        className="bands-section-header"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand filter bands" : "Collapse filter bands"}
      >
        <span className="title-text">
          <span className="material-symbols-outlined">tune</span>
          <strong>FILTER BANDS</strong>
        </span>
        <span className="collapse-toggle-btn">
          {visibleFilters.length}/{availableFilters.length}
          <span className="material-symbols-outlined">{collapsed ? "expand_more" : "expand_less"}</span>
        </span>
      </button>
      <section className="bands-grid">
        <div className="bands-card">
          {visibleFilters.map((filter) => (
            <BandRow
              key={filter.index}
              filter={filter}
              committedFilter={committedPeq?.filters[filter.index]}
              active={activeBandIndex === filter.index}
              onChange={(updated) => onFilterChange(filter.index, updated)}
              onStartChange={onStartChange}
              onActivate={() => onActiveBandChange?.(filter.index)}
              canRemove={visibleFilters.length > 1}
              onRemove={() => onFilterChange(filter.index, { ...filter, enabled: false })}
              snapToIso={snapToIso}
            />
          ))}
          <div className="bands-actions">
            <button type="button" className="btn" onClick={addFilter} disabled={!canAddFilter}>
              <span className="material-symbols-outlined">add</span>
              Add Filter
            </button>
          </div>
        </div>
      </section>
      {selectedFilter && (
        <section className="bands-mobile-editor">
          <div className="band-picker" aria-label="Filter bands">
            {visibleFilters.map((filter) => (
              <button
                key={filter.index}
                type="button"
                style={filterColorStyle(filter.index)}
                className={filter.index === selectedFilter.index ? "active" : ""}
                onClick={() => onActiveBandChange?.(filter.index)}
              >
                <strong>{filter.index + 1}</strong>
                <span>{TYPE_LABELS[filter.filter_type]}</span>
              </button>
            ))}
            <button
              type="button"
              className="add-filter-chip"
              onClick={addFilter}
              disabled={!canAddFilter}
              aria-label="Add filter"
            >
              <span className="material-symbols-outlined">add</span>
              <span>Add</span>
            </button>
          </div>
          <div className="mobile-filter-card" style={filterColorStyle(selectedFilter.index)}>
            <div className="mobile-filter-head">
              <div>
                <strong>Band {selectedFilter.index + 1}</strong>
                <span>{selectedFilter.freq} Hz · {selectedFilter.gain.toFixed(2)} dB · Q {selectedFilter.q.toFixed(2)}</span>
              </div>
              <button
                className="band-index"
                aria-label={`Remove band ${selectedFilter.index + 1}`}
                disabled={visibleFilters.length <= 1}
                onClick={() => {
                  if (visibleFilters.length <= 1) return;
                  onStartChange();
                  onFilterChange(selectedFilter.index, { ...selectedFilter, enabled: false });
                  const next = visibleFilters.find((filter) => filter.index !== selectedFilter.index);
                  if (next) onActiveBandChange?.(next.index);
                }}
              >
                <span className="material-symbols-outlined">remove</span>
              </button>
            </div>
            <BandControls
              filter={selectedFilter}
              committedFilter={committedPeq?.filters[selectedFilter.index]}
              onChange={(updated) => onFilterChange(selectedFilter.index, updated)}
              onStartChange={onStartChange}
              onActivate={() => onActiveBandChange?.(selectedFilter.index)}
              snapToIso={snapToIso}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function BandRow({
  filter,
  committedFilter,
  active,
  onChange,
  onStartChange,
  onActivate,
  canRemove,
  onRemove,
  snapToIso,
}: {
  filter: Filter;
  committedFilter?: Filter;
  active: boolean;
  onChange: (filter: Filter) => void;
  onStartChange: () => void;
  onActivate: () => void;
  canRemove: boolean;
  onRemove: () => void;
  snapToIso?: boolean;
}) {
  return (
    <div
      className={`band-row ${filter.enabled ? "" : "muted"} ${active ? "active" : ""}`}
      role="group"
      aria-label={`Band ${filter.index + 1}`}
      style={filterColorStyle(filter.index)}
    >
      <div className="band-number" aria-hidden="true">{filter.index + 1}</div>
      <BandControls filter={filter} committedFilter={committedFilter} onChange={onChange} onStartChange={onStartChange} onActivate={onActivate} snapToIso={snapToIso} />
      <button
        type="button"
        className="band-index"
        aria-label={`Remove band ${filter.index + 1}`}
        disabled={!canRemove}
        onClick={() => {
          if (!canRemove) return;
          onActivate();
          onStartChange();
          onRemove();
        }}
      >
        <span className="material-symbols-outlined">remove</span>
      </button>
    </div>
  );
}

function BandControls({
  filter,
  committedFilter,
  onChange,
  onStartChange,
  onActivate,
  snapToIso,
}: {
  filter: Filter;
  committedFilter?: Filter;
  onChange: (filter: Filter) => void;
  onStartChange: () => void;
  onActivate: () => void;
  snapToIso?: boolean;
}) {
  return (
    <>
      <BandField label="Type" className="band-type-field">
        <FilterTypeButtons
          filter={filter}
          onChange={(updated) => {
            onActivate();
            onStartChange();
            onChange(updated);
          }}
        />
      </BandField>
      <BandField label="Freq" className="band-freq-field">
        <div className="param-cell freq-cell">
          <Slider
            aria-label={`Band ${filter.index + 1} frequency`}
            min={0}
            max={FREQ_SLIDER_STEPS}
            step={5}
            value={freqToSlider(filter.freq)}
            tone={filter.index >= 5 ? "orange" : "blue"}
            onStartChange={onStartChange}
            onReset={committedFilter ? () => onChange({ ...filter, freq: committedFilter.freq }) : undefined}
            onFocus={onActivate}
            onChange={async (event) => {
              const raw = sliderToFreq(+event.target.value);
              onChange({ ...filter, freq: snapToIso ? await snapToIsoFreq(raw) : raw });
            }}
          />
          <NumberInput
            value={filter.freq}
            min={FREQ_MIN}
            max={FREQ_MAX}
            step={50}
            precision={0}
            onFocus={() => {
              onActivate();
              onStartChange();
            }}
            onChange={async (val) => onChange({ ...filter, freq: snapToIso ? await snapToIsoFreq(val) : val })}
            className="band-freq-stepper"
            aria-label={`Band ${filter.index + 1} frequency value`}
          />
        </div>
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
            onStartChange={onStartChange}
            onReset={committedFilter ? () => onChange({ ...filter, gain: committedFilter.gain }) : undefined}
            onFocus={onActivate}
            onChange={(event) => onChange({ ...filter, gain: +event.target.value })}
          />
          <NumberInput
            value={filter.gain}
            min={-10}
            max={10}
            step={0.1}
            precision={2}
            onFocus={() => {
              onActivate();
              onStartChange();
            }}
            onChange={(val) => onChange({ ...filter, gain: val })}
            className="band-gain-stepper"
            aria-label={`Band ${filter.index + 1} gain value`}
          />
        </div>
      </BandField>
      <BandField label="Q" className="band-q-field">
        <div className="param-cell q-cell">
          <Slider
            aria-label={`Band ${filter.index + 1} Q`}
            min={0}
            max={Q_SLIDER_STEPS}
            step={1}
            value={qToSlider(filter.q)}
            aria-valuemin={Q_MIN}
            aria-valuemax={Q_MAX}
            aria-valuenow={filter.q}
            aria-valuetext={`Q ${filter.q.toFixed(2)}`}
            tone={filter.index >= 5 ? "orange" : "blue"}
            onStartChange={onStartChange}
            onReset={committedFilter ? () => onChange({ ...filter, q: committedFilter.q }) : undefined}
            onFocus={onActivate}
            onChange={(event) => onChange({ ...filter, q: sliderToQ(+event.target.value) })}
          />
          <NumberInput
            value={filter.q}
            min={0.1}
            max={20}
            step={0.05}
            precision={2}
            onFocus={() => {
              onActivate();
              onStartChange();
            }}
            onChange={(val) => onChange({ ...filter, q: val })}
            className="band-q-stepper"
            aria-label={`Band ${filter.index + 1} Q value`}
          />
        </div>
      </BandField>
    </>
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
    <div className={`band-field ${className ?? ""}`.trim()} role="group" aria-label={label}>
      <span className="band-field-label">{label}</span>
      {children}
    </div>
  );
}

function FilterTypeButtons({ filter, onChange }: { filter: Filter; onChange: (filter: Filter) => void }) {
  return (
    <div className="type-buttons">
      {FILTER_TYPES.map((type) => (
        <button
          type="button"
          key={type}
          className={filter.filter_type === type ? "selected" : ""}
          aria-pressed={filter.filter_type === type}
          aria-label={`Set band ${filter.index + 1} to ${TYPE_LABELS[type]}`}
          onClick={() => onChange({ ...filter, filter_type: type })}
        >
          {TYPE_LABELS[type]}
        </button>
      ))}
    </div>
  );
}
