import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const hooks = vi.hoisted(() => ({
  slots: [] as any[], cursor: 0, effects: [] as (() => void | (() => void))[],
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const slot = hooks.cursor++;
    if (!(slot in hooks.slots)) hooks.slots[slot] = initial;
    return [hooks.slots[slot], (next: any) => {
      hooks.slots[slot] = typeof next === "function" ? next(hooks.slots[slot]) : next;
    }];
  },
  useRef: (current: unknown) => {
    const slot = hooks.cursor++;
    if (!(slot in hooks.slots)) hooks.slots[slot] = { current };
    return hooks.slots[slot];
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    const slot = hooks.cursor++;
    const prior = hooks.slots[slot];
    if (!prior || deps.some((dep, index) => dep !== prior.deps[index])) {
      prior?.cleanup?.();
      const record: any = { deps };
      hooks.slots[slot] = record;
      hooks.effects.push(() => { record.cleanup = effect(); });
    }
  },
}));
vi.mock("../lib/rpc", () => ({ invokeForDevice: vi.fn() }));
vi.mock("./ConfirmDialog", () => ({ confirmDialog: vi.fn() }));

import { invokeForDevice } from "../lib/rpc";
import { confirmDialog } from "./ConfirmDialog";
import { Ja11Controls } from "./Ja11Controls";

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function nodes(value: any): ReactElement<any>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !value.props) return [];
  return [value, ...nodes(value.props.children)];
}
function setup() {
  const props = { path: "/ja11", isBusy: false, setStatus: vi.fn() };
  const render = () => {
    hooks.cursor = 0;
    const tree = Ja11Controls(props);
    const effects = hooks.effects.splice(0);
    effects.forEach(effect => effect());
    return nodes(tree);
  };
  const field = (key: string) => render().find(node => node.props.id === `ja11-${key}`)!;
  const apply = (index: number) => render().filter(node => node.props.children === "Apply")[index].props;
  return { props, render, field, apply };
}

beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = [];
  vi.mocked(confirmDialog).mockReset().mockResolvedValue(true);
  vi.mocked(invokeForDevice).mockReset().mockImplementation(async (_path, _cmd, args) => {
    return (args?.value ?? (args?.control === "volume" ? 30 : 1)) as never;
  });
});

describe("JA11 control handlers", () => {
  it("loads fields independently; a failed field remains unknown and disabled", async () => {
    vi.mocked(invokeForDevice).mockImplementation(async (_path, _cmd, args) => {
      if (args?.control === "microphone") throw new Error("missing microphone reply");
      return (args?.control === "volume" ? 30 : 1) as never;
    });
    const s = setup();
    s.render(); await flush();
    expect(s.field("microphone").props.value).toBe("");
    expect(s.field("microphone").props.disabled).toBe(true);
    expect(s.field("uac").props.value).toBe("1");
    expect(s.field("uac").props.disabled).toBe(false);
    expect(s.field("volume").props.value).toBe(30);
    expect(vi.mocked(invokeForDevice).mock.calls.map(call => call[2]?.control)).toEqual(["microphone", "uac", "volume"]);
    expect(vi.mocked(invokeForDevice).mock.calls.every(call => call[2]?.value === undefined)).toBe(true);
  });

  it("requires explicit Apply and confirmation; cancel sends nothing", async () => {
    const s = setup(); s.render(); await flush();
    vi.mocked(invokeForDevice).mockClear();
    s.field("volume").props.onChange({ target: { value: "29" } });
    expect(invokeForDevice).not.toHaveBeenCalled();
    vi.mocked(confirmDialog).mockResolvedValueOnce(false);
    s.apply(2).onClick(); await flush();
    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: "Apply" }));
    expect(invokeForDevice).not.toHaveBeenCalled();
    s.apply(2).onClick(); await flush();
    expect(invokeForDevice).toHaveBeenCalledWith("/ja11", "ja11_control", { path: "/ja11", control: "volume", value: 29 });
    expect(s.field("volume").props.value).toBe(29);
  });

  it("clears every field after an unverified restart write and does not replay", async () => {
    const s = setup(); s.render(); await flush();
    s.field("uac").props.onChange("0");
    vi.mocked(invokeForDevice).mockClear().mockResolvedValueOnce(null);
    s.apply(1).onClick(); await flush();
    expect(s.props.setStatus).toHaveBeenCalledWith("JA11 setting sent. Reconnect the DAC to verify it.");
    for (const key of ["microphone", "uac", "volume"]) {
      expect(s.field(key).props.disabled).toBe(true);
    }
    s.apply(1).onClick(); await flush();
    expect(invokeForDevice).toHaveBeenCalledTimes(1);
    expect(s.render().some(node => node.props.role === "status")).toBe(true);
  });

  it("does not claim rollback on a write error; only the affected field becomes unknown", async () => {
    const s = setup(); s.render(); await flush();
    s.field("volume").props.onChange({ target: { value: "29" } });
    vi.mocked(invokeForDevice).mockRejectedValueOnce(new Error("uncertain delivery"));
    s.apply(2).onClick(); await flush();
    expect(s.field("volume").props.value).toBe("");
    expect(s.field("volume").props.disabled).toBe(true);
    expect(s.field("microphone").props.value).toBe("1");
    expect(s.props.setStatus).toHaveBeenCalledWith(expect.stringContaining("Could not verify"));
  });

  it("requires reconnect after an ambiguous microphone write error", async () => {
    const s = setup(); s.render(); await flush();
    s.field("microphone").props.onChange("0");
    vi.mocked(invokeForDevice).mockRejectedValueOnce(new Error("USB reset during write"));
    s.apply(0).onClick(); await flush();
    for (const key of ["microphone", "uac", "volume"]) expect(s.field(key).props.disabled).toBe(true);
    expect(s.props.setStatus).toHaveBeenCalledWith(expect.stringContaining("Reconnect the DAC"));
  });

  it("cancels a confirmed write if busy or path changes while the dialog is open", async () => {
    for (const change of ["busy", "path"]) {
      hooks.slots = [];
      const s = setup(); s.render(); await flush();
      s.field("volume").props.onChange({ target: { value: "29" } });
      let resolve!: (value: boolean) => void;
      vi.mocked(confirmDialog).mockReturnValueOnce(new Promise(r => { resolve = r; }));
      s.apply(2).onClick();
      if (change === "busy") s.props.isBusy = true;
      else s.props.path = "/replacement";
      s.render();
      vi.mocked(invokeForDevice).mockClear();
      resolve(true); await flush();
      expect(invokeForDevice).not.toHaveBeenCalledWith("/ja11", "ja11_control", expect.objectContaining({ value: 29 }));
    }
  });
});
