import { FILTER_TYPES, TYPE_LABELS } from "../constants";
import type { Filter, PEQData } from "../types";

interface BandsProps {
  peq: PEQData;
  onFilterChange: (index: number, filter: Filter) => void;
}

export function Bands({ peq, onFilterChange }: BandsProps) {
  const columns = [peq.filters.slice(0, 5), peq.filters.slice(5)];
  return (
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
            />
          ))}
        </div>
      ))}
    </section>
  );
}

function BandRow({ filter, onChange }: { filter: Filter; onChange: (filter: Filter) => void }) {
  return (
    <div className={`band-row ${filter.enabled ? "" : "muted"}`}>
      <button className="band-index" onClick={() => onChange({ ...filter, enabled: !filter.enabled })}>
        {filter.index + 1}
      </button>
      <FilterTypeButtons filter={filter} onChange={onChange} />
      <input
        className="num-input freq"
        value={filter.freq}
        onChange={(event) => onChange({ ...filter, freq: +event.target.value || 20 })}
      />
      <div className="gain-cell">
        <input
          type="range"
          min={-10}
          max={10}
          step={0.01}
          value={filter.gain}
          onChange={(event) => onChange({ ...filter, gain: +event.target.value })}
        />
        <input
          className="num-input gain"
          value={filter.gain.toFixed(2)}
          onChange={(event) => onChange({ ...filter, gain: +event.target.value || 0 })}
        />
      </div>
      <input
        className="num-input q"
        value={filter.q.toFixed(2)}
        onChange={(event) => onChange({ ...filter, q: +event.target.value || 0.1 })}
      />
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
          onClick={() => onChange({ ...filter, filter_type: type })}
        >
          {TYPE_LABELS[type]}
        </button>
      ))}
    </div>
  );
}
