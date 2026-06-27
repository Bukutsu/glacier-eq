import { type ReactNode, useEffect, useState } from "react";
import type { Filter, FilterType, PEQData } from "../types";
import { Icon } from "./Icon";
import { Slider } from "./Slider";
import { NumberInput } from "./NumberInput";

const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const FREQ_SLIDER_STEPS = 1000;
const FILTER_TYPES: FilterType[] = ["Peak", "HighShelf", "LowShelf", "HighPass", "LowPass"];
const TYPE_LABELS: Record<FilterType, string> = {
  Peak: "PK",
  HighShelf: "HS",
  LowShelf: "LS",
  HighPass: "HP",
  LowPass: "LP",
};

interface BandsProps {
  peq: PEQData;
  onFilterChange: (index: number, filter: Filter) => void;
  onStartChange: () => void;
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

export function Bands({ peq, onFilterChange, onStartChange }: BandsProps) {
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem("glacier-bands-collapsed") === "true");

  useEffect(() => {
    localStorage.setItem("glacier-bands-collapsed", isCollapsed.toString());
  }, [isCollapsed]);
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
        <div className="param-cell freq-cell">
          <Slider
            aria-label={`Band ${filter.index + 1} frequency`}
            min={0}
            max={FREQ_SLIDER_STEPS}
            step={1}
            value={freqToSlider(filter.freq)}
            tone={filter.index >= 5 ? "orange" : "blue"}
            onMouseDown={onStartChange}
            onTouchStart={onStartChange}
            onChange={(event) => onChange({ ...filter, freq: sliderToFreq(+event.target.value) })}
          />
          <NumberInput
            value={filter.freq}
            min={FREQ_MIN}
            max={FREQ_MAX}
            step={50}
            precision={0}
            onFocus={onStartChange}
            onChange={(val) => onChange({ ...filter, freq: val })}
            className="band-freq-stepper"
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
            onMouseDown={onStartChange}
            onTouchStart={onStartChange}
            onChange={(event) => onChange({ ...filter, gain: +event.target.value })}
          />
          <NumberInput
            value={filter.gain}
            min={-10}
            max={10}
            step={0.1}
            precision={2}
            onFocus={onStartChange}
            onChange={(val) => onChange({ ...filter, gain: val })}
            className="band-gain-stepper"
          />
        </div>
      </BandField>
      <BandField label="Q" className="band-q-field">
        <div className="param-cell q-cell">
          <Slider
            aria-label={`Band ${filter.index + 1} Q`}
            min={0.1}
            max={20}
            step={0.05}
            value={filter.q}
            tone={filter.index >= 5 ? "orange" : "blue"}
            onMouseDown={onStartChange}
            onTouchStart={onStartChange}
            onChange={(event) => onChange({ ...filter, q: +event.target.value })}
          />
          <NumberInput
            value={filter.q}
            min={0.1}
            max={20}
            step={0.05}
            precision={2}
            onFocus={onStartChange}
            onChange={(val) => onChange({ ...filter, q: val })}
            className="band-q-stepper"
          />
        </div>
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
