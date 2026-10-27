import { describe, expect, it, vi } from "vitest";
import type { EqEditor } from "../hooks/useEqEditor";
import { buildDefaultState } from "../lib/peq";
import { OFFLINE_EDITOR_CAPABILITIES } from "@/features/device/lib/dacSpecs";
import { WorkspaceGraph, type WorkspaceGraphProps } from "./WorkspaceGraph";

function setup() {
  const peq = buildDefaultState();
  peq.filters[0].enabled = true;
  peq.filters[1].enabled = true;
  const editor = {
    activeBandIndex: 99,
    setActiveBandIndex: vi.fn(),
    handleStartChange: vi.fn(),
    handleFilterChangeNoPreview: vi.fn(),
    recoveryPending: false,
  } as unknown as EqEditor;
  const props: WorkspaceGraphProps = {
    editor,
    peq,
    capabilities: OFFLINE_EDITOR_CAPABILITIES,
    mobile: true,
    disabled: false,
    measurements: [],
    targets: [],
    viewMode: "shape",
  };
  return { props, editor };
}

describe("workspace graph interaction policy", () => {
  it("falls back to the first enabled band and allows mobile selection, never dragging", () => {
    const { props, editor } = setup();
    const graph = WorkspaceGraph({ ...props, editing: true, focusBand: true });
    expect(graph.props.activeBandIndex).toBe(0);
    expect(graph.props.bandCurves).toBe("active");
    graph.props.onBandTap?.(1);
    expect(editor.setActiveBandIndex).toHaveBeenCalledExactlyOnceWith(1);
    expect(graph.props.onFilterChange).toBeUndefined();
    expect(graph.props.onStartChange).toBeUndefined();
  });

  it("keeps tuning and floating previews display-only", () => {
    const { props } = setup();
    const tuning = WorkspaceGraph(props);
    expect(tuning.props.bandCurves).toBe("none");
    expect(tuning.props.onBandTap).toBeUndefined();
    const preview = WorkspaceGraph({ ...props, focusBand: true });
    expect(preview.props.bandCurves).toBe("active");
    expect(preview.props.onBandTap).toBeUndefined();
    expect(preview.props.onFilterChange).toBeUndefined();
  });

  it("attaches editor callbacks on desktop only in the EQ workspace", () => {
    const { props, editor } = setup();
    const graph = WorkspaceGraph({ ...props, mobile: false, editing: true });
    expect(graph.props.bandCurves).toBe("all");
    expect(graph.props.onFilterChange).toBe(editor.handleFilterChangeNoPreview);
    expect(graph.props.onStartChange).toBe(editor.handleStartChange);
    expect(graph.props.onActiveBandChange).toBe(editor.setActiveBandIndex);
    expect(
      WorkspaceGraph({ ...props, mobile: false }).props.onFilterChange,
    ).toBeUndefined();
  });

  it("disables desktop graph editing while device operations are busy", () => {
    const { props } = setup();
    const graph = WorkspaceGraph({
      ...props,
      mobile: false,
      editing: true,
      disabled: true,
    });
    expect(graph.props.onFilterChange).toBeUndefined();
    expect(graph.props.onStartChange).toBeUndefined();
    expect(graph.props.onActiveBandChange).toBeUndefined();
  });

  it("disables both mobile selection and desktop edits during draft recovery", () => {
    const { props, editor } = setup();
    editor.recoveryPending = true;
    expect(
      WorkspaceGraph({ ...props, editing: true, focusBand: true }).props
        .onBandTap,
    ).toBeUndefined();
    expect(
      WorkspaceGraph({ ...props, mobile: false, editing: true }).props
        .onFilterChange,
    ).toBeUndefined();
  });
});
