import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactElement } from "react";
import { EqGraph } from "./EqGraph";
import { OFFLINE_EDITOR_CAPABILITIES } from "@/features/device/lib/dacSpecs";
import { fittedMoondropShelf } from "../lib/graphMath.test-support";
import { peqResponseValues, peqResponseAndBandValues } from "../lib/graph";
import type { ResponseModel } from "@/types";

const hooks = vi.hoisted(() => ({ callbacks: [] as unknown[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  memo: (component: unknown) => component,
  useRef: (current: unknown) => ({ current }),
  useState: (current: unknown) => [current, vi.fn()],
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => {
    hooks.callbacks.push(fn);
    return fn;
  },
  useEffect: () => {},
}));
vi.mock("@/features/settings/hooks/useThemeVarsRevision", () => ({
  useThemeVarsRevision: () => 0,
}));
vi.mock("../lib/graph", async (original) => {
  const graph = await original<typeof import("../lib/graph")>();
  return {
    ...graph,
    peqResponseValues: vi.fn(graph.peqResponseValues),
    peqResponseAndBandValues: vi.fn(graph.peqResponseAndBandValues),
  };
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function drawGraph(overrides: Partial<ComponentProps<typeof EqGraph>>) {
  hooks.callbacks = [];
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  const props: ComponentProps<typeof EqGraph> = {
    peq: { filters: [fittedMoondropShelf], global_gain: -2 },
    committedPeq: {
      filters: [{ ...fittedMoondropShelf, gain: 3 }],
      global_gain: -1,
    },
    measurements: [],
    targets: [],
    viewMode: "shape",
    ...overrides,
  };
  const root = (
    EqGraph as unknown as (
      props: ComponentProps<typeof EqGraph>,
    ) => ReactElement<any>
  )(props);
  const context = new Proxy({} as CanvasRenderingContext2D, {
    get: (target, key) => {
      if (key === "measureText") return () => ({ width: 20 });
      return Reflect.get(target, key) ?? vi.fn();
    },
  });
  const canvas = root.props.children[0].props.children[0];
  canvas.props.ref.current = {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ width: 600, height: 300 }),
    getContext: () => context,
  };
  // First callback is the real canvas draw function. Effects/animation are
  // disabled here so each test exercises one deterministic complete frame.
  await (hooks.callbacks[0] as () => Promise<void>)();
}

describe("graph response context", () => {
  it.each([false, true])(
    "uses the model for curves, normalization, committed preview and measurement dots (measurement=%s)",
    async (measurement) => {
      const capabilities = {
        ...OFFLINE_EDITOR_CAPABILITIES,
        response_model: "MoondropShelfSlope" as const,
      };
      await drawGraph({
        capabilities,
        measurements: measurement
          ? [
              {
                id: "measurement",
                name: "Fixture",
                color: "#abcdef",
                visible: true,
                points: [
                  { freq: 20, db: 2 },
                  { freq: 20000, db: 2 },
                ],
              },
            ]
          : [],
      });
      const aggregateCalls = vi.mocked(peqResponseValues).mock.calls;
      const bandCalls = vi.mocked(peqResponseAndBandValues).mock.calls;
      expect(bandCalls).toHaveLength(1);
      expect(aggregateCalls.length).toBeGreaterThanOrEqual(measurement ? 5 : 3);
      for (const call of [...aggregateCalls, ...bandCalls]) {
        expect(call[3]).toBe(96000);
        expect(call[4]).toBe("MoondropShelfSlope");
      }
      expect(aggregateCalls.some((call) => call[1][0] === 1000)).toBe(true);
      expect(aggregateCalls.some((call) => call[0].filters[0].gain === 3)).toBe(
        true,
      );
      if (measurement)
        expect(
          aggregateCalls.some(
            (call) =>
              call[1].length === 1 && call[1][0] === fittedMoondropShelf.freq,
          ),
        ).toBe(true);
    },
  );

  it.each([undefined, "CanonicalQ"] as const)(
    "keeps canonical fallback for response model %s",
    async (model: ResponseModel | undefined) => {
      await drawGraph({
        capabilities: model
          ? { ...OFFLINE_EDITOR_CAPABILITIES, response_model: model }
          : undefined,
        viewMode: "level",
      });
      for (const call of vi.mocked(peqResponseAndBandValues).mock.calls)
        expect(call[4]).toBe("CanonicalQ");
    },
  );
});
