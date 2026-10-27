import type { DeviceCapabilities } from "@/types";
import type { ComponentProps } from "react";
import { EqGraph } from "./EqGraph";
import type { EqEditor } from "../hooks/useEqEditor";

export type WorkspaceGraphProps = Pick<
  ComponentProps<typeof EqGraph>,
  | "capabilities"
  | "peq"
  | "committedPeq"
  | "selectedMeasurementId"
  | "measurements"
  | "targets"
  | "viewMode"
  | "theme"
  | "snapToIso"
> & {
  capabilities: DeviceCapabilities;
  editor: EqEditor;
  mobile: boolean;
  disabled: boolean;
};

export function WorkspaceGraph({
  editor,
  mobile,
  disabled,
  editing = false,
  focusBand = false,
  legendOpen,
  ...graph
}: WorkspaceGraphProps & {
  editing?: boolean;
  focusBand?: boolean;
  legendOpen?: boolean;
}) {
  const bands = graph.peq.filters
    .slice(0, graph.capabilities.num_bands)
    .filter((filter) => filter.enabled);
  const shownBandIndex =
    bands.find((filter) => filter.index === editor.activeBandIndex)?.index ??
    bands[0]?.index ??
    null;
  // Phones select dots without dragging; desktop exposes the full graph editor.
  const editingProps =
    editing && !mobile && !disabled && !editor.recoveryPending
      ? {
          activeBandIndex: editor.activeBandIndex,
          onActiveBandChange: editor.setActiveBandIndex,
          onStartChange: editor.handleStartChange,
          onFilterChange: editor.handleFilterChangeNoPreview,
        }
      : {};
  return (
    <EqGraph
      {...graph}
      activeBandIndex={focusBand ? shownBandIndex : undefined}
      bandCurves={mobile ? (focusBand ? "active" : "none") : "all"}
      onBandTap={
        mobile && focusBand && editing && !editor.recoveryPending
          ? editor.setActiveBandIndex
          : undefined
      }
      legendOpen={legendOpen}
      {...editingProps}
    />
  );
}
