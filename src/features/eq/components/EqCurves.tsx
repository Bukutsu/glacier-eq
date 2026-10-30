import { useTranslation } from "react-i18next";
import { useRef, useState, type ComponentProps } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Popover } from "@base-ui/react/popover";
import { traceSwatchColor } from "@/features/traces/lib/traceColor";
import { AddTraceModal } from "@/features/traces/components/AddTraceModal";
import { Icon } from "@/components/ui/Icon";
import { UnifiedTracesList } from "@/features/traces/components/UnifiedTraces";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type EqCurvesProps = ComponentProps<typeof UnifiedTracesList> &
  Pick<
    ComponentProps<typeof AddTraceModal>,
    "onAddMeasurement" | "onAddTarget" | "setStatus"
  >;

// Separate from the popup so filtering and selection use the same plain data.
function EqCurvesList({
  query,
  ...props
}: EqCurvesProps & { query: string }) {
  const { t } = useTranslation("editor");
  const search = query.trim().toLocaleLowerCase();
  const groups = [
    {
      label: t("curves.measurements"),
      kind: "measurement" as const,
      curves: props.measurements.map((trace) => ({
        ...trace,
        checked: trace.visible,
        removable: true,
        onToggle: () => props.onToggleMeasurement(trace.id),
        onRemove: () => props.onRemoveMeasurement(trace.id),
      })),
    },
    {
      label: t("curves.targets"),
      kind: "target" as const,
      curves: props.allTargets.map((target) => ({
        ...target,
        checked: props.activeTargetIds.includes(target.id),
        removable: !target.builtIn,
        onToggle: () => props.onToggleTarget(target.id),
        onRemove: () => props.onRemoveTarget(target.id),
      })),
    },
  ].map((group) => ({
    ...group,
    curves: group.curves.filter((curve) =>
      curve.name.toLocaleLowerCase().includes(search),
    ),
  }));

  return (
    <div className="leg:min-h-[0] leg:max-h-[240px] leg:overflow-y-auto leg:p-[0_6px_6px] leg:[overscroll-behavior:contain]">
      {groups.every((group) => group.curves.length === 0) ? (
        <p className="leg:m-[0] leg:p-[20px_8px] leg:text-center leg:text-[color:var(--muted)] leg:text-[length:12px]">
          {search ? t("curves.noMatch") : t("curves.empty")}
        </p>
      ) : (
        groups.map(
          (group) =>
            group.curves.length > 0 && (
              <fieldset className="eq-curves-group leg:min-w-[0] leg:[border:0] leg:m-[0] leg:p-[0] leg:[.eq-curves-group+&]:mt-[6px] leg:[.eq-curves-group+&]:pt-[6px] leg:[.eq-curves-group+&]:[border-top:1px_solid_var(--line-soft)]" key={group.label}>
                <legend>
                  {group.label} <span>{group.curves.length}</span>
                </legend>
                {group.curves.map((curve) => (
                  <div
                    className="leg:flex leg:items-center leg:rounded-[var(--control-radius)] leg:[&:hover]:[background:var(--accent)] leg:[&&:focus-within]:[background:var(--accent)]"
                    key={curve.id}
                    data-selected={curve.checked || undefined}
                  >
                    <label className="leg:flex leg:flex-[1] leg:min-w-[0] leg:items-center leg:gap-[8px] leg:min-h-[36px] leg:p-[6px_8px] leg:cursor-pointer leg:touchy:min-h-[44px]">
                      <Checkbox.Root
                        className="eq-curves-checkbox leg:inline-flex leg:flex-[0_0_auto] leg:w-[16px] leg:h-[16px] leg:items-center leg:justify-center leg:[border:1px_solid_var(--input)] leg:rounded-[4px] leg:[background:var(--field)] leg:[&[data-checked]]:[border-color:var(--primary)] leg:[&[data-checked]]:[background:var(--primary)] leg:[&[data-checked]]:text-[color:var(--primary-foreground)] leg:[&:focus-visible]:[outline:2px_solid_var(--ring)] leg:[&:focus-visible]:[outline-offset:2px]"
                        checked={curve.checked}
                        onCheckedChange={curve.onToggle}
                        aria-label={t(
                          group.kind === "measurement"
                            ? "curves.measurementName"
                            : "curves.targetName",
                          { name: curve.name },
                        )}
                      >
                        <Checkbox.Indicator>
                          <Icon name="check" />
                        </Checkbox.Indicator>
                      </Checkbox.Root>
                      <span
                        className="leg:flex-[0_0_auto] leg:w-[6px] leg:h-[6px] leg:rounded-[50%]"
                        style={{
                          backgroundColor: traceSwatchColor(curve.color),
                        }}
                      />
                      <span className="leg:overflow-hidden leg:text-ellipsis leg:whitespace-nowrap leg:text-[length:12px]" title={curve.name}>
                        {curve.name}
                      </span>
                    </label>
                    {curve.removable && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="eq-curves-delete leg:mr-[2px]"
                        aria-label={t("curves.delete", { name: curve.name })}
                        title={t("curves.delete", { name: curve.name })}
                        onClick={curve.onRemove}
                      >
                        <Icon name="delete" />
                      </Button>
                    )}
                  </div>
                ))}
              </fieldset>
            ),
        )
      )}
    </div>
  );
}

export function EqCurves(props: EqCurvesProps) {
  const { t } = useTranslation("editor");
  const [showAddModal, setShowAddModal] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const visibleCount =
    props.measurements.filter((trace) => trace.visible).length +
    props.allTargets.filter((target) =>
      props.activeTargetIds.includes(target.id),
    ).length;
  const addCurve = () => {
    setOpen(false);
    setShowAddModal(true);
  };

  return (
    <section className="leg:flex leg:items-center leg:gap-[2px] leg:min-w-[0] leg:compact:[.mobile-workspace_.graph-toolbar>&]:order-[0] leg:compact:[.mobile-workspace_.graph-toolbar>&]:flex-[none]" aria-label={t("curves.section")}>
      <Popover.Root
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
      >
        <Popover.Trigger
          render={<Button variant="ghost" className="eq-curves-trigger leg:text-[color:var(--foreground)] leg:[&[data-popup-open]]:[background:var(--accent)]" />}
        >
          <Icon name="tune" />
          {t("curves.title")}
          <span
            className="leg:inline-flex leg:items-center leg:justify-center leg:min-w-[20px] leg:h-[20px] leg:p-[0_5px] leg:rounded-[5px] leg:[background:var(--surface-soft)] leg:text-[color:var(--muted-foreground)] leg:text-[length:11px] leg:[font-variant-numeric:tabular-nums]"
            aria-label={t("curves.shown", { count: visibleCount })}
          >
            {visibleCount}
          </span>
          <Icon name="expand_more" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            className="cmp:z-[var(--z-popover)] cmp:[isolation:isolate]"
            side="bottom"
            align="end"
            sideOffset={8}
            collisionPadding={8}
          >
            <Popover.Popup className="leg:flex leg:flex-col leg:w-[300px] leg:max-w-[calc(100vw_-_16px)] leg:max-h-[var(--available-height)] leg:overflow-hidden leg:[border:1px_solid_var(--line-medium)] leg:rounded-[var(--radius-card)] leg:[background:var(--popover)] leg:text-[color:var(--popover-foreground)] leg:[box-shadow:var(--shadow-md)] leg:[outline:none]" initialFocus={searchRef}>
              <div className="eq-curves-popup-heading leg:p-[14px_14px_10px]">
                <Popover.Title>{t("curves.graphTitle")}</Popover.Title>
                <Popover.Description>
                  {t("curves.description")}
                </Popover.Description>
              </div>
              <div className="eq-curves-search leg:relative leg:m-[0_10px_8px] leg:flex-[0_0_auto]">
                <Icon name="search" />
                <Input
                  ref={searchRef}
                  style={{ paddingLeft: 32 }}
                  aria-label={t("curves.search")}
                  placeholder={t("curves.searchPlaceholder")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <EqCurvesList {...props} query={query} />
              <div className="eq-curves-footer leg:flex-[0_0_auto] leg:p-[6px] leg:[border-top:1px_solid_var(--line-soft)]">
                <Button variant="ghost" onClick={addCurve}>
                  <Icon name="add" /> {t("curves.add")}
                </Button>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <Button
        variant="ghost"
        size="icon"
        className="eq-curves-add"
        aria-label={t("curves.add")}
        title={t("curves.add")}
        onClick={addCurve}
      >
        <Icon name="add" />
      </Button>
      {showAddModal && (
        <AddTraceModal
          onClose={() => setShowAddModal(false)}
          onAddMeasurement={props.onAddMeasurement}
          onAddTarget={props.onAddTarget}
          setStatus={props.setStatus}
        />
      )}
    </section>
  );
}
