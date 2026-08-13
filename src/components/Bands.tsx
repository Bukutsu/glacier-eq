import { memo, type CSSProperties, type ReactNode, useState } from "react";
import type { DeviceCapabilities, Filter, FilterType, PEQData } from "../types";
import { Icon } from "./Icon";
import { Slider } from "./Slider";
import { NumberInput } from "./NumberInput";
import { filterColorVars } from "../lib/filterColors";
import { formatFreq, snapFreqToIso } from "../lib/graph";
import { clampToRange } from "../lib/peq";

const FREQ_SLIDER_STEPS = 1000;
const Q_SLIDER_STEPS = 1000;
const TYPE_LABELS: Record<FilterType, string> = {
  Peak: "PK",
  HighShelf: "HS",
  LowShelf: "LS",
  HighPass: "HP",
  LowPass: "LP",
};

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
  capabilities: DeviceCapabilities;
  onFilterChange: (index: number, filter: Filter) => void;
  onStartChange: () => void;
  activeBandIndex?: number | null;
  onActiveBandChange?: (index: number) => void;
  snapToIso?: boolean;
}

function freqToSlider(freq: number, range: [number, number]) {
  const min = Math.log10(range[0]);
  const max = Math.log10(range[1]);
  return Math.round(((Math.log10(clampToRange(freq, range)) - min) / (max - min)) * FREQ_SLIDER_STEPS);
}

function sliderToFreq(value: number, range: [number, number]) {
  const min = Math.log10(range[0]);
  const max = Math.log10(range[1]);
  return Math.round(10 ** (min + (value / FREQ_SLIDER_STEPS) * (max - min)));
}

function qToSlider(q: number, range: [number, number]) {
  const min = Math.log10(range[0]);
  const max = Math.log10(range[1]);
  return Math.round(((Math.log10(clampToRange(q, range)) - min) / (max - min)) * Q_SLIDER_STEPS);
}

function sliderToQ(value: number, range: [number, number]) {
  const min = Math.log10(range[0]);
  const max = Math.log10(range[1]);
  return Number((10 ** (min + (value / Q_SLIDER_STEPS) * (max - min))).toFixed(2));
}

async function constrainFreq(freq: number, range: [number, number], snapToIso?: boolean) {
  const constrained = clampToRange(Math.round(freq), range);
  return clampToRange(snapToIso ? await snapFreqToIso(constrained) : constrained, range);
}

export const Bands = memo(function Bands({ peq, committedPeq, capabilities, onFilterChange, onStartChange, activeBandIndex, onActiveBandChange, snapToIso }: BandsProps) {
  const availableFilters = peq.filters.slice(0, capabilities.num_bands);
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
          <Icon>tune</Icon>
          <strong>FILTER BANDS</strong>
        </span>
        <span className="collapse-toggle-btn">
          {visibleFilters.length}/{availableFilters.length}
          <Icon>{collapsed ? "expand_more" : "expand_less"}</Icon>
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
              capabilities={capabilities}
              snapToIso={snapToIso}
            />
          ))}
          <div className="bands-actions">
            <button type="button" className="btn" onClick={addFilter} disabled={!canAddFilter}>
              <Icon>add</Icon>
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
                <span>{formatFreq(filter.freq)}</span>
              </button>
            ))}
            <button
              type="button"
              className="add-filter-chip"
              onClick={addFilter}
              disabled={!canAddFilter}
              aria-label="Add filter"
            >
              <Icon>add</Icon>
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
                <Icon>remove</Icon>
              </button>
            </div>
            <BandControls
              filter={selectedFilter}
              committedFilter={committedPeq?.filters[selectedFilter.index]}
              onChange={(updated) => onFilterChange(selectedFilter.index, updated)}
              onStartChange={onStartChange}
              onActivate={() => onActiveBandChange?.(selectedFilter.index)}
              capabilities={capabilities}
              snapToIso={snapToIso}
            />
          </div>
        </section>
      )}
    </div>
  );
});

function BandRow({
  filter,
  committedFilter,
  active,
  onChange,
  onStartChange,
  onActivate,
  canRemove,
  onRemove,
  capabilities,
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
  capabilities: DeviceCapabilities;
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
      <BandControls filter={filter} committedFilter={committedFilter} onChange={onChange} onStartChange={onStartChange} onActivate={onActivate} capabilities={capabilities} snapToIso={snapToIso} />
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
        <Icon>remove</Icon>
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
  capabilities,
  snapToIso,
}: {
  filter: Filter;
  committedFilter?: Filter;
  onChange: (filter: Filter) => void;
  onStartChange: () => void;
  onActivate: () => void;
  capabilities: DeviceCapabilities;
  snapToIso?: boolean;
}) {
  return (
    <>
      <BandField label="Type" className="band-type-field">
        <FilterTypeButtons
          filter={filter}
          supportedTypes={capabilities.supported_filter_types}
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
            value={freqToSlider(filter.freq, capabilities.freq_range)}
            onStartChange={onStartChange}
            onReset={committedFilter ? async () => onChange({ ...filter, freq: await constrainFreq(committedFilter.freq, capabilities.freq_range, snapToIso) }) : undefined}
            onFocus={onActivate}
            onChange={async (event) => {
              const raw = sliderToFreq(+event.target.value, capabilities.freq_range);
              onChange({ ...filter, freq: await constrainFreq(raw, capabilities.freq_range, snapToIso) });
            }}
          />
          <NumberInput
            value={clampToRange(filter.freq, capabilities.freq_range)}
            min={capabilities.freq_range[0]}
            max={capabilities.freq_range[1]}
            step={50}
            precision={0}
            onFocus={() => {
              onActivate();
              onStartChange();
            }}
            onChange={async (val) => onChange({ ...filter, freq: await constrainFreq(val, capabilities.freq_range, snapToIso) })}
            className="band-freq-stepper"
            aria-label={`Band ${filter.index + 1} frequency value`}
          />
        </div>
      </BandField>
      <BandField label="Gain" className="band-gain-field">
        <div className="gain-cell">
          <Slider
            aria-label={`Band ${filter.index + 1} gain`}
            min={capabilities.band_gain_range[0]}
            max={capabilities.band_gain_range[1]}
            step={0.01}
            value={clampToRange(filter.gain, capabilities.band_gain_range)}
            onStartChange={onStartChange}
            onReset={committedFilter ? () => onChange({ ...filter, gain: clampToRange(committedFilter.gain, capabilities.band_gain_range) }) : undefined}
            onFocus={onActivate}
            onChange={(event) => onChange({ ...filter, gain: +event.target.value })}
          />
          <NumberInput
            value={clampToRange(filter.gain, capabilities.band_gain_range)}
            min={capabilities.band_gain_range[0]}
            max={capabilities.band_gain_range[1]}
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
            value={qToSlider(filter.q, capabilities.q_range)}
            aria-valuemin={capabilities.q_range[0]}
            aria-valuemax={capabilities.q_range[1]}
            aria-valuenow={filter.q}
            aria-valuetext={`Q ${filter.q.toFixed(2)}`}
            onStartChange={onStartChange}
            onReset={committedFilter ? () => onChange({ ...filter, q: clampToRange(committedFilter.q, capabilities.q_range) }) : undefined}
            onFocus={onActivate}
            onChange={(event) => onChange({ ...filter, q: sliderToQ(+event.target.value, capabilities.q_range) })}
          />
          <NumberInput
            value={clampToRange(filter.q, capabilities.q_range)}
            min={capabilities.q_range[0]}
            max={capabilities.q_range[1]}
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

function FilterTypeButtons({ filter, supportedTypes, onChange }: { filter: Filter; supportedTypes: FilterType[]; onChange: (filter: Filter) => void }) {
  return (
    <div className="type-buttons">
      {supportedTypes.map((type) => (
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
