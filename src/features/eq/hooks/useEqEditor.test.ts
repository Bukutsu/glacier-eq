import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEqEditor } from "./useEqEditor";
import { useHistoryStore } from "../stores/historyStore";
import { useToastStore } from "@/stores/toastStore";
import { OFFLINE_EDITOR_CAPABILITIES } from "@/features/device/lib/dacSpecs";
import { buildDefaultState, DEFAULT_PROFILE_NAME } from "../lib/peq";
import type { DeviceState } from "@/features/device/hooks/useDeviceState";
import type { GraphPreview } from "./useGraphPreview";

// Exercise editor/profile/history composition without a DOM dependency.
const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  stateIndex: 0,
  refIndex: 0,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states))
      hooks.states[index] =
        typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [
      hooks.states[index],
      (value: unknown) => {
        hooks.states[index] =
          typeof value === "function"
            ? (value as (previous: unknown) => unknown)(hooks.states[index])
            : value;
      },
    ];
  },
  useRef: (initial: unknown) =>
    (hooks.refs[hooks.refIndex++] ??= { current: initial }),
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
}));
vi.mock("../stores/historyStore", async (original) => {
  const actual = await original<typeof import("../stores/historyStore")>();
  return {
    ...actual,
    useHistoryStore: Object.assign(
      (
        select: (
          state: ReturnType<typeof actual.useHistoryStore.getState>,
        ) => unknown,
      ) => select(actual.useHistoryStore.getState()),
      actual.useHistoryStore,
    ),
  };
});
vi.mock("./useEditorDraft", () => ({
  useEditorDraft: () => ({
    pendingDraft: null,
    draftInvalid: false,
    resolveDraft: vi.fn(),
  }),
}));
vi.mock("@/lib/rpc", () => ({
  invoke: async () => [
    {
      name: "Saved A",
      data: { ...buildDefaultState(), global_gain: -3 },
      modified: null,
    },
  ],
}));

let device: DeviceState;
function render() {
  hooks.stateIndex = hooks.refIndex = 0;
  // React hooks are replaced above; state and refs survive these explicit renders.
  // eslint-disable-next-line react-hooks/rules-of-hooks -- hook harness
  return useEqEditor(
    device,
    {
      startGraphPreview: vi.fn(),
      schedulePreviewDismiss: vi.fn(),
    } as unknown as GraphPreview,
    vi.fn(),
  );
}
async function ready() {
  await render().loadProfiles();
  return render();
}
function action() {
  const undo = useToastStore.getState().toasts.at(-1)?.action;
  expect(undo?.label).toBe("Undo");
  return undo!;
}

describe("recoverable editor replacements", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hooks.states = [];
    hooks.refs = [];
    useHistoryStore.setState(useHistoryStore.getInitialState(), true);
    device = {
      capabilities: OFFLINE_EDITOR_CAPABILITIES,
      connected: false,
      isBusy: false,
      eqOperationInFlightRef: { current: false },
      connectedRef: { current: false },
      connectionGenerationRef: { current: 0 },
      operationRevisionRef: { current: 0 },
    } as unknown as DeviceState;
  });
  afterEach(() => {
    for (const toast of useToastStore.getState().toasts)
      useToastStore.getState().removeToast(toast.id);
    vi.useRealTimers();
  });

  it.each(["saved", "imported"])(
    "restores %s EQ, name, baseline and unsaved state, then supports redo",
    async (source) => {
      let editor = await ready();
      if (source === "saved")
        editor.applyProfile(editor.profiles.find((p) => p.name === "Saved A")!);
      else
        editor.importPeq(
          { ...buildDefaultState(), global_gain: -2 },
          "Imported A",
          false,
        );
      editor = render();
      editor.handlePreampStartChange();
      editor.handlePreampChange(-5);
      editor = render();
      const previous = {
        peq: editor.peq,
        name: editor.selectedPreset,
        clean: editor.editorCleanPeqRef.current,
      };
      editor.applyProfile(editor.profiles[0]);
      editor = render();
      expect(editor.selectedPreset).toBe(DEFAULT_PROFILE_NAME);
      expect(editor.dirty).toBe(false);
      action().onClick();
      editor = render();
      expect(editor.peq).toEqual(previous.peq);
      expect(editor.selectedPreset).toBe(previous.name);
      expect(editor.editorCleanPeqRef.current).toEqual(previous.clean);
      expect(editor.dirty).toBe(true);
      editor.redo();
      editor = render();
      expect(editor.selectedPreset).toBe(DEFAULT_PROFILE_NAME);
      expect(editor.dirty).toBe(false);
    },
  );

  it("does not advertise a new Undo or change history when importing identical EQ", async () => {
    let editor = await ready();
    const data = { ...buildDefaultState(), global_gain: -2 };
    editor.importPeq(data, "Imported A", false);
    editor = render();
    vi.advanceTimersByTime(8001);
    const history = useHistoryStore.getState();
    expect(editor.importPeq(data, "Imported A", false)).toBe(true);
    expect(useHistoryStore.getState()).toBe(history);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("keeps normal Undo after the replacement message expires", async () => {
    let editor = await ready();
    editor.importPeq(
      { ...buildDefaultState(), global_gain: -2 },
      "First import",
      false,
    );
    editor = render();
    editor.importPeq(
      { ...buildDefaultState(), global_gain: -4 },
      "Second import",
      false,
    );
    editor = render();
    vi.advanceTimersByTime(8001);
    expect(useToastStore.getState().toasts).toEqual([]);
    editor.undo();
    editor = render();
    expect(editor.selectedPreset).toBe("First import");
    expect(editor.newProfileName).toBe("First import");
    expect(editor.peq.global_gain).toBe(-2);
    expect(editor.dirty).toBe(true);
  });

  it("removes the notice on a later edit and makes the old action harmless", async () => {
    let editor = await ready();
    editor.importPeq(buildDefaultState(), "Imported A", false);
    editor = render();
    const old = action();
    editor.handlePreampChange(-5);
    editor = render();
    expect(useToastStore.getState().toasts).toEqual([]);
    old.onClick();
    expect(render().peq.global_gain).toBe(-5);
  });

  it.each(["connectionGenerationRef", "operationRevisionRef"] as const)(
    "ignores a replacement action after %s changes",
    async (key) => {
      let editor = await ready();
      editor.importPeq(
        { ...buildDefaultState(), global_gain: -2 },
        "Imported A",
        false,
      );
      editor = render();
      device[key].current++;
      action().onClick();
      expect(render().selectedPreset).toBe("Imported A");
    },
  );

  it("does not undo while a device operation is busy", async () => {
    let editor = await ready();
    editor.importPeq(buildDefaultState(), "Imported A", false);
    editor = render();
    const previous = action();
    device.isBusy = true;
    render();
    previous.onClick();
    expect(render().selectedPreset).toBe("Imported A");
  });
});
