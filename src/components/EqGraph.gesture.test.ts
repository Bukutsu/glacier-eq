import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { EqGraph } from "./EqGraph";
import type { DeviceCapabilities, Filter } from "../types";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  memo: (component: unknown) => component,
  useRef: (current: unknown) => ({ current }),
  useState: (current: unknown) => [current, () => {}],
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
}));
vi.mock("../lib/materialYou", () => ({ useThemeVarsRevision: () => 0 }));

function setup() {
  const filter: Filter = { index: 0, enabled: true, filter_type: "Peak", freq: 1000, gain: 3, q: 1 };
  const change = vi.fn();
  const start = vi.fn();
  const root = (EqGraph as unknown as (props: unknown) => ReactElement)({
    peq: { global_gain: 0, filters: [filter] },
    measurements: [], targets: [], viewMode: "level",
    capabilities: { num_bands: 1, freq_range: [20, 20000], band_gain_range: [-12, 12], q_range: [0.1, 20] } as DeviceCapabilities,
    onActiveBandChange: vi.fn(), onStartChange: start, onFilterChange: change,
  });
  const shell = root.props.children[0];
  shell.props.ref.current = {};
  const canvas = shell.props.children[0];
  canvas.props.ref.current = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 300 }) };
  const handle = shell.props.children[1][0].props;
  let captured = false;
  const target = {
    setPointerCapture: () => { captured = true; },
    hasPointerCapture: () => captured,
    releasePointerCapture: () => { captured = false; },
  };
  const pointer = (y: number, shiftKey = true) => ({
    currentTarget: target, pointerId: 1, isPrimary: true, button: 0,
    clientX: 400, clientY: y, shiftKey,
  });
  return { handle, pointer, filter, change, start };
}

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
