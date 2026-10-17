import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  cursor: 0,
  effects: [] as (() => void | (() => void))[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const slot = hooks.cursor++;
    if (!(slot in hooks.slots)) hooks.slots[slot] = initial;
    return [
      hooks.slots[slot],
      (next: any) => {
        hooks.slots[slot] =
          typeof next === "function" ? next(hooks.slots[slot]) : next;
      },
    ];
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
      hooks.effects.push(() => {
        record.cleanup = effect();
      });
    }
  },
}));
vi.mock("@/lib/rpc", () => ({
  invoke: vi.fn().mockResolvedValue(null),
  invokeForDevice: vi.fn(),
}));
vi.mock("@/components/ui/ConfirmDialog", () => ({ confirmDialog: vi.fn() }));

import { invokeForDevice } from "@/lib/rpc";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { Ja11Controls } from "./Ja11Controls";

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function nodes(value: any): ReactElement<any>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !value.props) return [];
  return [value, ...nodes(value.props.children)];
}
function setup() {
  const props = {
    path: "/ja11",
    isBusy: false,
    setStatus: vi.fn(),
    onExpectedDisconnect: vi.fn(),
    onReadFailure: vi.fn(async (_path: string, _error: unknown) => false),
  };
  const render = () => {
    hooks.cursor = 0;
    const tree = Ja11Controls(props);
    const effects = hooks.effects.splice(0);
    effects.forEach((effect) => effect());
    return nodes(tree);
  };
  // Normalizes the Switch (microphone), segmented row (uac) and Slider (volume)
  // to value/disabled/onChange so tests describe behavior, not markup.
  const field = (key: string) => {
    const tree = render();
    if (key === "microphone") {
      const node = tree.find((node) => node.props.id === "ja11-microphone")!;
      return {
        props: {
          value: node.props.checked ? "1" : "0",
          disabled: node.props.disabled,
          onChange: (value: string) =>
            node.props.onCheckedChange(value === "1"),
        },
      };
    }
    if (key === "uac") {
      const node = tree.find((node) => node.props.title === "USB audio mode")!;
      return {
        props: {
          value: node.props.value,
          disabled: node.props.disabled,
          onChange: node.props.onChange,
        },
      };
    }
    return tree.find((node) => node.props.id === "ja11-volume")!;
  };
  const apply = (index: number) =>
    render().filter((node) => node.props.children === "Apply")[index].props;
  return { props, render, field, apply };
}

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  vi.mocked(confirmDialog).mockReset().mockResolvedValue(true);
  vi.mocked(invokeForDevice)
    .mockReset()
    .mockImplementation(async (_path, _cmd, args) => {
      return (args?.value ?? (args?.control === "volume" ? 30 : 1)) as never;
    });
});

describe("JA11 control handlers", () => {
  const writes = () =>
    vi
      .mocked(invokeForDevice)
      .mock.calls.filter((call) => call[2]?.value !== undefined)
      .map((call) => call[2]);

  it("loads fields independently; a field that keeps failing stays unknown and disabled", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(invokeForDevice).mockImplementation(
        async (_path, _cmd, args) => {
          if (args?.control === "microphone")
            throw new Error("missing microphone reply");
          return (args?.control === "volume" ? 30 : 1) as never;
        },
      );
      const s = setup();
      s.render();
      await vi.advanceTimersByTimeAsync(3000);
      await flush();
      expect(s.field("microphone").props.disabled).toBe(true);
      expect(s.field("uac").props.value).toBe("1");
      expect(s.field("uac").props.disabled).toBe(false);
      expect(s.field("volume").props.value).toBe(30);
      const controls = vi
        .mocked(invokeForDevice)
        .mock.calls.map((call) => call[2]?.control);
      expect(controls).toEqual([
        "microphone",
        "uac",
        "volume",
        "microphone",
        "microphone",
      ]);
      expect(
        vi
          .mocked(invokeForDevice)
          .mock.calls.every((call) => call[2]?.value === undefined),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a transient read miss instead of showing a load failure", async () => {
    vi.useFakeTimers();
    try {
      let misses = 2;
      vi.mocked(invokeForDevice).mockImplementation(
        async (_path, _cmd, args) => {
          if (args?.control === "uac" && misses-- > 0)
            throw new Error("no reply");
          return (args?.control === "volume" ? 30 : 1) as never;
        },
      );
      const s = setup();
      s.render();
      await vi.advanceTimersByTimeAsync(3000);
      await flush();
      expect(s.field("uac").props.value).toBe("1");
      expect(s.field("uac").props.disabled).toBe(false);
      expect(s.props.setStatus).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads the controls once the app stops being busy instead of staying unloaded", async () => {
    const s = setup();
    s.props.isBusy = true;
    s.render();
    await flush();
    expect(invokeForDevice).not.toHaveBeenCalled();
    expect(s.field("volume").props.disabled).toBe(true);
    s.props.isBusy = false;
    s.render();
    await flush();
    expect(
      vi.mocked(invokeForDevice).mock.calls.map((call) => call[2]?.control),
    ).toEqual(["microphone", "uac", "volume"]);
    expect(s.field("microphone").props.disabled).toBe(false);
    expect(s.field("volume").props.value).toBe(30);
  });

  it("pauses a retry during EQ work and resumes it without a sticky row error", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(invokeForDevice).mockRejectedValueOnce(
        new Error("first reply missed"),
      );
      const s = setup();
      s.render();
      await flush();
      s.props.isBusy = true;
      s.render();
      await vi.advanceTimersByTimeAsync(400);
      await flush();
      // Nothing is sent during the busy period, even after the retry delay.
      expect(invokeForDevice).toHaveBeenCalledTimes(3);
      s.render(); // settle the interrupted load's working state
      s.props.isBusy = false;
      s.render();
      await flush();
      expect(s.field("microphone").props.disabled).toBe(false);
      expect(s.field("volume").props.value).toBe(30);
      expect(s.props.setStatus).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not make a failed in-flight read permanent when EQ work interrupts it", async () => {
    let rejectRead!: (error: Error) => void;
    vi.mocked(invokeForDevice).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRead = reject;
        }),
    );
    const s = setup();
    s.render();
    await flush();
    s.props.isBusy = true;
    s.render();
    rejectRead(new Error("device busy"));
    await flush();
    s.render();
    s.props.isBusy = false;
    s.render();
    await flush();
    expect(s.field("microphone").props.disabled).toBe(false);
    expect(s.field("volume").props.value).toBe(30);
  });

  it("cancels a delayed retry when the device path changes", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(invokeForDevice).mockRejectedValueOnce(
        new Error("old device missed"),
      );
      const s = setup();
      s.render();
      await flush();
      s.props.path = "/new-ja11";
      s.render();
      await flush();
      await vi.advanceTimersByTimeAsync(400);
      await flush();
      expect(
        vi
          .mocked(invokeForDevice)
          .mock.calls.filter((call) => call[0] === "/ja11"),
      ).toHaveLength(3);
      expect(s.field("volume").props.value).toBe(30);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands a silent control read to connection recovery instead of retrying a dead handle", async () => {
    const error = new Error("JA11 control read timeout");
    vi.mocked(invokeForDevice).mockRejectedValueOnce(error);
    const s = setup();
    s.props.onReadFailure.mockResolvedValue(true);
    s.render();
    await flush();
    expect(s.props.onReadFailure).toHaveBeenCalledExactlyOnceWith(
      "/ja11",
      error,
    );
    expect(invokeForDevice).toHaveBeenCalledTimes(1);
    expect(s.props.setStatus).not.toHaveBeenCalled();
  });

  it("recovers a disconnected mic write without repeating it or claiming rollback", async () => {
    const s = setup();
    s.render();
    await flush();
    vi.mocked(invokeForDevice).mockClear();
    const error = new Error(
      "WriteFile: (0x0000048F) The device is not connected.",
    );
    vi.mocked(invokeForDevice).mockRejectedValueOnce(error);
    s.props.onReadFailure.mockResolvedValue(true);
    s.field("microphone").props.onChange("0");
    await flush();
    expect(s.props.onReadFailure).toHaveBeenCalledExactlyOnceWith(
      "/ja11",
      error,
    );
    expect(writes()).toHaveLength(1);
    expect(s.props.setStatus).not.toHaveBeenCalled();
  });

  it("never retries a write", async () => {
    const s = setup();
    s.render();
    await flush();
    vi.mocked(invokeForDevice)
      .mockClear()
      .mockRejectedValue(new Error("USB reset during write"));
    s.field("microphone").props.onChange("0");
    await flush();
    expect(writes()).toHaveLength(1);
  });

  it("applies microphone and USB mode immediately, verified, without locking other fields", async () => {
    for (const key of ["microphone", "uac"]) {
      hooks.slots = [];
      const s = setup();
      s.render();
      await flush();
      vi.mocked(invokeForDevice).mockClear();
      s.field(key).props.onChange("0");
      await flush();
      expect(confirmDialog).not.toHaveBeenCalled();
      expect(writes()).toEqual([{ path: "/ja11", control: key, value: 0 }]);
      expect(s.field(key).props.value).toBe("0");
      for (const k of ["microphone", "uac", "volume"])
        expect(s.field(k).props.disabled).toBe(false);
      expect(vi.mocked(invokeForDevice)).toHaveBeenCalledTimes(1);
    }
  });

  it("marks a possible USB drop as expected only for writes, before sending", async () => {
    const s = setup();
    s.render();
    await flush();
    expect(s.props.onExpectedDisconnect).not.toHaveBeenCalled();
    vi.mocked(invokeForDevice).mockClear();
    s.field("microphone").props.onChange("0");
    await flush();
    expect(s.props.onExpectedDisconnect).toHaveBeenCalledOnce();
    expect(
      vi.mocked(s.props.onExpectedDisconnect).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(invokeForDevice).mock.invocationCallOrder[0]);
  });

  it("moves the slider immediately but sends the volume only on release", async () => {
    vi.useFakeTimers();
    try {
      const s = setup();
      s.render();
      await flush();
      vi.mocked(invokeForDevice).mockClear();
      s.field("volume").props.onChange({ target: { value: "31" } });
      expect(s.field("volume").props.value).toBe(31);
      s.field("volume").props.onChange({ target: { value: "32" } });
      await vi.advanceTimersByTimeAsync(2000);
      await flush(); // pausing mid-drag sends nothing
      expect(writes()).toEqual([]);
      s.field("volume").props.onEndChange();
      await flush();
      expect(writes()).toEqual([
        { path: "/ja11", control: "volume", value: 32 },
      ]);
      expect(s.field("volume").props.value).toBe(32);
    } finally {
      vi.useRealTimers();
    }
  });

  it("confirms only a large volume increase on release and restores the old value on cancel", async () => {
    vi.mocked(confirmDialog).mockResolvedValueOnce(false);
    const s = setup();
    s.render();
    await flush();
    vi.mocked(invokeForDevice).mockClear();
    s.field("volume").props.onChange({ target: { value: "50" } });
    expect(confirmDialog).not.toHaveBeenCalled();
    s.field("volume").props.onEndChange();
    await flush();
    expect(confirmDialog).toHaveBeenCalledOnce();
    expect(writes()).toEqual([]);
    expect(s.field("volume").props.value).toBe(30);
    s.field("volume").props.onChange({ target: { value: "40" } });
    s.field("volume").props.onEndChange();
    await flush();
    expect(confirmDialog).toHaveBeenCalledOnce();
    expect(writes()).toEqual([{ path: "/ja11", control: "volume", value: 40 }]);
  });

  it("leaves only an unverified field unknown and permits read-only refresh", async () => {
    const s = setup();
    s.render();
    await flush();
    vi.mocked(invokeForDevice).mockClear().mockResolvedValueOnce(null);
    s.field("uac").props.onChange("0");
    await flush();
    expect(s.props.setStatus).toHaveBeenCalledWith(
      expect.stringContaining("Sent 0, not verified"),
    );
    expect(s.field("uac").props.disabled).toBe(true);
    for (const key of ["microphone", "volume"])
      expect(s.field(key).props.disabled).toBe(false);
    const refresh = s
      .render()
      .find((node) => node.props["aria-label"] === "Refresh settings")!;
    vi.mocked(invokeForDevice).mockClear();
    refresh.props.onClick();
    await flush();
    expect(s.field("uac").props.disabled).toBe(false);
    expect(vi.mocked(invokeForDevice).mock.calls).toHaveLength(3);
    expect(
      vi
        .mocked(invokeForDevice)
        .mock.calls.every((call) => call[2]?.value === undefined),
    ).toBe(true);
  });

  it("does not claim rollback or retry on a write error", async () => {
    const s = setup();
    s.render();
    await flush();
    vi.mocked(invokeForDevice)
      .mockClear()
      .mockRejectedValueOnce(new Error("USB reset during write"));
    s.field("microphone").props.onChange("0");
    await flush();
    expect(writes()).toHaveLength(1);
    expect(s.field("microphone").props.disabled).toBe(true);
    expect(s.field("uac").props.disabled).toBe(false);
    expect(s.props.setStatus).toHaveBeenCalledWith(
      expect.stringContaining("outcome unknown"),
    );
  });

  it("sends nothing when a drag is cancelled (Escape / pointer cancel) and restores the value", async () => {
    const s = setup();
    s.render();
    await flush();
    vi.mocked(invokeForDevice).mockClear();
    s.field("volume").props.onChange({ target: { value: "20" } });
    // Slider calls onCancelChange, then onEndChange.
    s.field("volume").props.onCancelChange(30);
    s.field("volume").props.onEndChange();
    await flush();
    expect(writes()).toEqual([]);
    expect(s.field("volume").props.value).toBe(30);
  });

  it("sends nothing for a release that is a no-op or arrives after unmount", async () => {
    const s = setup();
    s.render();
    await flush();
    vi.mocked(invokeForDevice).mockClear();
    s.field("volume").props.onEndChange();
    await flush(); // click without moving
    expect(writes()).toEqual([]);
    s.field("volume").props.onChange({ target: { value: "29" } });
    const release = s.field("volume").props.onEndChange;
    for (const slot of hooks.slots) slot?.cleanup?.(); // unmount
    release();
    await flush();
    expect(writes()).toEqual([]);
  });

  it("drops a pending volume drag when the path changes", async () => {
    const s = setup();
    s.render();
    await flush();
    s.field("volume").props.onChange({ target: { value: "40" } });
    vi.mocked(invokeForDevice).mockClear();
    s.props.path = "/replacement";
    s.render();
    s.field("volume").props.onEndChange();
    await flush();
    expect(writes()).toEqual([]);
  });
});
