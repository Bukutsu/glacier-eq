import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { AutoEqTab } from "./TuningPanel";
import { Button } from "@/components/ui/Button";
import { FileImportButton } from "@/components/ui/FileImportButton";
import { AddTraceModal } from "@/features/traces/components/AddTraceModal";
import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { openFileDialog } from "@/lib/rpc";

// Drive event handlers across renders without a DOM dependency.
const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  stateIndex: 0,
  refIndex: 0,
  cleanups: [] as (() => void)[],
}));
const selection = vi.hoisted(() => ({
  handleTargetChange: vi.fn(),
  handleMeasChange: vi.fn(),
  handleRunAutoEq: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<object>()),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
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
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    // Only run mount effects here; focus needs a real DOM and is browser-tested.
    if (deps?.length === 0) {
      const cleanup = effect();
      if (cleanup) hooks.cleanups.push(cleanup);
    }
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/rpc", () => ({ openFileDialog: vi.fn() }));
vi.mock("@/features/tuning/hooks/useAutoEq", () => ({
  useAutoEq: () => ({
    ...selection,
    nBands: 10,
    steps: 2000,
    smoothType: "IE",
    fs: 96000,
    warnings: [],
    isOptimizing: false,
    meas: null,
    target: null,
  }),
}));

function nodes(
  tree: ReactNode,
): { type: unknown; props: Record<string, unknown> }[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<{ children?: ReactNode }>(tree)) return [];
  return [
    { type: tree.type, props: tree.props },
    ...nodes(tree.props.children),
  ];
}

const props: Parameters<typeof AutoEqTab>[0] = {
  measurements: [],
  allTargets: [],
  onImportPEQ: vi.fn(() => true),
  setStatus: vi.fn(),
  onAddTarget: vi.fn(() => "new-target"),
  onAddMeasurement: vi.fn(() => "new-measurement"),
  getAsyncContext: () => ({
    editorRevision: 0,
    connectionRevision: 0,
    operationRevision: 0,
  }),
};
function render() {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- mocked hooks above
  return nodes(AutoEqTab(props));
}
function importTarget() {
  const button = render().find((n) => n.type === FileImportButton);
  return (button!.props.onImport as () => Promise<void>)();
}

beforeEach(() => {
  hooks.states = [];
  hooks.refs = [];
  hooks.cleanups = [];
  vi.clearAllMocks();
});

describe("Tuning imports select their input", () => {
  it("imports an ambiguously named file as a target and selects the returned ID", async () => {
    vi.mocked(openFileDialog).mockResolvedValue({
      name: "My curve.txt",
      text: "20 0\n1000 -2",
    });
    await importTarget();
    expect(props.onAddTarget).toHaveBeenCalledWith("My curve", [
      { freq: 20, db: 2 },
      { freq: 1000, db: 0 },
    ]);
    expect(selection.handleTargetChange).toHaveBeenCalledWith("new-target");
    expect(props.onAddMeasurement).not.toHaveBeenCalled();
    expect(selection.handleRunAutoEq).not.toHaveBeenCalled();
    expect(props.onImportPEQ).not.toHaveBeenCalled();
  });

  it("leaves selection untouched on cancellation", async () => {
    vi.mocked(openFileDialog).mockResolvedValue(null);
    await importTarget();
    expect(props.onAddTarget).not.toHaveBeenCalled();
    expect(selection.handleTargetChange).not.toHaveBeenCalled();
    expect(render().some((n) => n.type === ErrorNotice)).toBe(false);
  });

  it("shows a persistent error beside target import without changing selection", async () => {
    vi.mocked(openFileDialog).mockResolvedValue({
      name: "broken.txt",
      text: "not a curve",
    });
    await importTarget();
    expect(render().some((n) => n.type === ErrorNotice)).toBe(true);
    expect(props.onAddTarget).not.toHaveBeenCalled();
    expect(selection.handleTargetChange).not.toHaveBeenCalled();
  });

  it("ignores a picker completion after the panel unmounts", async () => {
    let finish!: (value: { name: string; text: string }) => void;
    vi.mocked(openFileDialog).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = importTarget();
    hooks.cleanups.forEach((cleanup) => cleanup());
    finish({ name: "late.txt", text: "20 0\n1000 -2" });
    await pending;
    expect(props.onAddTarget).not.toHaveBeenCalled();
  });

  it("opens measurement-only import and selects a newly added measurement", () => {
    const button = render().find(
      (n) =>
        n.type === Button &&
        nodes(n.props.children as ReactNode).some(
          (child) => child.props.name === "add",
        ),
    );
    (button!.props.onClick as () => void)();
    const modal = render().find((n) => n.type === AddTraceModal)!;
    expect(modal.props.importKind).toBe("measurement");
    (modal.props.onAddMeasurement as (name: string, points: []) => void)(
      "Headphone",
      [],
    );
    expect(selection.handleMeasChange).toHaveBeenCalledWith("new-measurement");
    expect(selection.handleTargetChange).not.toHaveBeenCalled();
    expect(selection.handleRunAutoEq).not.toHaveBeenCalled();
  });
});
