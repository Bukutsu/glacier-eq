import { OFFLINE_EDITOR_CAPABILITIES } from "@/features/device/lib/dacSpecs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMelodyWorkspace } from "./useMelodyWorkspace";
import { buildDefaultState } from "@/features/eq/lib/peq";
import { invokeForDevice } from "@/lib/rpc";
import type { DeviceState } from "./useDeviceState";
import type { EqEditor } from "@/features/eq/hooks/useEqEditor";

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  si: 0,
  ri: 0,
  liveOptions: {} as Record<string, unknown>,
  pause: vi.fn(async () => {}),
  stop: vi.fn(),
  confirm: vi.fn(async () => true),
}));
vi.mock("react", async (original) => ({
  ...(await original<object>()),
  useState: (initial: unknown) => {
    const i = h.si++;
    if (!(i in h.states)) h.states[i] = initial;
    return [
      h.states[i],
      (v: unknown) => {
        h.states[i] = v;
      },
    ];
  },
  useRef: (initial: unknown) => (h.refs[h.ri++] ??= { current: initial }),
  useEffect: () => {},
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./useLiveApply", () => ({
  useLiveApply: (options: Record<string, unknown>) => {
    h.liveOptions = options;
    return { pause: h.pause, stop: h.stop };
  },
}));
vi.mock("@/lib/rpc", () => ({ invokeForDevice: vi.fn() }));
vi.mock("@/components/ui/ConfirmDialog", () => ({
  confirmDialog: h.confirm,
}));
vi.mock("@/lib/platform", () => ({ isTauri: () => false }));

function setup() {
  const peq = buildDefaultState();
  const device = {
    connected: true,
    selectedDevice: "/melody",
    isBusy: false,
    selectedDeviceInfo: {
      controls: "melody",
      profile_name: "SNOWSKY Melody",
      user_eq_slots: [160, 161, 162],
    },
    supportsRamApply: true,
    connectedPathRef: { current: "/melody" },
    connectedSessionIdRef: { current: 1 },
    connectionGenerationRef: { current: 1 },
    eqOperationInFlightRef: { current: false },
    lastPushedPeq: peq,
    capabilities: OFFLINE_EDITOR_CAPABILITIES,
    setLastPushedPeq: vi.fn(),
  } as unknown as DeviceState;
  const editor = {
    peq,
    peqRef: { current: peq },
    dirty: false,
    editorCleanPeqRef: { current: peq },
    setPeq: vi.fn(),
    setDirty: vi.fn(),
    noteEditorMutation: vi.fn(),
    getAsyncContext: () => ({
      editorRevision: 0,
      connectionRevision: 0,
      operationRevision: 0,
    }),
    pushToUndoStack: vi.fn(),
    setSelectedPreset: vi.fn(),
    setNewProfileName: vi.fn(),
    setProfileSearch: vi.fn(),
  } as unknown as EqEditor;
  const push = vi.fn(
    async (
      options: {
        onSaved?: () => void;
        melodySlot?: number;
        quiet?: boolean;
      } = {},
    ) => {
      options.onSaved?.();
    },
  );
  const options = {
    device,
    editor,
    push,
    runMaintenance: async (task: (current: () => boolean) => Promise<void>) => {
      await task(() => true);
    },
    setStatus: vi.fn(),
    onSwitchingChange: vi.fn(),
    editingBank: { current: null as number | null },
  };
  vi.mocked(invokeForDevice).mockImplementation(
    async (_path, command) => (command === "get_eq_state" ? peq : 160) as never,
  );
  const render = () => {
    h.si = 0;
    h.ri = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- mock hook harness
    return useMelodyWorkspace(options);
  };
  return { ...options, render };
}
beforeEach(() => {
  h.states = [];
  h.refs = [];
  vi.clearAllMocks();
  h.pause.mockResolvedValue();
  h.confirm.mockResolvedValue(true);
});

describe("Melody bank workspace", () => {
  it("opens a non-Melody bank with a display number independent of its wire ID", async () => {
    const t = setup();
    t.device.selectedDeviceInfo = {
      ...t.device.selectedDeviceInfo!,
      controls: null,
      profile_name: "FIIO BTR13",
      user_eq_slots: [7, 8, 9],
    };
    expect(await t.render().select(9)).toBe(true);
    expect(invokeForDevice).toHaveBeenCalledWith(
      "/melody",
      "set_user_eq_bank",
      {
        path: "/melody",
        slot: 9,
      },
    );
    expect(t.render().editorState?.bankNumber).toBe(3);
    expect(t.render().active).toBe(false);
    expect(await t.render().saveEditorToBank(8)).toBe(true);
    expect(t.push).toHaveBeenLastCalledWith(
      expect.objectContaining({ fiioSlot: 8 }),
    );
    expect(t.render().editorState?.bankNumber).toBe(2);
    expect(await t.render().select(160)).toBe(false);
  });

  it("arms default-on experimental live editing only after an explicit bank read", async () => {
    const t = setup();
    expect(t.render().active).toBe(false);
    await t.render().select(161);
    expect(t.editingBank.current).toBe(161);
    expect(t.render().bank).toBe(161);
    expect(t.render().active).toBe(true);
    expect(h.liveOptions.autoSave).toBe(false);
    expect(t.push).not.toHaveBeenCalled();
    expect(invokeForDevice).toHaveBeenCalledWith("/melody", "melody_control", {
      path: "/melody",
      value: 161,
    });
    expect(t.editor.setPeq).toHaveBeenCalled();
  });

  it("asks before discarding edits when switching banks and never saves implicitly", async () => {
    const t = setup();
    await t.render().select(160);
    t.editor.peq = { ...t.editor.peq, global_gain: -4 };
    expect(t.render().editorState?.unsaved).toBe(true);
    vi.mocked(invokeForDevice).mockClear();
    await t.render().select(162);
    expect(h.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "melodyBanks.discardTitle",
        message: "melodyBanks.discardMessage",
        confirmLabel: "melodyBanks.discardAndSwitch",
      }),
    );
    expect(t.push).not.toHaveBeenCalled();
    expect(t.editingBank.current).toBe(162);
    expect(h.pause).toHaveBeenCalled();
  });

  it("keeps the current bank and edits when the user cancels a bank switch", async () => {
    const t = setup();
    await t.render().select(160);
    t.editor.peq = { ...t.editor.peq, global_gain: -4 };
    h.confirm.mockResolvedValueOnce(false);
    h.pause.mockClear();
    vi.mocked(invokeForDevice).mockClear();
    expect(await t.render().select(161)).toBe(false);
    expect(invokeForDevice).not.toHaveBeenCalled();
    expect(t.render().bank).toBe(160);
    expect(t.render().enabled).toBe(true);
    expect(h.pause).not.toHaveBeenCalled();
  });

  it("saves the current editor to an explicit User bank without loading that bank over the editor", async () => {
    const t = setup();
    await t.render().select(160);
    t.editor.peq = { ...t.editor.peq, global_gain: -4 };
    const result = await t.render().saveEditorToBank(162);
    expect(result).toBe(true);
    expect(t.push).toHaveBeenCalledTimes(1);
    expect(t.push).toHaveBeenLastCalledWith(
      expect.objectContaining({ fiioSlot: 162 }),
    );
    expect(t.push.mock.calls[0][0]).not.toHaveProperty("quiet");
    expect(t.editingBank.current).toBe(162);
    expect(t.render().bank).toBe(162);
    expect(t.editor.setPeq).toHaveBeenCalledTimes(1); // only the initial User 1 read
    expect(t.editor.setDirty).toHaveBeenCalledWith(false);
  });

  it("keeps the current User bank selected if an explicit save is cancelled", async () => {
    const t = setup();
    await t.render().select(160);
    t.push.mockImplementation(async () => {});
    expect(await t.render().saveEditorToBank(162)).toBe(false);
    expect(t.editingBank.current).toBe(160);
    expect(t.render().bank).toBe(160);
  });

  it("drains any in-flight RAM preview before an explicit DAC write", async () => {
    const t = setup();
    await t.render().select(160);
    await t.render().pauseLiveForWrite();
    expect(h.pause).toHaveBeenCalled();
  });

  it("disarms immediately when the connection identity changes", async () => {
    const t = setup();
    await t.render().select(160);
    t.device.connectedSessionIdRef.current = 2;
    expect(t.render().bank).toBeNull();
    expect(t.render().active).toBe(false);
  });

  it("asks before leaving unsaved edits for playback controls", async () => {
    const t = setup();
    await t.render().select(160);
    t.editor.peq = { ...t.editor.peq, global_gain: -4 };
    vi.mocked(invokeForDevice).mockClear();
    expect(await t.render().beforeExternalChange()).toBe(true);
    expect(h.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "melodyBanks.discardTitle",
        confirmLabel: "melodyBanks.discardAction",
      }),
    );
    expect(t.push).not.toHaveBeenCalled();
    expect(t.editingBank.current).toBeNull();
    expect(t.render().active).toBe(false);
    expect(invokeForDevice).not.toHaveBeenCalled();
  });
});
