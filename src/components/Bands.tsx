import { memo, type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import type { DeviceCapabilities, Filter, FilterType, PEQData } from "../types";
import { Icon } from "./Icon";
import { Slider } from "./Slider";
import { NumberInput } from "./NumberInput";
import { filterColorVars } from "../lib/filterColors";
import { formatFreq, snapFreqToIsoSync } from "../lib/graph";
import { clampToRange } from "../lib/peq";

const FREQ_SLIDER_STEPS = 1000;
const Q_SLIDER_STEPS = 1000;
const TYPE_NAMES: Record<FilterType, string> = {
  Peak: "Bell",
  HighShelf: "High Shelf",
  LowShelf: "Low Shelf",
  HighPass: "High Pass",
  LowPass: "Low Pass",
};

const TYPE_ABBREVIATIONS: Record<FilterType, string> = {
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
  onEndChange?: () => void;
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

function constrainFreq(freq: number, range: [number, number], snapToIso?: boolean) {
  const constrained = clampToRange(Math.round(freq), range);
  return clampToRange(snapToIso ? snapFreqToIsoSync(constrained) : constrained, range);
}

/** Steps frequency along the (optionally ISO-snapped) grid with guaranteed
 *  progress: snapping can cancel a plain ±step at an ISO center
 *  (1000 + 50 → snap → 1000), so advance until the snapped value moves. */
function makeFreqStepper(
  filter: Filter,
  range: [number, number],
  snapToIso: boolean | undefined,
  onChange: (index: number, filter: Filter) => void,
) {
  return (direction: 1 | -1, largeStep: boolean) => {
    const stepSize = largeStep ? 500 : 50;
    const current = snapToIso ? snapFreqToIsoSync(filter.freq) : filter.freq;
    let candidate = filter.freq + direction * stepSize;
    let snapped = constrainFreq(candidate, range, snapToIso);
    let guard = 0;
    while (snapped === current && candidate >= range[0] && candidate <= range[1] && guard++ < 400) {
      candidate += direction * stepSize;
      snapped = constrainFreq(candidate, range, snapToIso);
    }
    if (snapped !== filter.freq) {
      onChange(filter.index, { ...filter, freq: snapped });
    }
  };
}

export const Bands = memo(function Bands({ peq, committedPeq, capabilities, onFilterChange, onStartChange, onEndChange, activeBandIndex, onActiveBandChange, snapToIso }: BandsProps) {
  const availableFilters = peq.filters.slice(0, capabilities.num_bands);
  const visibleFilters = availableFilters.filter((filter) => filter.enabled);
  const canAddFilter = visibleFilters.length < availableFilters.length;
  const selectedFilter = visibleFilters.find((filter) => filter.index === activeBandIndex) ?? visibleFilters[0];
  const [collapsed, setCollapsed] = useState(false);
  const [removedFilter, setRemovedFilter] = useState<Filter | null>(null);
  const bandPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedFilter) return;
    const picker = bandPickerRef.current;
    const chip = picker?.querySelector<HTMLElement>(`[data-band-index="${selectedFilter.index}"]`);
    if (!picker || !chip) return;

    const chipStart = chip.offsetLeft;
    const chipEnd = chipStart + chip.offsetWidth;
    if (chipStart < picker.scrollLeft) {
      picker.scrollTo({ left: chipStart });
    } else if (chipEnd > picker.scrollLeft + picker.clientWidth) {
      picker.scrollTo({ left: chipEnd - picker.clientWidth });
    }
  }, [selectedFilter?.index]);

  useEffect(() => {
    if (removedFilter === null) return;
    const timer = window.setTimeout(() => setRemovedFilter(null), 5000);
    return () => window.clearTimeout(timer);
  }, [removedFilter]);
  const addFilter = () => {
    const next = availableFilters.find((filter) => !filter.enabled);
    if (!next) return;
    setRemovedFilter(null);
    onActiveBandChange?.(next.index);
    onStartChange();
    onFilterChange(next.index, { ...next, enabled: true });
    onEndChange?.();
  };

  return (
    <div className={`bands-container${collapsed ? " collapsed" : ""}`}>
      <button
        type="button"
        className="bands-section-header"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
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
              onChange={onFilterChange}
              onStartChange={onStartChange}
              onEndChange={onEndChange}
              onActivate={onActiveBandChange}
              canRemove={visibleFilters.length > 1}
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
          <div className="band-picker" role="group" aria-label="Filter bands">
            <div className="band-picker-scroll" ref={bandPickerRef}>
              {visibleFilters.map((filter) => (
                <button
                  key={filter.index}
                  type="button"
                  data-band-index={filter.index}
                  style={filterColorStyle(filter.index)}
                  className={filter.index === selectedFilter.index ? "active" : ""}
                  aria-pressed={filter.index === selectedFilter.index}
                  onClick={() => onActiveBandChange?.(filter.index)}
                >
                  <strong>{filter.index + 1}</strong>
                  <span>{formatFreq(filter.freq)}</span>
                </button>
              ))}
            </div>
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
              <div className="mobile-filter-summary">
                <strong>Band {selectedFilter.index + 1}</strong>
                <span>{selectedFilter.freq} Hz · {selectedFilter.gain.toFixed(2)} dB · Q {selectedFilter.q.toFixed(2)}</span>
              </div>
              <div className="mobile-filter-actions">
                {committedPeq?.filters[selectedFilter.index] && (
                  <button
                    type="button"
                    className="mobile-filter-reset"
                    aria-label={`Reset band ${selectedFilter.index + 1} to last saved values`}
                    onClick={() => {
                      const committed = committedPeq.filters[selectedFilter.index];
                      onStartChange();
                      onFilterChange(selectedFilter.index, { ...committed, index: selectedFilter.index, enabled: true });
                      onEndChange?.();
                    }}
                  >
                    <Icon>restart_alt</Icon>
                    <span>Reset</span>
                  </button>
                )}
                <button
                  type="button"
                  className="band-index"
                  aria-label={`Remove band ${selectedFilter.index + 1}`}
                  disabled={visibleFilters.length <= 1}
                  onClick={() => {
                    if (visibleFilters.length <= 1) return;
                    const removedIndex = selectedFilter.index;
                    onStartChange();
                    onFilterChange(removedIndex, { ...selectedFilter, enabled: false });
                    onEndChange?.();
                    setRemovedFilter(selectedFilter);
                    const next = visibleFilters.find((filter) => filter.index !== removedIndex);
                    if (next) onActiveBandChange?.(next.index);
                  }}
                >
                  <Icon>delete</Icon>
                </button>
              </div>
            </div>
            <BandControls
              filter={selectedFilter}
              committedFilter={committedPeq?.filters[selectedFilter.index]}
              onChange={onFilterChange}
              onStartChange={onStartChange}
              onEndChange={onEndChange}
              onActivate={onActiveBandChange}
              capabilities={capabilities}
              snapToIso={snapToIso}
            />
          </div>
          {removedFilter !== null && (
            <div className="band-undo-toast" role="status" aria-live="polite">
              <span>Band {removedFilter.index + 1} removed</span>
              <button
                type="button"
                onClick={() => {
                  onStartChange();
                  onFilterChange(removedFilter.index, { ...removedFilter, enabled: true });
                  onEndChange?.();
                  onActiveBandChange?.(removedFilter.index);
                  setRemovedFilter(null);
                }}
              >
                Undo
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
});

type BandRowProps = {
  filter: Filter;
  committedFilter?: Filter;
  active: boolean;
  onChange: (index: number, filter: Filter) => void;
  onStartChange: () => void;
  onEndChange?: () => void;
  onActivate?: (index: number) => void;
  canRemove: boolean;
  capabilities: DeviceCapabilities;
  snapToIso?: boolean;
};

const BandRow = memo(function BandRow({
  filter,
  committedFilter,
  active,
  onChange,
  onStartChange,
  onEndChange,
  onActivate,
  canRemove,
  capabilities,
  snapToIso,
}: BandRowProps) {
  return (
    <div
      className={`band-row ${filter.enabled ? "" : "muted"} ${active ? "active" : ""}`}
      role="group"
      aria-label={`Band ${filter.index + 1}`}
      style={filterColorStyle(filter.index)}
    >
      <div className="band-number" aria-hidden="true">{filter.index + 1}</div>
      <BandControls filter={filter} committedFilter={committedFilter} onChange={onChange} onStartChange={onStartChange} onEndChange={onEndChange} onActivate={onActivate} capabilities={capabilities} snapToIso={snapToIso} />
      <button
        type="button"
        className="band-index"
        aria-label={`Remove band ${filter.index + 1}`}
        disabled={!canRemove}
        onClick={() => {
          if (!canRemove) return;
          onActivate?.(filter.index);
          onStartChange();
          onChange(filter.index, { ...filter, enabled: false });
          onEndChange?.();
        }}
      >
        <Icon>remove</Icon>
      </button>
    </div>
  );
}, (previous, next) => (
  previous.filter === next.filter &&
  previous.committedFilter === next.committedFilter &&
  previous.active === next.active &&
  previous.canRemove === next.canRemove &&
  previous.capabilities === next.capabilities &&
  previous.snapToIso === next.snapToIso &&
  previous.onChange === next.onChange &&
  previous.onStartChange === next.onStartChange &&
  previous.onEndChange === next.onEndChange &&
  previous.onActivate === next.onActivate
));

type BandControlsProps = {
  filter: Filter;
  committedFilter?: Filter;
  onChange: (index: number, filter: Filter) => void;
  onStartChange: () => void;
  onEndChange?: () => void;
  onActivate?: (index: number) => void;
  capabilities: DeviceCapabilities;
  snapToIso?: boolean;
};

const BandControls = memo(function BandControls({
  filter,
  committedFilter,
  onChange,
  onStartChange,
  onEndChange,
  onActivate,
  capabilities,
  snapToIso,
}: BandControlsProps) {
  return (
    <>
      <BandField label="Type" className="band-type-field">
        <FilterTypeButtons
          filter={filter}
          supportedTypes={capabilities.supported_filter_types}
          onChange={(updated) => {
            onActivate?.(filter.index);
            onStartChange();
            onChange(filter.index, updated);
            onEndChange?.();
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
            aria-valuemin={capabilities.freq_range[0]}
            aria-valuemax={capabilities.freq_range[1]}
            aria-valuenow={filter.freq}
            aria-valuetext={`${filter.freq} Hz`}
            onStartChange={onStartChange}
            onEndChange={onEndChange}
            onReset={committedFilter ? () => onChange(filter.index, { ...filter, freq: constrainFreq(committedFilter.freq, capabilities.freq_range, snapToIso) }) : undefined}
            onFocus={() => onActivate?.(filter.index)}
            onChange={(event) => {
              const raw = sliderToFreq(+event.target.value, capabilities.freq_range);
              onChange(filter.index, { ...filter, freq: constrainFreq(raw, capabilities.freq_range, snapToIso) });
            }}
          />
          <NumberInput
            value={clampToRange(filter.freq, capabilities.freq_range)}
            min={capabilities.freq_range[0]}
            max={capabilities.freq_range[1]}
            step={50}
            precision={0}
            onFocus={() => {
              onActivate?.(filter.index);
              onStartChange();
            }}
            onBlur={onEndChange}
            onChange={(val) => onChange(filter.index, { ...filter, freq: constrainFreq(val, capabilities.freq_range, snapToIso) })}
            onStep={makeFreqStepper(filter, capabilities.freq_range, snapToIso, onChange)}
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
            aria-valuetext={`${filter.gain >= 0 ? "+" : ""}${filter.gain.toFixed(2)} dB`}
            onStartChange={onStartChange}
            onEndChange={onEndChange}
            onReset={committedFilter ? () => onChange(filter.index, { ...filter, gain: clampToRange(committedFilter.gain, capabilities.band_gain_range) }) : undefined}
            onFocus={() => onActivate?.(filter.index)}
            onChange={(event) => onChange(filter.index, { ...filter, gain: +event.target.value })}
          />
          <NumberInput
            value={clampToRange(filter.gain, capabilities.band_gain_range)}
            min={capabilities.band_gain_range[0]}
            max={capabilities.band_gain_range[1]}
            step={0.1}
            precision={2}
            onFocus={() => {
              onActivate?.(filter.index);
              onStartChange();
            }}
            onBlur={onEndChange}
            onChange={(val) => onChange(filter.index, { ...filter, gain: val })}
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
            onEndChange={onEndChange}
            onReset={committedFilter ? () => onChange(filter.index, { ...filter, q: clampToRange(committedFilter.q, capabilities.q_range) }) : undefined}
            onFocus={() => onActivate?.(filter.index)}
            onChange={(event) => onChange(filter.index, { ...filter, q: sliderToQ(+event.target.value, capabilities.q_range) })}
          />
          <NumberInput
            value={clampToRange(filter.q, capabilities.q_range)}
            min={capabilities.q_range[0]}
            max={capabilities.q_range[1]}
            step={0.05}
            precision={2}
            onFocus={() => {
              onActivate?.(filter.index);
              onStartChange();
            }}
            onBlur={onEndChange}
            onChange={(val) => onChange(filter.index, { ...filter, q: val })}
            className="band-q-stepper"
            aria-label={`Band ${filter.index + 1} Q value`}
          />
        </div>
      </BandField>
    </>
  );
}, (previous, next) => (
  previous.filter === next.filter &&
  previous.committedFilter === next.committedFilter &&
  previous.capabilities === next.capabilities &&
  previous.snapToIso === next.snapToIso &&
  previous.onChange === next.onChange &&
  previous.onActivate === next.onActivate &&
  previous.onStartChange === next.onStartChange &&
  previous.onEndChange === next.onEndChange
));

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
    <div className={`type-buttons type-buttons-${supportedTypes.length}`}>
      {supportedTypes.map((type) => (
        <button
          type="button"
          key={type}
          className={filter.filter_type === type ? "selected" : ""}
          aria-pressed={filter.filter_type === type}
          aria-label={`Set band ${filter.index + 1} to ${TYPE_NAMES[type]}`}
          onClick={() => onChange({ ...filter, filter_type: type })}
        >
          <span className="type-label-short" aria-hidden="true">{TYPE_ABBREVIATIONS[type]}</span>
          <span className="type-label-long" aria-hidden="true">{TYPE_NAMES[type]}</span>
        </button>
      ))}
    </div>
  );
}
