import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoEq, type AutoEqOptions } from "./useAutoEq";
import { BUILTIN_TARGETS } from "@/features/traces/lib/builtinTargets";
import type { MeasurementTrace, MeasurementPoint } from "@/types";

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
    if (!(index in hooks.states)) {
      hooks.states[index] =
        typeof initial === "function" ? (initial as () => unknown)() : initial;
    }
    return [
      hooks.states[index],
      (value: unknown) => {
        hooks.states[index] = value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    return (hooks.refs[index] ??= { current: initial });
  },
  useEffect: (effect: () => void) => {
    hooks.effects.push(effect);
  },
}));
vi.mock("@glacier-eq/backend", () => ({
  invoke: vi.fn(),
  listen: vi.fn(async () => () => {}),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const points: MeasurementPoint[] = [
  { freq: 20, db: 0 },
  { freq: 1000, db: 0 },
];

function measurement(
  id: string,
  overrides: Partial<MeasurementTrace> = {},
): MeasurementTrace {
  return { id, name: id, color: "red", visible: true, points, ...overrides };
}

function selectionSpies() {
  return {
    onSelectMeasurementOnly: vi.fn(),
    onSelectTargetOnly: vi.fn(),
    onToggleMeasurement: vi.fn(),
    onToggleTarget: vi.fn(),
    onSelectedMeasurementChange: vi.fn(),
  } satisfies Partial<AutoEqOptions>;
}

function run(options: Partial<AutoEqOptions> = {}) {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.effects.length = 0;
  const base: AutoEqOptions = {
    measurements: [],
    allTargets: [],
    onImportPEQ: () => true,
    setStatus: () => {},
    getAsyncContext: () => ({
      editorRevision: 0,
      connectionRevision: 0,
      operationRevision: 0,
    }),
  };
  // The mocked react hooks make this safe: no scheduler is involved.
  // eslint-disable-next-line react-hooks/rules-of-hooks -- test harness
  const handlers = useAutoEq({ ...base, ...options });
  hooks.effects.forEach((effect) => effect());
  return handlers;
}

describe("AutoEQ selection owns the graph curves", () => {
  beforeEach(() => {
    hooks.states.length = 0;
    hooks.refs.length = 0;
  });

  it("adopts the initial measurement and target exclusively", () => {
    const spies = selectionSpies();
    run({
      measurements: [
        measurement("alpha"),
        measurement("beta"),
        measurement("gamma"),
      ],
      allTargets: BUILTIN_TARGETS,
      activeTargetIds: [BUILTIN_TARGETS[0].id, BUILTIN_TARGETS[1].id],
      ...spies,
    });

    expect(spies.onSelectMeasurementOnly).toHaveBeenCalledWith("alpha");
    expect(spies.onSelectTargetOnly).toHaveBeenCalledWith(
      BUILTIN_TARGETS[0].id,
    );
  });

  it("draws the dropdown's default target when no target is active", () => {
    const spies = selectionSpies();
    run({
      allTargets: BUILTIN_TARGETS,
      activeTargetIds: [],
      ...spies,
    });

    expect(spies.onSelectTargetOnly).toHaveBeenCalledWith(
      BUILTIN_TARGETS[0].id,
    );
  });

  it("selecting a measurement makes it the only visible curve", () => {
    const spies = selectionSpies();
    const handlers = run({
      measurements: [measurement("alpha"), measurement("beta")],
      ...spies,
    });

    handlers.handleMeasChange("beta");

    expect(spies.onSelectMeasurementOnly).toHaveBeenCalledWith("beta");
    expect(spies.onToggleMeasurement).not.toHaveBeenCalled();
  });

  it("selecting a target makes it the only active curve", () => {
    const spies = selectionSpies();
    const handlers = run({
      allTargets: BUILTIN_TARGETS,
      activeTargetIds: [BUILTIN_TARGETS[0].id],
      ...spies,
    });

    handlers.handleTargetChange(BUILTIN_TARGETS[2].id);

    expect(spies.onSelectTargetOnly).toHaveBeenCalledWith(
      BUILTIN_TARGETS[2].id,
    );
    expect(spies.onToggleTarget).not.toHaveBeenCalled();
  });

  it("matches one measurement to another and shows both, without targets", () => {
    const spies = selectionSpies();
    const handlers = run({
      measurements: [measurement("alpha"), measurement("beta")],
      allTargets: BUILTIN_TARGETS,
      activeTargetIds: [BUILTIN_TARGETS[0].id],
      ...spies,
    });

    handlers.handleReferenceChange("measurement:beta");

    expect(spies.onSelectMeasurementOnly).toHaveBeenLastCalledWith(
      "alpha",
      "beta",
    );
    expect(spies.onSelectTargetOnly).toHaveBeenLastCalledWith(null);
    const after = run({
      measurements: [measurement("alpha"), measurement("beta")],
      allTargets: BUILTIN_TARGETS,
      activeTargetIds: [],
      ...spies,
    });
    expect(after.meas?.id).toBe("alpha");
    expect(after.target?.id).toBe("beta");
    expect(after.reference).toEqual({ kind: "measurement", id: "beta" });
  });

  it("never matches a measurement to itself", () => {
    const spies = selectionSpies();
    const handlers = run({
      measurements: [measurement("alpha"), measurement("beta")],
      allTargets: BUILTIN_TARGETS,
      activeTargetIds: [BUILTIN_TARGETS[0].id],
      ...spies,
    });
    handlers.handleReferenceChange("measurement:alpha");
    expect(spies.onSelectTargetOnly).not.toHaveBeenCalledWith(null);

    handlers.handleReferenceChange("measurement:beta");
    const matched = run({
      measurements: [measurement("alpha"), measurement("beta")],
      allTargets: BUILTIN_TARGETS,
      activeTargetIds: [],
      ...spies,
    });
    // Correcting the reference itself drops back to a target curve.
    matched.handleMeasChange("beta");
    const after = run({
      measurements: [measurement("alpha"), measurement("beta")],
      allTargets: BUILTIN_TARGETS,
      activeTargetIds: [],
      ...spies,
    });
    expect(after.meas?.id).toBe("beta");
    expect(after.reference?.kind).toBe("target");
    expect(spies.onSelectTargetOnly).toHaveBeenLastCalledWith(
      BUILTIN_TARGETS[0].id,
    );
  });

  it("falls back to plain toggling when no exclusive callback is given", () => {
    // Both spies stay out of the callbacks so the fallback branch is real.
    const onToggleMeasurement = vi.fn();
    const onToggleTarget = vi.fn();
    const handlers = run({
      measurements: [
        measurement("alpha"),
        measurement("beta", { visible: false }),
      ],
      allTargets: BUILTIN_TARGETS,
      onToggleMeasurement,
      onToggleTarget,
    });

    handlers.handleMeasChange("beta");
    handlers.handleTargetChange(BUILTIN_TARGETS[2].id);

    expect(onToggleMeasurement).toHaveBeenCalledWith("beta");
    expect(onToggleTarget).toHaveBeenCalledWith(BUILTIN_TARGETS[2].id);
  });
});
