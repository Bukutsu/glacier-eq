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
export function EqCurvesList({
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
    <div className="eq-curves-list">
      {groups.every((group) => group.curves.length === 0) ? (
        <p className="eq-curves-empty">
          {search ? t("curves.noMatch") : t("curves.empty")}
        </p>
      ) : (
        groups.map(
          (group) =>
            group.curves.length > 0 && (
              <fieldset className="eq-curves-group" key={group.label}>
                <legend>
                  {group.label} <span>{group.curves.length}</span>
                </legend>
                {group.curves.map((curve) => (
                  <div
                    className="eq-curves-row"
                    key={curve.id}
                    data-selected={curve.checked || undefined}
                  >
                    <label className="eq-curves-option">
                      <Checkbox.Root
                        className="eq-curves-checkbox"
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
                        className="eq-curves-swatch"
                        style={{
                          backgroundColor: traceSwatchColor(curve.color),
                        }}
                      />
                      <span className="eq-curves-name" title={curve.name}>
                        {curve.name}
                      </span>
                    </label>
                    {curve.removable && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="eq-curves-delete"
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
    <section className="eq-curves" aria-label={t("curves.section")}>
      <Popover.Root
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
      >
        <Popover.Trigger
          render={<Button variant="ghost" className="eq-curves-trigger" />}
        >
          <Icon name="tune" />
          {t("curves.title")}
          <span
            className="eq-curves-count"
            aria-label={t("curves.shown", { count: visibleCount })}
          >
            {visibleCount}
          </span>
          <Icon name="expand_more" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            className="ui-popup-positioner"
            side="bottom"
            align="end"
            sideOffset={8}
            collisionPadding={8}
          >
            <Popover.Popup className="eq-curves-popup" initialFocus={searchRef}>
              <div className="eq-curves-popup-heading">
                <Popover.Title>{t("curves.graphTitle")}</Popover.Title>
                <Popover.Description>
                  {t("curves.description")}
                </Popover.Description>
              </div>
              <div className="eq-curves-search">
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
              <div className="eq-curves-footer">
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
