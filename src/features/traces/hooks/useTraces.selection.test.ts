import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTraces } from "./useTraces";
import type { MeasurementTrace, TargetTrace } from "@/types";

// Drive the hook's render/effect boundary without a DOM dependency.
const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
}));
vi.mock("react", async () => ({
  ...((await vi.importActual("react")) as object),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    const setter = (value: unknown) => {
      hooks.states[index] =
        typeof value === "function"
          ? (value as (current: unknown) => unknown)(hooks.states[index])
          : value;
    };
    if (!(index in hooks.states)) {
      hooks.states[index] =
        typeof initial === "function" ? (initial as () => unknown)() : initial;
    }
    return [hooks.states[index], setter];
  },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    return (hooks.refs[index] ??= { current: initial });
  },
  useEffect: (effect: () => void) => {
    hooks.effects.push(effect);
  },
  // No dispatcher outside a render: recompute instead of memoizing.
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
}));

const points = [
  { freq: 20, db: 0 },
  { freq: 1000, db: 0 },
];

function run() {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.effects.length = 0;
  // The mocked react hooks make this safe: no scheduler is involved.
  // eslint-disable-next-line react-hooks/rules-of-hooks -- test harness
  const result = useTraces();
  hooks.effects.forEach((effect) => effect());
  return result;
}

/** Read the committed state slots, not the stale closure snapshot. */
function committedState<T>(index: number): T {
  return hooks.states[index] as T;
}

describe("exclusive curve selection", () => {
  beforeEach(() => {
    hooks.states.length = 0;
    hooks.refs.length = 0;
    vi.stubGlobal("window", {
      localStorage: { getItem: () => null, setItem: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  });

  it("returns added curve IDs so Tuning can select the exact new input", () => {
    const result = run();
    const measurementId = result.addMeasurement("Headphone", points);
    const targetId = result.addTarget("Custom", points);
    expect(
      committedState<MeasurementTrace[]>(0).find((m) => m.id === measurementId)
        ?.name,
    ).toBe("Headphone");
    expect(
      committedState<TargetTrace[]>(1).find((t) => t.id === targetId)?.name,
    ).toBe("Custom");
    result.selectMeasurementOnly(measurementId);
    result.selectTargetOnly(targetId);
    expect(committedState<string[]>(2)).toEqual([targetId]);
    expect(committedState<string | null>(5)).toBe(measurementId);
  });

  it("makes one measurement visible and hides the others", () => {
    const result = run();
    result.addMeasurement("Alpha", points);
    result.addMeasurement("Beta", points);
    const beta = committedState<MeasurementTrace[]>(0)[1].id;

    result.selectMeasurementOnly(beta);

    expect(committedState<MeasurementTrace[]>(0).map((m) => m.visible)).toEqual(
      [false, true],
    );
    expect(committedState<string | null>(5)).toBe(beta);
  });

  it("keeps the measurements array identity when the selection already holds", () => {
    const result = run();
    result.addMeasurement("Alpha", points);
    result.addMeasurement("Beta", points);
    const beta = committedState<MeasurementTrace[]>(0)[1].id;
    result.selectMeasurementOnly(beta);
    const settled = committedState<MeasurementTrace[]>(0);

    result.selectMeasurementOnly(beta);

    expect(committedState<MeasurementTrace[]>(0)).toBe(settled);
  });

  it("makes one target active and clears the others", () => {
    const result = run();
    result.addTarget("First", points);
    result.addTarget("Second", points);
    const second = committedState<unknown[]>(1).length - 1;
    const secondId = result.allTargets[second].id;

    result.selectTargetOnly(secondId);

    expect(committedState<string[]>(2)).toEqual([secondId]);
  });
});
