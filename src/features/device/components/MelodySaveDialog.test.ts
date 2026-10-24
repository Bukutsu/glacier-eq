import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { MelodySaveDialog, useMelodySaveDialog } from "./MelodySaveDialog";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { invokeForDevice } from "@/lib/rpc";

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as (() => void | (() => void))[],
  stateIndex: 0,
  refIndex: 0,
}));
vi.mock("react", async (original) => ({
  ...(await original<object>()),
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
            ? (value as (old: unknown) => unknown)(hooks.states[index])
            : value;
      },
    ];
  },
  useRef: (initial: unknown) =>
    (hooks.refs[hooks.refIndex++] ??= { current: initial }),
  useEffect: (effect: () => void | (() => void)) => {
    hooks.effects.push(effect);
  },
  useCallback: (callback: unknown) => callback,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/rpc", () => ({ invokeForDevice: vi.fn() }));

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
const onFinish = vi.fn();
const props: Parameters<typeof MelodySaveDialog>[0] = {
  request: {
    path: "/test-dialog",
    count: 10,
    preamp: "-8 dB",
    slots: [160, 161, 162],
    isMelody: true,
  },
  runMaintenance: async (task) => {
    await task(() => true);
  },
  onFinish,
};
function render() {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.effects = [];
  return nodes(MelodySaveDialog(props));
}
function submit() {
  const form = render().find((n) => n.type === "form")!;
  (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
    preventDefault: () => {},
  });
}
async function load() {
  render();
  hooks.effects.forEach((effect) => effect());
  await vi.waitFor(() => expect(hooks.states[1]).not.toBeNull());
}
beforeEach(() => {
  hooks.states = [];
  hooks.refs = [];
  hooks.effects = [];
  vi.clearAllMocks();
  vi.mocked(invokeForDevice).mockImplementation(
    async (_path, _command, args) => `NAME${args?.slot}` as never,
  );
});

describe("Melody save confirmation", () => {
  it("reads names without selecting playback or writing, then confirms the chosen bank", async () => {
    await load();
    expect(
      vi.mocked(invokeForDevice).mock.calls.map((call) => call[2]?.slot),
    ).toEqual([160, 161, 162]);
    expect(
      vi
        .mocked(invokeForDevice)
        .mock.calls.every(
          (call) => call[1] === "melody_name" && !("name" in call[2]!),
        ),
    ).toBe(true);
    expect(onFinish).not.toHaveBeenCalled();
    const picker = render().find((n) => n.type === Select)!;
    expect(picker.props.options).toEqual([
      { value: 160, label: "melodySave.userBankNamed" },
      { value: 161, label: "melodySave.userBankNamed" },
      { value: 162, label: "melodySave.userBankNamed" },
    ]);
    (picker.props.onChange as (id: number) => void)(162);
    expect(onFinish).not.toHaveBeenCalled();
    submit();
    expect(onFinish).toHaveBeenCalledWith(162);
  });

  it("does not allow saving before names finish loading", () => {
    const button = render().find(
      (n) => n.type === Button && n.props.type === "submit",
    )!;
    expect(button.props.disabled).toBe(true);
    submit();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("survives StrictMode effect replay without taking the operation slot twice", async () => {
    render();
    const effect = hooks.effects[0];
    const cleanup = effect();
    if (cleanup) cleanup();
    effect();
    await vi.waitFor(() => expect(hooks.states[1]).not.toBeNull());
    expect(invokeForDevice).toHaveBeenCalledTimes(3);
  });

  it("keeps a read failure recoverable and prevents saving", async () => {
    vi.mocked(invokeForDevice).mockRejectedValue(new Error("read timeout"));
    render();
    hooks.effects.forEach((effect) => effect());
    await vi.waitFor(() => expect(hooks.states[2]).toBeInstanceOf(Error));
    expect(render().some((n) => n.type === ErrorNotice)).toBe(true);
    submit();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("cancels a pending confirmation when its connection is replaced", async () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- mocked hooks above
    const dialog = useMelodySaveDialog("connection-1");
    const cleanup = hooks.effects[0]();
    const pending = dialog.choose(props.request);
    if (cleanup) cleanup();
    await expect(pending).resolves.toBeNull();
  });
});
