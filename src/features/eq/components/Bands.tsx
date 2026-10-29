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
import { formatFreqShort, snapFreqToIsoSync } from "@/features/eq/lib/graph";
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
  return (direction: 1 | -1, largeStep: boolean, value: number) => {
    const freq = nextFreq(value, direction, largeStep, range, snapToIso);
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
  const bandsFull = visibleFilters.length >= availableFilters.length;
  const canAddFilter = !bandsFull && !disabled;
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
    <div className={`bands-container leg:flex leg:flex-col leg:gap-[0] leg:[border:1px_solid_var(--line-soft)] leg:rounded-[var(--radius-card)] leg:overflow-hidden leg:shrink-0 leg:compact:[.mobile-workspace_&]:rounded-[0]! leg:compact:[.mobile-workspace_&]:[border-inline:0]! cmp:compact:[.mobile-workspace_&]:[overflow:clip] ${collapsed ? " collapsed" : ""}`}>
      <button
        type="button"
        className="bands-section-header leg:w-[100%] leg:h-[48px] leg:p-[0_16px] leg:[background:var(--panel)] leg:flex leg:justify-between leg:items-center leg:select-none leg:text-[color:inherit] leg:cursor-pointer leg:[border:none] leg:[&&]:[border-bottom:1px_solid_var(--line-soft)] leg:text-left leg:[transition:background_var(--motion-duration)_var(--motion-ease)] leg:[&:hover]:[background:var(--surface-soft)] leg:compact:hidden"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <span className="leg:[.bands-section-header_&]:flex leg:[.bands-section-header_&]:items-center leg:[.bands-section-header_&]:gap-[8px] leg:[.bands-section-header_&]:text-[color:var(--link-foreground)]">
          <Icon name="tune" />
          <strong>{t("bands.title")}</strong>
        </span>
        <span className="collapse-toggle-btn leg:[.bands-section-header_&]:text-[color:var(--link-foreground)] leg:[.bands-section-header_&]:p-[0] leg:[.bands-section-header_&]:min-h-[32px] leg:[.bands-section-header_&]:min-w-[48px] leg:[.bands-section-header_&]:flex leg:[.bands-section-header_&]:items-center leg:[.bands-section-header_&]:justify-center leg:[.bands-section-header_&]:gap-[6px] leg:[.bands-section-header_&]:text-[length:var(--type-small)]">
          {visibleFilters.length}/{availableFilters.length}
          <Icon name={collapsed ? "expand_more" : "expand_less"} />
        </span>
      </button>
      <section className="leg:flex-[0_0_auto] leg:grid-cols-[minmax(0,_1fr)] leg:gap-[12px] leg:min-h-[0] leg:min-w-[0] leg:hidden leg:[.bands-container.collapsed_&]:hidden leg:max-[960px]:grid-cols-[1fr] leg:compact:[&&]:grid-cols-[1fr] leg:compact:gap-[12px] leg:compact:[.bands-container>&]:hidden leg:max-[560px]:flex leg:max-[560px]:flex-col leg:max-[560px]:[&&]:gap-[10px]">
        <div className="bands-card leg:rounded-[var(--radius-surface)] leg:[box-shadow:none] leg:p-[10px_16px_6px] leg:overflow-hidden leg:[background:var(--panel)] leg:min-w-[0] leg:min-[1280px]:flex leg:min-[1280px]:flex-col leg:min-[1280px]:gap-[0] leg:min-[1280px]:p-[6px_16px_4px] leg:compact:[&&]:p-[0] leg:compact:[background:transparent] leg:compact:rounded-[var(--radius-surface)]! leg:compact:[border:1px_solid_var(--line-soft)]! leg:compact:[background:var(--panel)]! leg:compact:overflow-hidden leg:max-[560px]:[&&&]:p-[0] leg:max-[560px]:[&&]:overflow-visible leg:max-[560px]:[&&]:[background:transparent]">
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
          <div className="bands-actions leg:flex leg:justify-end leg:pt-[12px] leg:min-[1280px]:pt-[8px] leg:compact:[&&]:pt-[0]">
            <button
              type="button"
              className="leg:[&:disabled]:cursor-not-allowed leg:[&:disabled]:[background:var(--surface-disabled)]! leg:[&:disabled]:text-[color:var(--text-disabled)]! leg:[&:disabled]:opacity-[1]! leg:inline-flex leg:items-center leg:justify-center leg:gap-[8px] leg:[background:var(--surface-soft)] leg:text-[color:var(--text)] leg:font-medium leg:min-h-[42px] leg:p-[0_18px] leg:rounded-[var(--radius-control)] leg:[outline:1px_solid_var(--line-medium)] leg:[outline-offset:-1px] leg:[transition:filter_var(--motion-duration)_var(--motion-ease),_background_var(--motion-duration)_var(--motion-ease),_color_var(--motion-duration)_var(--motion-ease),_outline-color_var(--motion-duration)_var(--motion-ease)] leg:[&:hover:not(:disabled)]:[filter:brightness(1.14)] leg:[&&:active:not(:disabled)]:[filter:brightness(1.24)] leg:[&.filled]:[background:var(--primary)] leg:[&.filled]:text-[color:var(--primary-foreground)] leg:[&&.warning]:[background:var(--yellow)] leg:[&&.warning]:text-[color:var(--on-accent)] leg:pointer-coarse:min-h-[44px] leg:[.confirm-actions_&]:min-h-[44px] leg:[.bands-actions_&&]:min-h-[36px] leg:[.device-summary_.device-hero-actions_&]:w-[auto] leg:[.device-summary_.device-hero-actions_&&]:min-h-[44px] leg:[.device-summary_.device-hero-actions_&]:flex-[0_1_auto] leg:[.empty-state_&]:mt-[8px] leg:[.empty-state_&&&]:min-h-[44px] leg:[.empty-state_&]:p-[0_20px] leg:[.empty-state_&]:rounded-[0]! leg:[.add-trace-download-prompt_&]:[align-self:flex-start] leg:[.add-trace-download-prompt_&&&&]:min-h-[44px] leg:[.device-actions_&]:w-[100%] leg:[.device-actions_&&&&&]:min-h-[52px] leg:[.device-actions_&]:font-bold leg:max-[960px]:[.toolbar_&]:min-w-[0] leg:max-[960px]:[.toolbar_&&]:p-[0_10px] leg:compact:[.bands-actions_&&]:w-[100%] leg:compact:[.bands-actions_&&&&&&]:min-h-[44px] leg:compact:[.bands-actions_&]:justify-center leg:compact:[.bands-actions_&&&]:[background:var(--bg-dark)] leg:compact:[.bands-actions_&]:[outline:1px_solid_var(--line-medium)] leg:compact:[.bands-actions_&]:[outline-offset:-1px] leg:compact:[.mobile-workspace_.device-hero-actions_&&]:w-[auto] leg:compact:[.mobile-workspace_.device-hero-actions_&&&&&&]:min-h-[48px] leg:compact:[.mobile-workspace_.device-hero-actions_&]:rounded-[0]!"
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
        <div className="bands-empty leg:flex leg:flex-col leg:items-center leg:gap-[var(--space-3)] leg:p-[var(--space-6)_var(--space-4)] leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)] leg:text-center leg:[.bands-container.collapsed_&]:hidden">
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
        <section className="bands-mobile-editor leg:flex leg:flex-col leg:gap-[0] leg:[background:transparent] leg:[container-type:inline-size] leg:[.bands-container.collapsed_&]:hidden">
          <div
            className="band-picker leg:grid leg:grid-cols-[minmax(0,_1fr)_auto] leg:gap-[var(--space-2)] leg:min-w-[0] leg:p-[var(--space-3)_var(--space-4)] leg:[border-bottom:1px_solid_var(--line-soft)] cmp:compact:[.mobile-workspace_&]:p-[var(--space-2)_var(--space-3)]"
            role="group"
            aria-label={t("bands.title")}
          >
            <div
              className={`band-picker-scroll leg:relative leg:flex leg:min-w-[0] leg:gap-[var(--space-1)] leg:overflow-x-auto leg:[scrollbar-width:thin] leg:[--fade-start:0px] leg:[--fade-end:0px] leg:[mask-image:linear-gradient(to_right,_transparent,_#000_var(--fade-start),_#000_calc(100%_-_var(--fade-end)),_transparent)] leg:[&.more-start]:[--fade-start:24px] leg:[&.more-end]:[--fade-end:24px] leg:compact:[scrollbar-width:none] leg:compact:[-webkit-overflow-scrolling:touch] leg:compact:[touch-action:pan-x] cmp:compact:[touch-action:auto] ${moreBands.start ? " more-start" : ""}${moreBands.end ? " more-end" : ""}`}
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
                  <span>{formatFreqShort(filter.freq)}</span>
                </button>
              ))}
            </div>
            {/* Hidden once every band is in use: a dead button only takes room. */}
            {!bandsFull && (
              <button
                type="button"
                className="add-filter-chip leg:[.band-picker_button&]:flex leg:[.band-picker_button&]:items-center leg:[.band-picker_button&]:justify-center leg:[.band-picker_button&]:gap-[var(--space-1)] leg:[.band-picker_button&]:text-[color:var(--link-foreground)] cmp:compact:[.mobile-workspace_.band-picker_button&]:min-w-[64px]"
                onClick={addFilter}
                disabled={!canAddFilter}
                aria-label={t("bands.addFilter")}
                title={t("bands.addFilter")}
              >
                <Icon name="add" />
                <span>{t("bands.add")}</span>
              </button>
            )}
          </div>
          <div
            className="mobile-filter-card leg:grid leg:grid-cols-[minmax(140px,_0.6fr)_repeat(3,_minmax(0,_1fr))] leg:[grid-template-areas:'head_head_head_head'_'type_freq_gain_q'] leg:[align-items:start] leg:gap-[var(--space-3)_var(--space-5)] leg:p-[var(--space-3)_var(--space-4)_var(--space-4)] leg:[background:var(--panel)] leg:[@container(max-width:700px)]:grid-cols-[minmax(0,_1fr)] leg:[@container(max-width:700px)]:[grid-template-areas:'head'_'type'_'freq'_'gain'_'q'] leg:[@container(max-width:700px)]:gap-[var(--space-3)] leg:compact:rounded-[var(--radius-surface)]! leg:compact:overflow-hidden leg:compact:[.mobile-workspace_&]:rounded-[0]! leg:compact:[.mobile-workspace_&]:[border-inline:0]! leg:compact:flex leg:compact:flex-col leg:compact:items-stretch leg:compact:[&&]:gap-[var(--space-2)] leg:compact:p-[var(--space-2)_var(--space-3)] leg:compact:w-[100%] leg:compact:box-border leg:[@media(max-height:_580px)]:gap-[4px]! leg:[@media(max-height:_580px)]:p-[6px_12px]! cmp:compact:[.mobile-workspace_&]:[border-color:var(--border)] cmp:compact:[.mobile-workspace_&]:[background:var(--card)]! cmp:compact:[.mobile-workspace_&]:p-[var(--space-3)_var(--space-4)] cmp:compact:[.mobile-workspace_&]:gap-[var(--space-3)] cmp:compact:[.mobile-workspace_&]:[border-top:1px_solid_var(--border)] cmp:compact:[.mobile-workspace_&]:rounded-[0]"
            style={filterColorStyle(selectedFilter.index)}
          >
            <div className="mobile-filter-head leg:[grid-area:head] leg:min-w-[0] leg:grid leg:grid-cols-[minmax(0,_1fr)_auto] leg:gap-[8px] leg:items-center">
              <div className="mobile-filter-summary leg:min-w-[0] leg:flex leg:items-baseline leg:gap-[var(--space-2)] cmp:compact:items-center">
                <strong>
                  {t("bands.band", { number: selectedFilter.index + 1 })}
                </strong>
                {isMobile ? (
                  <Select
                    className="mobile-band-type cmp:compact:[.mobile-filter-summary_&]:flex-[0_1_auto] cmp:compact:[.mobile-filter-summary_&]:w-[auto] cmp:compact:[.mobile-filter-summary_&]:min-w-[0]"
                    aria-label={t("bands.typeLabel", {
                      number: selectedFilter.index + 1,
                    })}
                    value={selectedFilter.filter_type}
                    disabled={disabled}
                    options={capabilities.supported_filter_types.map(
                      (type) => ({ value: type, label: t(TYPE_NAMES[type]) }),
                    )}
                    onChange={(type) => {
                      onStartChange();
                      onFilterChange(selectedFilter.index, {
                        ...selectedFilter,
                        filter_type: type,
                      });
                      onEndChange?.();
                    }}
                  />
                ) : (
                  <span className="leg:text-[length:var(--type-small)] leg:text-[color:var(--muted-foreground)]">
                    {t(TYPE_NAMES[selectedFilter.filter_type])}
                  </span>
                )}
              </div>
              <div className="leg:flex leg:items-center leg:gap-[4px]">
                {committedPeq?.filters[selectedFilter.index] && (
                  <Button
                    variant="ghost"
                    className="mobile-filter-reset leg:inline-flex leg:min-h-[32px] leg:items-center leg:justify-center leg:gap-[4px] leg:p-[0_8px] leg:[background:transparent] leg:text-[color:var(--muted)] leg:[&:hover]:text-[color:var(--link-foreground)] leg:compact:min-h-[44px] cmp:compact:min-h-[44px]"
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
                  className="band-index leg:text-[color:var(--comment)] leg:[background:transparent] leg:p-[0] leg:text-center leg:font-bold leg:min-h-[32px] leg:w-[32px] leg:inline-flex leg:items-center leg:justify-center leg:whitespace-nowrap leg:[border:none] leg:cursor-pointer leg:opacity-[.25] leg:[transition:color_var(--motion-duration)_var(--motion-ease),_opacity_var(--motion-duration)_var(--motion-ease)] leg:[&:hover]:text-[color:var(--destructive-foreground)] leg:[&:hover]:opacity-[1] leg:[&:hover]:[transform:none] leg:[.band-row.active_&]:opacity-[.7] leg:[.mobile-filter-head_&]:w-[32px] leg:[.mobile-filter-head_&]:min-h-[32px] leg:[.mobile-filter-head_&&]:text-[color:var(--muted)] leg:[.mobile-filter-head_&&]:opacity-[1] leg:[.mobile-filter-head_&]:[background:transparent] leg:[.mobile-filter-head_&:hover:not(:disabled)]:text-[color:var(--destructive-foreground)] leg:[.mobile-filter-head_&&:disabled]:opacity-[0.4] leg:compact:[.mobile-filter-head_&]:[grid-area:auto] leg:compact:[.mobile-filter-head_&&]:w-[44px] leg:compact:[.mobile-filter-head_&&]:min-h-[44px] leg:compact:[grid-area:index] leg:compact:w-[100%] leg:compact:min-h-[36px] leg:compact:p-[0_10px] leg:compact:flex leg:compact:items-center leg:compact:justify-center leg:compact:[background:var(--surface-soft)] leg:compact:[border:none] leg:compact:[outline:none] leg:compact:rounded-[var(--radius-control)] cmp:compact:[.mobile-filter-head_&]:w-[44px] cmp:compact:[.mobile-filter-head_&]:min-h-[44px]"
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
        className={`band-row leg:grid leg:grid-cols-[minmax(0,_28px)_minmax(0,_120px)_minmax(0,_1fr)_minmax(0,_1fr)_minmax(0,_1fr)_minmax(0,_28px)] leg:gap-[12px] leg:items-center leg:h-[52px] leg:text-[color:var(--text)] leg:[border-bottom:1px_solid_var(--line-subtle)] leg:[&:last-child]:[border-bottom:0] leg:[&:hover]:[background:var(--hover-bg)] leg:[&&.active]:[background:rgb(var(--filter-color-rgb,_var(--cyan-rgb))_/_0.07)] leg:[&.active]:[box-shadow:inset_3px_0_0_var(--filter-color,_var(--cyan))] leg:[&.muted]:opacity-[.45] leg:min-[1280px]:min-w-[0] leg:min-[1280px]:h-[auto] leg:min-[1280px]:min-h-[64px] leg:min-[1280px]:p-[6px_0_6px_8px] leg:min-[1280px]:gap-[8px_12px] leg:min-[1280px]:[border-left:3px_solid_var(--filter-color,_var(--cyan))] leg:min-[1280px]:[&&&:hover]:[background:var(--surface-soft)] leg:max-[960px]:grid-cols-[36px_144px_minmax(140px,_1fr)_minmax(140px,_1fr)_76px] leg:max-[960px]:text-[length:var(--type-small)] leg:compact:[&&]:min-w-[0] leg:compact:[&&]:h-[auto] leg:compact:[&&]:p-[12px] leg:compact:[&&]:grid-cols-[44px_minmax(0,_1fr)_minmax(0,_1fr)] leg:compact:[grid-template-areas:'type_type_index'_'freq_freq_freq'_'gain_gain_gain'_'q_q_q'] leg:compact:[&&]:gap-[12px_8px] leg:compact:[background:var(--bg-dark)] leg:compact:[outline:1px_solid_var(--line-medium)] leg:compact:[outline-offset:-1px] leg:compact:[border-bottom:0] leg:compact:[&&.muted]:opacity-[.6] leg:max-[560px]:[&&&]:min-w-[0] leg:[@media(min-width:_769px)_and_(max-width:_1150px)]:[&&&]:grid-cols-[28px_132px_minmax(0,_1fr)_minmax(0,_1fr)_minmax(0,_1fr)_28px] leg:[@media(min-width:_769px)_and_(max-width:_1150px)]:[&&&]:gap-[8px] ${filter.enabled ? "" : "muted"} ${active ? "active" : ""}`}
        role="group"
        aria-label={t("bands.band", { number: filter.index + 1 })}
        style={filterColorStyle(filter.index)}
      >
        <div className="leg:text-[color:var(--filter-color,_var(--cyan))] leg:font-bold leg:text-[length:var(--type-subtitle)] leg:text-center leg:[font-variant-numeric:tabular-nums] leg:min-[1280px]:[align-self:center] leg:compact:hidden! leg:[@media(min-width:_769px)_and_(max-width:_1150px)]:text-[length:var(--type-label)]" aria-hidden="true">
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
          className="band-index leg:text-[color:var(--comment)] leg:[background:transparent] leg:p-[0] leg:text-center leg:font-bold leg:min-h-[32px] leg:w-[32px] leg:inline-flex leg:items-center leg:justify-center leg:whitespace-nowrap leg:[border:none] leg:cursor-pointer leg:opacity-[.25] leg:[transition:color_var(--motion-duration)_var(--motion-ease),_opacity_var(--motion-duration)_var(--motion-ease)] leg:[&:hover]:text-[color:var(--destructive-foreground)] leg:[&:hover]:opacity-[1] leg:[&:hover]:[transform:none] leg:[.band-row.active_&]:opacity-[.7] leg:[.mobile-filter-head_&]:w-[32px] leg:[.mobile-filter-head_&]:min-h-[32px] leg:[.mobile-filter-head_&&]:text-[color:var(--muted)] leg:[.mobile-filter-head_&&]:opacity-[1] leg:[.mobile-filter-head_&]:[background:transparent] leg:[.mobile-filter-head_&:hover:not(:disabled)]:text-[color:var(--destructive-foreground)] leg:[.mobile-filter-head_&&:disabled]:opacity-[0.4] leg:compact:[.mobile-filter-head_&]:[grid-area:auto] leg:compact:[.mobile-filter-head_&&]:w-[44px] leg:compact:[.mobile-filter-head_&&]:min-h-[44px] leg:compact:[grid-area:index] leg:compact:w-[100%] leg:compact:min-h-[36px] leg:compact:p-[0_10px] leg:compact:flex leg:compact:items-center leg:compact:justify-center leg:compact:[background:var(--surface-soft)] leg:compact:[border:none] leg:compact:[outline:none] leg:compact:rounded-[var(--radius-control)] cmp:compact:[.mobile-filter-head_&]:w-[44px] cmp:compact:[.mobile-filter-head_&]:min-h-[44px]"
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
      <label className="leg:min-w-[0] leg:flex leg:flex-col leg:justify-center leg:gap-[6px] leg:[@container(max-width:700px)]:[.mobile-filter-card_&]:grid leg:[@container(max-width:700px)]:[.mobile-filter-card_&]:grid-cols-[88px_minmax(0,_1fr)] leg:[@container(max-width:700px)]:[.mobile-filter-card_&]:items-center leg:[@container(max-width:700px)]:[.mobile-filter-card_&]:gap-[var(--space-2)] leg:compact:flex leg:compact:flex-col leg:compact:gap-[6px] leg:compact:[.mobile-filter-card_&&]:flex leg:compact:[.mobile-filter-card_&]:flex-col leg:compact:[.mobile-filter-card_&&]:items-stretch leg:compact:[.mobile-filter-card_&&]:gap-[var(--space-1)] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:relative cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:gap-[0] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:pt-[48px] band-type-field leg:[.mobile-filter-card_&]:[grid-area:type] leg:compact:[grid-area:type] cmp:compact:[.mobile-workspace_.mobile-filter-card_&&]:pt-[0] cmp:compact:[.mobile-workspace_.mobile-filter-card_&&]:gap-[var(--space-2)]">
        <span className="leg:flex leg:items-baseline leg:gap-[var(--space-1)] leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)] leg:font-medium leg:leading-[1.4] leg:compact:[.mobile-filter-card_&]:text-[color:var(--text)] leg:compact:[.mobile-filter-card_&]:text-[length:var(--type-label)] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:absolute cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:top-[0] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:left-[0] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:h-[44px] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:flex cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:items-center cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:gap-[var(--space-1)] cmp:compact:[.mobile-workspace_.mobile-filter-card_.band-type-field_&]:static cmp:compact:[.mobile-workspace_.mobile-filter-card_.band-type-field_&]:h-[auto]">{t("bands.filter")}</span>
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
        className="leg:[.mobile-filter-card_&]:[grid-area:q] leg:compact:[grid-area:q]"
      >
        <div className="param-cell leg:flex leg:min-w-[0] leg:flex-col leg:gap-[4px] q-cell leg:[&&&]:flex leg:[&&&]:flex-col leg:[&&]:items-stretch leg:[&&&]:gap-[var(--space-2)] leg:[&&&]:min-w-[0] leg:compact:[.mobile-filter-card_&&]:grid-cols-[minmax(0,_1fr)_160px] leg:compact:[&&&&&]:grid leg:compact:[&&]:grid-cols-[minmax(0,_1fr)_160px] leg:compact:[&&&&]:items-center leg:compact:[&&&&&]:gap-[8px]">
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
      </BandField>
    );

    const frequencyControl = (
      <BandField
        label={t("bands.frequency")}
        unit="Hz"
        className="leg:[.mobile-filter-card_&]:[grid-area:freq] leg:compact:[grid-area:freq]"
      >
        <div className="param-cell leg:flex leg:min-w-[0] leg:flex-col leg:gap-[4px] freq-cell leg:[&&]:flex leg:[&&]:flex-col leg:items-stretch leg:[&&]:gap-[var(--space-2)] leg:[&&]:min-w-[0] leg:compact:[.mobile-filter-card_&]:grid-cols-[minmax(0,_1fr)_160px] leg:compact:[&&&&]:grid leg:compact:grid-cols-[minmax(0,_1fr)_160px] leg:compact:[&&&]:items-center leg:compact:[&&&&]:gap-[8px]">
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
      <BandField label={t("bands.gain")} unit="dB" className="leg:[.mobile-filter-card_&]:[grid-area:gain] leg:compact:[grid-area:gain]">
        <div className="gain-cell leg:flex leg:flex-col leg:items-stretch leg:gap-[var(--space-2)] leg:min-w-[0] leg:compact:[.mobile-filter-card_&]:grid-cols-[minmax(0,_1fr)_160px] leg:compact:grid leg:compact:grid-cols-[minmax(0,_1fr)_160px] leg:compact:items-center leg:compact:gap-[8px]">
          <Slider
            aria-label={t("bands.gainLabel", { number: filter.index + 1 })}
            disabled={disabled}
            min={capabilities.band_gain_range[0]}
            max={capabilities.band_gain_range[1]}
            // A drag lands on 0.1 dB; finer values come from typing.
            step={0.1}
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
              onChange(filter.index, {
                ...filter,
                gain: Math.round(+event.target.value * 10) / 10,
              })
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
        {qControl}
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
      className={`leg:min-w-[0] leg:flex leg:flex-col leg:justify-center leg:gap-[6px] leg:[@container(max-width:700px)]:[.mobile-filter-card_&]:grid leg:[@container(max-width:700px)]:[.mobile-filter-card_&]:grid-cols-[88px_minmax(0,_1fr)] leg:[@container(max-width:700px)]:[.mobile-filter-card_&]:items-center leg:[@container(max-width:700px)]:[.mobile-filter-card_&]:gap-[var(--space-2)] leg:compact:flex leg:compact:flex-col leg:compact:gap-[6px] leg:compact:[.mobile-filter-card_&&]:flex leg:compact:[.mobile-filter-card_&]:flex-col leg:compact:[.mobile-filter-card_&&]:items-stretch leg:compact:[.mobile-filter-card_&&]:gap-[var(--space-1)] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:relative cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:gap-[0] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:pt-[48px] ${className ?? ""}`.trim()}
      role="group"
      aria-label={label}
    >
      <span className="leg:flex leg:items-baseline leg:gap-[var(--space-1)] leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)] leg:font-medium leg:leading-[1.4] leg:compact:[.mobile-filter-card_&]:text-[color:var(--text)] leg:compact:[.mobile-filter-card_&]:text-[length:var(--type-label)] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:absolute cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:top-[0] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:left-[0] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:h-[44px] cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:flex cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:items-center cmp:compact:[.mobile-workspace_.mobile-filter-card_&]:gap-[var(--space-1)] cmp:compact:[.mobile-workspace_.mobile-filter-card_.band-type-field_&]:static cmp:compact:[.mobile-workspace_.mobile-filter-card_.band-type-field_&]:h-[auto]">
        {label}
        {unit && <span className="leg:text-[length:var(--type-micro)]">{unit}</span>}
      </span>
      {children}
    </div>
  );
}
