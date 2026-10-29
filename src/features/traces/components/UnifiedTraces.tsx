import { useTranslation } from "react-i18next";
import { memo } from "react";
import type { MeasurementTrace, TargetTrace } from "@/types";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { traceSwatchColor } from "@/features/traces/lib/traceColor";

interface UnifiedTracesListProps {
  measurements: MeasurementTrace[];
  allTargets: TargetTrace[];
  activeTargetIds: string[];
  onToggleMeasurement: (id: string) => void;
  onRemoveMeasurement: (id: string) => void;
  onToggleTarget: (id: string) => void;
  onRemoveTarget: (id: string) => void;
}

export const UnifiedTracesList = memo(function UnifiedTracesList({
  measurements,
  allTargets,
  activeTargetIds,
  onToggleMeasurement,
  onRemoveMeasurement,
  onToggleTarget,
  onRemoveTarget,
}: UnifiedTracesListProps) {
  const { t } = useTranslation("library");
  const isEmpty = measurements.length === 0 && allTargets.length === 0;

  return (
    <div className="leg:min-h-[0] leg:max-h-[none] leg:h-[auto] leg:flex-[1] leg:overflow-y-auto">
      {isEmpty && <div className="leg:p-[12px] leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)]">{t("unifiedTraces.empty")}</div>}
      {measurements.map((trace) => (
        <div className="curve-item leg:grid leg:grid-cols-[minmax(0,_1fr)_auto_28px] leg:items-center leg:gap-[8px] leg:min-h-[36px] leg:p-[0_4px_0_6px] leg:[border-bottom:1px_solid_var(--line-subtle)] leg:[transition:background_var(--motion-duration)_var(--motion-ease)] leg:[&:last-child]:[border-bottom:0] leg:[&:hover]:[background:var(--surface-soft)] leg:compact:min-h-[44px] leg:compact:grid-cols-[minmax(0,_1fr)_auto_44px]" key={trace.id}>
          <label className="curve-toggle leg:min-w-[0] leg:min-h-[36px] leg:p-[0] leg:flex leg:items-center leg:gap-[8px] leg:cursor-pointer leg:compact:min-h-[48px]!">
            <input
              type="checkbox"
              className="leg:[appearance:none] leg:w-[17px] leg:h-[17px] leg:m-[0] leg:flex-[0_0_17px] leg:[border:1px_solid_var(--accent-line-checkbox)] leg:[background:var(--bg-dark)] leg:[box-shadow:inset_0_0_0_2px_var(--panel)] leg:cursor-pointer leg:[transition:background_var(--motion-duration)_var(--motion-ease),_border-color_var(--motion-duration)_var(--motion-ease),_filter_var(--motion-duration)_var(--motion-ease)] leg:[&:hover]:[border-color:var(--link-foreground)] leg:[&:hover]:[filter:brightness(1.12)] leg:[&:checked]:text-[color:var(--theme-checkmark)] leg:[&&:checked]:[border-color:var(--link-foreground)] leg:[&:checked]:bg-[color:var(--link-foreground)] leg:[&:checked]:[background-image:url('data:image/svg+xml,%3Csvg_viewBox='0_0_16_16'_xmlns='http://www.w3.org/2000/svg'%3E%3Cpath_d='M3.2_8.1_6.5_11.4_12.8_4.6'_fill='none'_stroke='currentColor'_stroke-width='2.2'_stroke-linecap='square'_stroke-linejoin='miter'/%3E%3C/svg%3E')] leg:[&:checked]:[background-position:center] leg:[&:checked]:[background-repeat:no-repeat] leg:[&:checked]:[background-size:15px_15px] leg:[&:checked]:[box-shadow:none] leg:[&:focus-visible]:[outline:1px_solid_var(--focus-ring)] leg:[&:focus-visible]:[outline-offset:3px] leg:pointer-coarse:relative leg:pointer-coarse:[&::before]:content-[''] leg:pointer-coarse:[&::before]:absolute leg:pointer-coarse:[&::before]:[inset:calc((17px_-_var(--touch-md))_/_2)] leg:[.stack-pref-control_&]:w-[20px] leg:[.stack-pref-control_&]:h-[20px] leg:[.stack-pref-control_&]:cursor-pointer leg:[.stack-pref-control_&]:rounded-[0]!"
              checked={trace.visible}
              aria-label={t("unifiedTraces.measurementLabel", {
                name: trace.name,
                count: trace.points.length,
              })}
              onChange={() => onToggleMeasurement(trace.id)}
            />
            <span
              className="leg:w-[8px] leg:h-[8px] leg:rounded-[50%] leg:shrink-0 leg:[box-shadow:0_0_0_1px_var(--border)] leg:[transition:opacity_var(--motion-duration)_var(--motion-ease)] leg:[.curve-toggle:has(input:not(:checked))_&]:opacity-[0.3]"
              style={{ backgroundColor: traceSwatchColor(trace.color) }}
            />
            <span
              className="leg:min-w-[0] leg:flex-[1_1_auto] leg:overflow-hidden leg:text-[color:var(--text)] leg:text-[length:var(--type-label)] leg:inline-flex leg:items-baseline leg:gap-[6px] leg:[transition:color_var(--motion-duration)_var(--motion-ease),_opacity_var(--motion-duration)_var(--motion-ease)] leg:[.curve-toggle:has(input:not(:checked))_&]:text-[color:var(--muted)]"
              title={t("unifiedTraces.pointTitle", {
                name: trace.name,
                count: trace.points.length,
              })}
            >
              <span className="leg:min-w-[0] leg:overflow-hidden leg:text-ellipsis leg:whitespace-nowrap">{trace.name}</span>
              <span className="leg:text-[color:var(--comment)] leg:text-[length:11px] leg:font-normal leg:whitespace-nowrap leg:compact:hidden!">
                {t("unifiedTraces.points", { count: trace.points.length })}
              </span>
            </span>
          </label>
          <span
            className="leg:w-[18px] leg:h-[18px] leg:inline-flex leg:items-center leg:justify-center leg:text-[length:10px] leg:font-bold leg:leading-[1] leg:select-none leg:rounded-[2px] leg:[&.trace-type-measure]:text-[color:var(--green)] leg:[&.trace-type-measure]:[background:color-mix(in_srgb,_var(--green)_14%,_transparent)] leg:[&.trace-type-measure]:[outline:1px_solid_color-mix(in_srgb,_var(--green)_28%,_transparent)] leg:[&.trace-type-measure]:[outline-offset:-1px] leg:[&&.trace-type-target]:text-[color:var(--warning-foreground)] leg:[&&.trace-type-target]:[background:color-mix(in_srgb,_var(--yellow)_14%,_transparent)] leg:[&&.trace-type-target]:[outline:1px_solid_color-mix(in_srgb,_var(--yellow)_28%,_transparent)] leg:[&&.trace-type-target]:[outline-offset:-1px] trace-type-measure"
            aria-hidden="true"
            title={t("unifiedTraces.measurement")}
          >
            {t("unifiedTraces.measurementBadge")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="curve-delete leg:w-[28px] leg:h-[28px] leg:min-h-[28px]! leg:max-h-[28px] leg:p-[0]! leg:inline-flex leg:items-center leg:justify-center leg:text-[color:var(--comment)]! leg:[background:transparent]! leg:[border:0]! leg:[outline:none]! leg:rounded-[2px] leg:opacity-[0.4] leg:cursor-pointer leg:[transition:color_var(--motion-duration)_var(--motion-ease),_background_var(--motion-duration)_var(--motion-ease),_opacity_var(--motion-duration)_var(--motion-ease)] leg:[.curve-item:hover_&]:opacity-[0.85] leg:[&:hover]:opacity-[1]! leg:[&:hover]:text-[color:var(--destructive-foreground)]! leg:[&:hover]:[background:color-mix(in_srgb,_var(--red)_14%,_transparent)]! leg:compact:w-[44px] leg:compact:min-h-[48px]!"
            title={t("unifiedTraces.delete", { name: trace.name })}
            aria-label={t("unifiedTraces.delete", { name: trace.name })}
            onClick={() => onRemoveMeasurement(trace.id)}
          >
            <Icon name="delete" />
          </Button>
        </div>
      ))}
      {allTargets.map((target) => {
        const active = activeTargetIds.includes(target.id);
        return (
          <div className="curve-item leg:grid leg:grid-cols-[minmax(0,_1fr)_auto_28px] leg:items-center leg:gap-[8px] leg:min-h-[36px] leg:p-[0_4px_0_6px] leg:[border-bottom:1px_solid_var(--line-subtle)] leg:[transition:background_var(--motion-duration)_var(--motion-ease)] leg:[&:last-child]:[border-bottom:0] leg:[&:hover]:[background:var(--surface-soft)] leg:compact:min-h-[44px] leg:compact:grid-cols-[minmax(0,_1fr)_auto_44px]" key={target.id}>
            <label className="curve-toggle leg:min-w-[0] leg:min-h-[36px] leg:p-[0] leg:flex leg:items-center leg:gap-[8px] leg:cursor-pointer leg:compact:min-h-[48px]!">
              <input
                type="checkbox"
                className="leg:[appearance:none] leg:w-[17px] leg:h-[17px] leg:m-[0] leg:flex-[0_0_17px] leg:[border:1px_solid_var(--accent-line-checkbox)] leg:[background:var(--bg-dark)] leg:[box-shadow:inset_0_0_0_2px_var(--panel)] leg:cursor-pointer leg:[transition:background_var(--motion-duration)_var(--motion-ease),_border-color_var(--motion-duration)_var(--motion-ease),_filter_var(--motion-duration)_var(--motion-ease)] leg:[&:hover]:[border-color:var(--link-foreground)] leg:[&:hover]:[filter:brightness(1.12)] leg:[&:checked]:text-[color:var(--theme-checkmark)] leg:[&&:checked]:[border-color:var(--link-foreground)] leg:[&:checked]:bg-[color:var(--link-foreground)] leg:[&:checked]:[background-image:url('data:image/svg+xml,%3Csvg_viewBox='0_0_16_16'_xmlns='http://www.w3.org/2000/svg'%3E%3Cpath_d='M3.2_8.1_6.5_11.4_12.8_4.6'_fill='none'_stroke='currentColor'_stroke-width='2.2'_stroke-linecap='square'_stroke-linejoin='miter'/%3E%3C/svg%3E')] leg:[&:checked]:[background-position:center] leg:[&:checked]:[background-repeat:no-repeat] leg:[&:checked]:[background-size:15px_15px] leg:[&:checked]:[box-shadow:none] leg:[&:focus-visible]:[outline:1px_solid_var(--focus-ring)] leg:[&:focus-visible]:[outline-offset:3px] leg:pointer-coarse:relative leg:pointer-coarse:[&::before]:content-[''] leg:pointer-coarse:[&::before]:absolute leg:pointer-coarse:[&::before]:[inset:calc((17px_-_var(--touch-md))_/_2)] leg:[.stack-pref-control_&]:w-[20px] leg:[.stack-pref-control_&]:h-[20px] leg:[.stack-pref-control_&]:cursor-pointer leg:[.stack-pref-control_&]:rounded-[0]!"
                checked={active}
                aria-label={t("unifiedTraces.target", { name: target.name })}
                onChange={() => onToggleTarget(target.id)}
              />
              <span
                className="leg:w-[8px] leg:h-[8px] leg:rounded-[50%] leg:shrink-0 leg:[box-shadow:0_0_0_1px_var(--border)] leg:[transition:opacity_var(--motion-duration)_var(--motion-ease)] leg:[.curve-toggle:has(input:not(:checked))_&]:opacity-[0.3]"
                style={{ backgroundColor: traceSwatchColor(target.color) }}
              />
              <span className="leg:min-w-[0] leg:flex-[1_1_auto] leg:overflow-hidden leg:text-[color:var(--text)] leg:text-[length:var(--type-label)] leg:inline-flex leg:items-baseline leg:gap-[6px] leg:[transition:color_var(--motion-duration)_var(--motion-ease),_opacity_var(--motion-duration)_var(--motion-ease)] leg:[.curve-toggle:has(input:not(:checked))_&]:text-[color:var(--muted)]" title={target.name}>
                <span className="leg:min-w-[0] leg:overflow-hidden leg:text-ellipsis leg:whitespace-nowrap">{target.name}</span>
              </span>
            </label>
            <span
              className="leg:w-[18px] leg:h-[18px] leg:inline-flex leg:items-center leg:justify-center leg:text-[length:10px] leg:font-bold leg:leading-[1] leg:select-none leg:rounded-[2px] leg:[&.trace-type-measure]:text-[color:var(--green)] leg:[&.trace-type-measure]:[background:color-mix(in_srgb,_var(--green)_14%,_transparent)] leg:[&.trace-type-measure]:[outline:1px_solid_color-mix(in_srgb,_var(--green)_28%,_transparent)] leg:[&.trace-type-measure]:[outline-offset:-1px] leg:[&&.trace-type-target]:text-[color:var(--warning-foreground)] leg:[&&.trace-type-target]:[background:color-mix(in_srgb,_var(--yellow)_14%,_transparent)] leg:[&&.trace-type-target]:[outline:1px_solid_color-mix(in_srgb,_var(--yellow)_28%,_transparent)] leg:[&&.trace-type-target]:[outline-offset:-1px] trace-type-target"
              aria-hidden="true"
              title={t("unifiedTraces.targetTooltip")}
            >
              {t("unifiedTraces.targetBadge")}
            </span>
            {!target.builtIn ? (
              <Button
                variant="ghost"
                size="icon"
                className="curve-delete leg:w-[28px] leg:h-[28px] leg:min-h-[28px]! leg:max-h-[28px] leg:p-[0]! leg:inline-flex leg:items-center leg:justify-center leg:text-[color:var(--comment)]! leg:[background:transparent]! leg:[border:0]! leg:[outline:none]! leg:rounded-[2px] leg:opacity-[0.4] leg:cursor-pointer leg:[transition:color_var(--motion-duration)_var(--motion-ease),_background_var(--motion-duration)_var(--motion-ease),_opacity_var(--motion-duration)_var(--motion-ease)] leg:[.curve-item:hover_&]:opacity-[0.85] leg:[&:hover]:opacity-[1]! leg:[&:hover]:text-[color:var(--destructive-foreground)]! leg:[&:hover]:[background:color-mix(in_srgb,_var(--red)_14%,_transparent)]! leg:compact:w-[44px] leg:compact:min-h-[48px]!"
                title={t("unifiedTraces.delete", { name: target.name })}
                aria-label={t("unifiedTraces.delete", { name: target.name })}
                onClick={() => onRemoveTarget(target.id)}
              >
                <Icon name="delete" />
              </Button>
            ) : (
              <span className="leg:w-[28px] leg:h-[28px] leg:compact:w-[44px] leg:compact:h-[44px]" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
});
