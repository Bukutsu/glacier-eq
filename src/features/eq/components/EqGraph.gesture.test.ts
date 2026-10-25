import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { i18n } from "@/lib/i18n";
import type { Namespace } from "i18next";
import { EqGraph } from "./EqGraph";
import type { DeviceCapabilities, Filter } from "@/types";

// These tests call components directly with mocked React hooks. Keep real
// catalog lookup without requiring a React render for useTranslation.
vi.mock("react-i18next", async (original) => ({
  ...(await original<typeof import("react-i18next")>()),
  useTranslation: (namespace: Namespace) => ({
    t: i18n.getFixedT(null, namespace),
    i18n,
    ready: true,
  }),
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  memo: (component: unknown) => component,
  useRef: (current: unknown) => ({ current }),
  useState: (current: unknown) => [current, () => {}],
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
}));
vi.mock("@/features/settings/hooks/useThemeVarsRevision", () => ({
  useThemeVarsRevision: () => 0,
}));

function setup() {
  const filter: Filter = {
    index: 0,
    enabled: true,
    filter_type: "Peak",
    freq: 1000,
    gain: 3,
    q: 1,
  };
  const change = vi.fn();
  const start = vi.fn();
  const active = vi.fn();
  const root = (EqGraph as unknown as (props: unknown) => ReactElement<any>)({
    peq: { global_gain: 0, filters: [filter] },
    measurements: [],
    targets: [],
    viewMode: "level",
    capabilities: {
      num_bands: 1,
      freq_range: [20, 20000],
      band_gain_range: [-12, 12],
      q_range: [0.1, 20],
    } as DeviceCapabilities,
    onActiveBandChange: active,
    onStartChange: start,
    onFilterChange: change,
  });
  const shell = root.props.children[0];
  shell.props.ref.current = {};
  const canvas = shell.props.children[0];
  canvas.props.ref.current = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 300 }),
  };
  const handle = shell.props.children[1][0].props;
  let captured = false;
  const target = {
    setPointerCapture: () => {
      captured = true;
    },
    hasPointerCapture: () => captured,
    releasePointerCapture: () => {
      captured = false;
    },
  };
  const pointer = (y: number, shiftKey = true, pointerType = "mouse") => ({
    currentTarget: target,
    pointerId: 1,
    isPrimary: true,
    pointerType,
    button: 0,
    clientX: 400,
    clientY: y,
    shiftKey,
  });
  return { handle, pointer, filter, change, start, active };
}

describe("EqGraph dot clicks", () => {
  it("selects the band on a short click without editing, snapshotting, or touching the DAC", () => {
    const s = setup();
    s.handle.onPointerDown(s.pointer(150, false));
    expect(s.active).toHaveBeenCalledExactlyOnceWith(0);
    s.handle.onPointerMove({ ...s.pointer(152, false), clientX: 402 });
    s.handle.onPointerUp(s.pointer(152, false));
    s.handle.onLostPointerCapture();
    expect(s.change).not.toHaveBeenCalled();
    expect(s.start).not.toHaveBeenCalled();
  });
  it("tolerates small jitter in both directions, with a larger allowance for touch", () => {
    const mouse = setup();
    mouse.handle.onPointerDown(mouse.pointer(150, false));
    mouse.handle.onPointerMove({ ...mouse.pointer(153, false), clientX: 402 });
    expect(mouse.change).not.toHaveBeenCalled();
    const touch = setup();
    touch.handle.onPointerDown(touch.pointer(150, false, "touch"));
    touch.handle.onPointerMove({
      ...touch.pointer(156, false, "touch"),
      clientX: 405,
    });
    expect(touch.change).not.toHaveBeenCalled();
    touch.handle.onPointerMove({
      ...touch.pointer(160, false, "touch"),
      clientX: 405,
    });
    expect(touch.change).toHaveBeenCalledTimes(1);
  });
  it("starts one undoable drag after the pointer travels past the threshold", () => {
    const s = setup();
    s.handle.onPointerDown(s.pointer(150, false));
    s.handle.onPointerMove(s.pointer(146, false));
    expect(s.change).toHaveBeenCalledTimes(1);
    expect(s.start).toHaveBeenCalledTimes(1);
    s.handle.onPointerMove(s.pointer(120, false));
    expect(s.start).toHaveBeenCalledTimes(1);
  });
  it("keeps a click that returns to its start as a selection", () => {
    const s = setup();
    s.handle.onPointerDown(s.pointer(150, false));
    s.handle.onPointerMove(s.pointer(151, false));
    s.handle.onPointerMove(s.pointer(150, false));
    expect(s.change).not.toHaveBeenCalled();
  });
});

describe("EqGraph cancellation", () => {
  it("restores the original filter after several moves, including a mode switch", () => {
    const s = setup();
    s.handle.onPointerDown(s.pointer(150, false));
    s.handle.onPointerMove(s.pointer(120, false));
    s.handle.onPointerMove(s.pointer(100));
    s.handle.onPointerMove(s.pointer(0));
    expect(s.change.mock.lastCall?.[1]).not.toEqual(s.filter);
    s.handle.onPointerCancel(s.pointer(0));
    expect(s.change).toHaveBeenLastCalledWith(0, s.filter);
    s.handle.onLostPointerCapture();
    s.change.mockClear();
    s.handle.onPointerMove(s.pointer(50));
    expect(s.change).not.toHaveBeenCalled();
    expect(s.start).toHaveBeenCalledTimes(1);
  });
  it("does not mutate a cancelled click", () => {
    const s = setup();
    s.handle.onPointerDown(s.pointer(150));
    s.handle.onPointerCancel(s.pointer(150));
    expect(s.change).not.toHaveBeenCalled();
  });
});

describe("EqGraph Shift-drag", () => {
  it("adjusts Q from the drag origin and keeps frequency and gain fixed", () => {
    const s = setup();
    s.handle.onPointerDown(s.pointer(150));
    s.handle.onPointerMove(s.pointer(50));
    expect(s.change).toHaveBeenLastCalledWith(0, { ...s.filter, q: 2 });
    s.handle.onPointerMove(s.pointer(250));
    expect(s.change).toHaveBeenLastCalledWith(0, { ...s.filter, q: 0.5 });
    expect(s.start).toHaveBeenCalledTimes(1);
  });
  it("clamps Q and stops updating after release", () => {
    const s = setup();
    s.handle.onPointerDown(s.pointer(150));
    s.handle.onPointerMove(s.pointer(-1000));
    expect(s.change.mock.lastCall?.[1].q).toBe(20);
    s.handle.onPointerMove(s.pointer(1000));
    expect(s.change.mock.lastCall?.[1].q).toBe(0.1);
    s.handle.onPointerUp(s.pointer(1000));
    s.handle.onLostPointerCapture();
    s.change.mockClear();
    s.handle.onPointerMove(s.pointer(50));
    expect(s.change).not.toHaveBeenCalled();
  });
  it("adjusts frequency and gain without Shift, preserving Q", () => {
    const s = setup();
    s.handle.onPointerDown(s.pointer(150, false));
    s.handle.onPointerMove({ ...s.pointer(100, false), clientX: 550 });
    const updated = s.change.mock.lastCall?.[1];
    expect(updated.freq).not.toBe(s.filter.freq);
    expect(updated.q).toBe(s.filter.q);
    expect(updated.gain).not.toBe(s.filter.gain);
  });
  it("can switch to Q mid-drag without a Q jump", () => {
    const s = setup();
    s.handle.onPointerDown(s.pointer(150, false));
    s.handle.onPointerMove(s.pointer(120, false));
    const moved = s.change.mock.lastCall?.[1];
    s.handle.onPointerMove(s.pointer(100));
    expect(s.change).toHaveBeenLastCalledWith(0, moved);
    s.handle.onPointerMove(s.pointer(0));
    expect(s.change).toHaveBeenLastCalledWith(0, { ...moved, q: 2 });
    const qAdjusted = s.change.mock.lastCall?.[1];
    s.handle.onPointerMove(s.pointer(0, false));
    expect(s.change).toHaveBeenLastCalledWith(0, qAdjusted);
    s.handle.onPointerMove({ ...s.pointer(20, false), clientX: 420 });
    const resumed = s.change.mock.lastCall?.[1];
    expect(resumed.q).toBe(2);
    expect(resumed.freq).not.toBe(qAdjusted.freq);
    expect(resumed.gain).toBeLessThan(qAdjusted.gain);
  });
});
