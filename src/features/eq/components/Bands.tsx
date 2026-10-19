import { useTranslation } from "react-i18next";
import {
  memo,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import type { DeviceCapabilities, Filter, FilterType, PEQData } from "@/types";
import { Icon } from "@/components/ui/Icon";
import { Slider } from "@/components/ui/Slider";
import { NumberInput } from "@/components/ui/NumberInput";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { filterColorVars } from "@/features/eq/lib/filterColors";
import { formatFreq, snapFreqToIsoSync } from "@/features/eq/lib/graph";
import { bandForAdd, clampToRange } from "@/features/eq/lib/peq";

const FREQ_SLIDER_STEPS = 1000;
const Q_SLIDER_STEPS = 1000;
const TYPE_NAMES = {
  Peak: "bands.types.Peak",
  HighShelf: "bands.types.HighShelf",
  LowShelf: "bands.types.LowShelf",
  HighPass: "bands.types.HighPass",
  LowPass: "bands.types.LowPass",
} as const satisfies Record<FilterType, string>;

/** CSSProperties has no index signature, so a custom property cannot typecheck
 * without a cast. Naming the shape once keeps that out of every call site. */
type CustomProperties = CSSProperties & Record<`--${string}`, string | number>;

function filterColorStyle(index: number): CustomProperties {
  const [color, rgb] = filterColorVars(index);
  return {
    "--filter-color": `var(${color})`,
    "--filter-color-rgb": `var(${rgb})`,
  };
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
  /**
   * Set while a device operation is in flight. The handlers below drop the
   * edit in that state, so the controls have to say so — a slider that
   * looks live and quietly ignores the drag is worse than one that is
   * visibly inert.
   */
  disabled?: boolean;
  isMobile?: boolean;
}

function freqToSlider(freq: number, range: [number, number]) {
  const min = Math.log10(range[0]);
  const max = Math.log10(range[1]);
  return Math.round(
    ((Math.log10(clampToRange(freq, range)) - min) / (max - min)) *
      FREQ_SLIDER_STEPS,
  );
}

function sliderToFreq(value: number, range: [number, number]) {
  const min = Math.log10(range[0]);
  const max = Math.log10(range[1]);
  return Math.round(10 ** (min + (value / FREQ_SLIDER_STEPS) * (max - min)));
}

function qToSlider(q: number, range: [number, number]) {
  const min = Math.log10(range[0]);
  const max = Math.log10(range[1]);
  return Math.round(
    ((Math.log10(clampToRange(q, range)) - min) / (max - min)) * Q_SLIDER_STEPS,
  );
}

function sliderToQ(value: number, range: [number, number]) {
  const min = Math.log10(range[0]);
  const max = Math.log10(range[1]);
  return Number(
    (10 ** (min + (value / Q_SLIDER_STEPS) * (max - min))).toFixed(2),
  );
}

function constrainFreq(
  freq: number,
  range: [number, number],
  snapToIso?: boolean,
) {
  const constrained = clampToRange(Math.round(freq), range);
  return clampToRange(
    snapToIso ? snapFreqToIsoSync(constrained) : constrained,
    range,
  );
}

// Frequency steps are ratios, like the log slider and graph: 1/12 octave for
// a step, 1/3 octave for a large step. A fixed ±50 Hz was more than an octave
// at 20 Hz and invisible at 10 kHz.
const FREQ_STEP_RATIO = 2 ** (1 / 12);
const FREQ_LARGE_STEP_RATIO = 2 ** (1 / 3);

/** The frequency one step from `freq`, or `freq` itself at the range edge.
 *  Guarantees progress: rounding (20 Hz × 1.06 → 21) or ISO snapping can
 *  cancel a small step, so advance until the constrained value moves. */
export function nextFreq(
  freq: number,
  direction: 1 | -1,
  largeStep: boolean,
  range: [number, number],
  snapToIso: boolean | undefined,
): number {
  const ratio = largeStep ? FREQ_LARGE_STEP_RATIO : FREQ_STEP_RATIO;
  const current = snapToIso ? snapFreqToIsoSync(freq) : freq;
  let candidate = freq;
  let next = current;
  for (let guard = 0; guard < 400 && next === current; guard++) {
    candidate =
      direction > 0
        ? Math.max(candidate + 1, Math.round(candidate * ratio))
        : Math.min(candidate - 1, Math.round(candidate / ratio));
    next = constrainFreq(candidate, range, snapToIso);
    if (candidate < range[0] || candidate > range[1]) break;
  }
  return next;
}

function makeFreqStepper(
  filter: Filter,
  range: [number, number],
  snapToIso: boolean | undefined,
  onChange: (index: number, filter: Filter) => void,
) {
  return (direction: 1 | -1, largeStep: boolean) => {
    const freq = nextFreq(filter.freq, direction, largeStep, range, snapToIso);
    if (freq !== filter.freq) {
      onChange(filter.index, { ...filter, freq });
    }
  };
}

export const Bands = memo(function Bands({
  peq,
  committedPeq,
  capabilities,
  onFilterChange,
  onStartChange,
  onEndChange,
  activeBandIndex,
  onActiveBandChange,
  snapToIso,
  disabled = false,
  isMobile = false,
}: BandsProps) {
  const { t } = useTranslation("editor");
  const availableFilters = peq.filters.slice(0, capabilities.num_bands);
  const visibleFilters = availableFilters.filter((filter) => filter.enabled);
  const canAddFilter =
    visibleFilters.length < availableFilters.length && !disabled;
  const selectedFilter =
    visibleFilters.find((filter) => filter.index === activeBandIndex) ??
    visibleFilters[0];
  const [collapsed, setCollapsed] = useState(false);
  const bandPickerRef = useRef<HTMLDivElement>(null);
  // Fade an edge only while bands are hidden past it, instead of a hint.
  const [moreBands, setMoreBands] = useState({ start: false, end: false });
  const updateMoreBands = () => {
    const picker = bandPickerRef.current;
    if (!picker) return;
    const start = picker.scrollLeft > 1;
    const end = picker.scrollLeft + picker.clientWidth < picker.scrollWidth - 1;
    setMoreBands((previous) =>
      previous.start === start && previous.end === end
        ? previous
        : { start, end },
    );
  };
  useEffect(() => {
    const picker = bandPickerRef.current;
    if (!picker || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateMoreBands);
    observer.observe(picker);
    return () => observer.disconnect();
  }, [selectedFilter !== undefined]);
  useEffect(updateMoreBands, [visibleFilters.length]);

  useEffect(() => {
    if (!selectedFilter) return;
    const picker = bandPickerRef.current;
    const chip = picker?.querySelector<HTMLElement>(
      `[data-band-index="${selectedFilter.index}"]`,
    );
    if (!picker || !chip) return;

    const chipStart = chip.offsetLeft;
    const chipEnd = chipStart + chip.offsetWidth;
    if (chipStart < picker.scrollLeft) {
      picker.scrollTo({ left: chipStart });
    } else if (chipEnd > picker.scrollLeft + picker.clientWidth) {
      picker.scrollTo({ left: chipEnd - picker.clientWidth });
    }
  }, [selectedFilter?.index]);

  const addFilter = () => {
    const next = availableFilters.find((filter) => !filter.enabled);
    if (!next) return;
    onActiveBandChange?.(next.index);
    onStartChange();
    onFilterChange(next.index, bandForAdd(next, capabilities));
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
          <Icon name="tune" />
          <strong>{t("bands.title")}</strong>
        </span>
        <span className="collapse-toggle-btn">
          {visibleFilters.length}/{availableFilters.length}
          <Icon name={collapsed ? "expand_more" : "expand_less"} />
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
              canRemove
              disabled={disabled}
              capabilities={capabilities}
              snapToIso={snapToIso}
            />
          ))}
          <div className="bands-actions">
            <button
              type="button"
              className="btn"
              onClick={addFilter}
              disabled={!canAddFilter}
            >
              <Icon name="add" />
              {t("bands.addFilter")}
            </button>
          </div>
        </div>
      </section>
      {!selectedFilter && (
        <div className="bands-empty">
          <p>{t("bands.empty")}</p>
          <p className="bands-limits">
            {t("bands.limit", {
              count: capabilities.num_bands,
              types: capabilities.supported_filter_types
                .map((type) => t(TYPE_NAMES[type]))
                .join(", "),
            })}
          </p>
          <Button
            variant="primary"
            onClick={addFilter}
            disabled={!canAddFilter}
          >
            <Icon name="add" /> {t("bands.addBand")}
          </Button>
        </div>
      )}
      {selectedFilter && (
        <section className="bands-mobile-editor">
          <div
            className="band-picker"
            role="group"
            aria-label={t("bands.title")}
          >
            <div
              className={`band-picker-scroll${moreBands.start ? " more-start" : ""}${moreBands.end ? " more-end" : ""}`}
              ref={bandPickerRef}
              onScroll={updateMoreBands}
            >
              {visibleFilters.map((filter) => (
                <button
                  key={filter.index}
                  type="button"
                  data-band-index={filter.index}
                  style={filterColorStyle(filter.index)}
                  className={
                    filter.index === selectedFilter.index ? "active" : ""
                  }
                  aria-pressed={filter.index === selectedFilter.index}
                  aria-label={t("bands.bandFrequency", {
                    number: filter.index + 1,
                    frequency: filter.freq,
                  })}
                  onClick={() => onActiveBandChange?.(filter.index)}
                >
                  <strong>{filter.index + 1}</strong>
                  <span>{formatFreq(filter.freq)}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`add-filter-chip${canAddFilter ? "" : " at-limit"}`}
              onClick={addFilter}
              disabled={!canAddFilter}
              aria-label={
                canAddFilter ? t("bands.addFilter") : t("bands.addUnavailable")
              }
              title={canAddFilter ? t("bands.addFilter") : t("bands.allUsed")}
            >
              <Icon name="add" />
              <span>{t("bands.add")}</span>
            </button>
          </div>
          <div
            className="mobile-filter-card"
            style={filterColorStyle(selectedFilter.index)}
          >
            <div className="mobile-filter-head">
              <div className="mobile-filter-summary">
                <strong>
                  {t("bands.band", { number: selectedFilter.index + 1 })}
                </strong>
                <span className="mobile-band-context">
                  {t(TYPE_NAMES[selectedFilter.filter_type])}
                </span>
              </div>
              <div className="mobile-filter-actions">
                {committedPeq?.filters[selectedFilter.index] && (
                  <Button
                    variant="ghost"
                    className="mobile-filter-reset"
                    disabled={disabled}
                    aria-label={t("bands.resetBand", {
                      number: selectedFilter.index + 1,
                    })}
                    onClick={() => {
                      const committed =
                        committedPeq.filters[selectedFilter.index];
                      onStartChange();
                      onFilterChange(selectedFilter.index, {
                        ...committed,
                        index: selectedFilter.index,
                        enabled: true,
                      });
                      onEndChange?.();
                    }}
                  >
                    <Icon name="restart_alt" />
                    <span>{t("bands.reset")}</span>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="band-index"
                  title={t("bands.removeBand", {
                    number: selectedFilter.index + 1,
                  })}
                  aria-label={t("bands.removeBand", {
                    number: selectedFilter.index + 1,
                  })}
                  disabled={disabled}
                  onClick={() => {
                    const removedIndex = selectedFilter.index;
                    onStartChange();
                    onFilterChange(removedIndex, {
                      ...selectedFilter,
                      enabled: false,
                    });
                    onEndChange?.();
                    const next = visibleFilters.find(
                      (filter) => filter.index !== removedIndex,
                    );
                    if (next) onActiveBandChange?.(next.index);
                  }}
                >
                  <Icon name="delete" />
                </Button>
              </div>
            </div>
            <BandControls
              key={selectedFilter.index}
              mobileSimple={isMobile}
              disabled={disabled}
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
  disabled?: boolean;
  capabilities: DeviceCapabilities;
  snapToIso?: boolean;
};

const BandRow = memo(
  function BandRow({
    filter,
    committedFilter,
    active,
    onChange,
    onStartChange,
    onEndChange,
    onActivate,
    canRemove,
    disabled,
    capabilities,
    snapToIso,
  }: BandRowProps) {
    const { t } = useTranslation("editor");
    return (
      <div
        className={`band-row ${filter.enabled ? "" : "muted"} ${active ? "active" : ""}`}
        role="group"
        aria-label={t("bands.band", { number: filter.index + 1 })}
        style={filterColorStyle(filter.index)}
      >
        <div className="band-number" aria-hidden="true">
          {filter.index + 1}
        </div>
        <BandControls
          filter={filter}
          committedFilter={committedFilter}
          onChange={onChange}
          onStartChange={onStartChange}
          onEndChange={onEndChange}
          onActivate={onActivate}
          disabled={disabled}
          capabilities={capabilities}
          snapToIso={snapToIso}
        />
        <button
          type="button"
          className="band-index"
          aria-label={t("bands.removeBand", { number: filter.index + 1 })}
          disabled={!canRemove || disabled}
          onClick={() => {
            if (!canRemove) return;
            onActivate?.(filter.index);
            onStartChange();
            onChange(filter.index, { ...filter, enabled: false });
            onEndChange?.();
          }}
        >
          <Icon name="remove" />
        </button>
      </div>
    );
  },
  (previous, next) =>
    previous.filter === next.filter &&
    previous.committedFilter === next.committedFilter &&
    previous.active === next.active &&
    previous.canRemove === next.canRemove &&
    previous.disabled === next.disabled &&
    previous.capabilities === next.capabilities &&
    previous.snapToIso === next.snapToIso &&
    previous.onChange === next.onChange &&
    previous.onStartChange === next.onStartChange &&
    previous.onEndChange === next.onEndChange &&
    previous.onActivate === next.onActivate,
);

type BandControlsProps = {
  mobileSimple?: boolean;
  filter: Filter;
  committedFilter?: Filter;
  onChange: (index: number, filter: Filter) => void;
  onStartChange: () => void;
  onEndChange?: () => void;
  onActivate?: (index: number) => void;
  disabled?: boolean;
  capabilities: DeviceCapabilities;
  snapToIso?: boolean;
};

const BandControls = memo(
  function BandControls({
    mobileSimple = false,
    filter,
    committedFilter,
    onChange,
    onStartChange,
    onEndChange,
    onActivate,
    disabled = false,
    capabilities,
    snapToIso,
  }: BandControlsProps) {
    const { t } = useTranslation("editor");
    const gestureFilter = useRef(filter);
    const startSliderChange = () => {
      gestureFilter.current = filter;
      onStartChange();
    };

    const typeControl = (
      <label className="band-field band-type-field">
        <span className="band-field-label">{t("bands.filter")}</span>
        <Select
          value={filter.filter_type}
          disabled={disabled}
          options={capabilities.supported_filter_types.map((type) => ({
            value: type,
            label: t(TYPE_NAMES[type]),
          }))}
          onChange={(type) => {
            onActivate?.(filter.index);
            onStartChange();
            onChange(filter.index, { ...filter, filter_type: type });
            onEndChange?.();
          }}
        />
      </label>
    );
    const qControl = (
      <BandField
        label={mobileSimple ? t("bands.bandwidth") : "Q"}
        className="band-q-field"
      >
        <div className="param-cell q-cell">
          <Slider
            aria-label={t("bands.q", { number: filter.index + 1 })}
            disabled={disabled}
            min={0}
            max={Q_SLIDER_STEPS}
            step={1}
            value={qToSlider(filter.q, capabilities.q_range)}
            aria-valuemin={capabilities.q_range[0]}
            aria-valuemax={capabilities.q_range[1]}
            aria-valuenow={filter.q}
            aria-valuetext={`Q ${filter.q.toFixed(2)}`}
            onStartChange={startSliderChange}
            onEndChange={onEndChange}
            onCancelChange={() =>
              onChange(filter.index, { ...filter, q: gestureFilter.current.q })
            }
            onReset={
              committedFilter
                ? () =>
                    onChange(filter.index, {
                      ...filter,
                      q: clampToRange(committedFilter.q, capabilities.q_range),
                    })
                : undefined
            }
            onFocus={() => onActivate?.(filter.index)}
            onChange={(event) =>
              onChange(filter.index, {
                ...filter,
                q: sliderToQ(+event.target.value, capabilities.q_range),
              })
            }
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
            disabled={disabled}
            aria-label={t("bands.qValue", { number: filter.index + 1 })}
          />
        </div>
        {mobileSimple && <p className="band-q-help">{t("bands.qHelp")}</p>}
      </BandField>
    );

    const frequencyControl = (
      <BandField
        label={t("bands.frequency")}
        unit="Hz"
        className="band-freq-field"
      >
        <div className="param-cell freq-cell">
          <Slider
            aria-label={t("bands.frequencyLabel", { number: filter.index + 1 })}
            disabled={disabled}
            min={0}
            max={FREQ_SLIDER_STEPS}
            step={5}
            value={freqToSlider(filter.freq, capabilities.freq_range)}
            aria-valuemin={capabilities.freq_range[0]}
            aria-valuemax={capabilities.freq_range[1]}
            aria-valuenow={filter.freq}
            aria-valuetext={`${filter.freq} Hz`}
            onStartChange={startSliderChange}
            onEndChange={onEndChange}
            onCancelChange={() =>
              onChange(filter.index, {
                ...filter,
                freq: gestureFilter.current.freq,
              })
            }
            onReset={
              committedFilter
                ? () =>
                    onChange(filter.index, {
                      ...filter,
                      freq: constrainFreq(
                        committedFilter.freq,
                        capabilities.freq_range,
                        snapToIso,
                      ),
                    })
                : undefined
            }
            onFocus={() => onActivate?.(filter.index)}
            onChange={(event) => {
              const raw = sliderToFreq(
                +event.target.value,
                capabilities.freq_range,
              );
              onChange(filter.index, {
                ...filter,
                freq: constrainFreq(raw, capabilities.freq_range, snapToIso),
              });
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
            onChange={(val) =>
              onChange(filter.index, {
                ...filter,
                // Typed values are exact; only dragging and stepping snap.
                freq: constrainFreq(val, capabilities.freq_range, false),
              })
            }
            onStep={makeFreqStepper(
              filter,
              capabilities.freq_range,
              snapToIso,
              onChange,
            )}
            className="band-freq-stepper"
            disabled={disabled}
            aria-label={t("bands.frequencyValue", { number: filter.index + 1 })}
          />
        </div>
      </BandField>
    );
    const gainControl = (
      <BandField label={t("bands.gain")} unit="dB" className="band-gain-field">
        <div className="gain-cell">
          <Slider
            aria-label={t("bands.gainLabel", { number: filter.index + 1 })}
            disabled={disabled}
            min={capabilities.band_gain_range[0]}
            max={capabilities.band_gain_range[1]}
            step={0.01}
            value={clampToRange(filter.gain, capabilities.band_gain_range)}
            aria-valuetext={`${filter.gain >= 0 ? "+" : ""}${filter.gain.toFixed(2)} dB`}
            onStartChange={startSliderChange}
            onEndChange={onEndChange}
            onCancelChange={() =>
              onChange(filter.index, {
                ...filter,
                gain: gestureFilter.current.gain,
              })
            }
            onReset={
              committedFilter
                ? () =>
                    onChange(filter.index, {
                      ...filter,
                      gain: clampToRange(
                        committedFilter.gain,
                        capabilities.band_gain_range,
                      ),
                    })
                : undefined
            }
            onFocus={() => onActivate?.(filter.index)}
            onChange={(event) =>
              onChange(filter.index, { ...filter, gain: +event.target.value })
            }
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
            disabled={disabled}
            aria-label={t("bands.gainValue", { number: filter.index + 1 })}
          />
        </div>
      </BandField>
    );

    return (
      <>
        {!mobileSimple && typeControl}
        {mobileSimple ? (
          <>
            {gainControl}
            {frequencyControl}
          </>
        ) : (
          <>
            {frequencyControl}
            {gainControl}
          </>
        )}
        {mobileSimple ? (
          <details className="band-more-settings">
            <summary>
              {t("bands.more")}
              <Icon name="expand_more" />
            </summary>
            {typeControl}
            {qControl}
          </details>
        ) : (
          qControl
        )}
      </>
    );
  },
  (previous, next) =>
    previous.mobileSimple === next.mobileSimple &&
    previous.filter === next.filter &&
    previous.committedFilter === next.committedFilter &&
    previous.disabled === next.disabled &&
    previous.capabilities === next.capabilities &&
    previous.snapToIso === next.snapToIso &&
    previous.onChange === next.onChange &&
    previous.onActivate === next.onActivate &&
    previous.onStartChange === next.onStartChange &&
    previous.onEndChange === next.onEndChange,
);

function BandField({
  label,
  unit,
  className,
  children,
}: {
  label: string;
  unit?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`band-field ${className ?? ""}`.trim()}
      role="group"
      aria-label={label}
    >
      <span className="band-field-label">
        {label}
        {unit && <span className="band-field-unit">{unit}</span>}
      </span>
      {children}
    </div>
  );
}
