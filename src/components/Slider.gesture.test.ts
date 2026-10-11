import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { Slider } from "./Slider";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: (current: unknown) => ({ current }),
  useEffect: () => {},
}));

// Exercise the actual input handlers without adding a DOM dependency.
function setup(disabled = false) {
  const calls: unknown[] = [];
  const win = new EventTarget();
  const input = { value: "3", ownerDocument: { defaultView: win } };
  const element = Slider({
    value: 3, disabled,
    onStartChange: () => calls.push("start"),
    onEndChange: () => calls.push("end"),
    onCancelChange: (value) => calls.push(value),
    onChange: () => calls.push("live"),
    onBlur: () => calls.push("blur"),
    onReset: () => calls.push("reset"),
  });
  const range = element.props.children.find((child: ReactElement | false) => child && child.type === "input");
  const handlers = range.props;
  const pointer = (pointerId = 1) => ({ currentTarget: input, pointerId, button: 0, isPrimary: true });
  const key = (key: string, repeat = false) => ({ currentTarget: input, key, repeat });
  const outside = (type: string, pointerId = 1) => {
    const event = new Event(type);
    Object.assign(event, { pointerId });
    win.dispatchEvent(event);
  };
  return { calls, input, handlers, pointer, key, outside, win };
}

describe("Slider gesture handlers", () => {
  it("keeps live changes and ends outside release exactly once", () => {
    const s = setup();
    s.handlers.onPointerDown(s.pointer());
    s.handlers.onPointerDown(s.pointer());
    s.handlers.onChange({});
    s.outside("pointerup", 2);
    expect(s.calls).toEqual(["start", "live"]);
    s.outside("pointerup");
    s.handlers.onPointerUp(s.pointer());
    s.handlers.onBlur({});
    expect(s.calls).toEqual(["start", "live", "end", "blur"]);
  });
  it("restores the original value before ending cancellation", () => {
    const s = setup();
    s.handlers.onPointerDown(s.pointer());
    s.input.value = "8";
    s.outside("pointercancel");
    s.handlers.onPointerCancel(s.pointer());
    expect(s.calls).toEqual(["start", 3, "end"]);
    s.handlers.onPointerDown(s.pointer());
    s.handlers.onPointerCancel(s.pointer());
    expect(s.calls).toEqual(["start", 3, "end", "start", 8, "end"]);
  });
  it("groups key repeats and overlapping adjustment keys; blur ends missing keyup", () => {
    const s = setup();
    s.handlers.onKeyDown(s.key("ArrowRight"));
    s.handlers.onKeyDown(s.key("ArrowRight", true));
    s.handlers.onKeyDown(s.key("Home"));
    s.handlers.onBlur({});
    s.handlers.onKeyUp(s.key("Home"));
    expect(s.calls).toEqual(["start", "end", "blur"]);
    s.handlers.onKeyDown(s.key("PageDown"));
    s.handlers.onKeyDown(s.key("Escape"));
    expect(s.calls).toEqual(["start", "end", "blur", "start", 3, "end"]);
  });
  it("ends on window focus loss and removes the old outside listener", () => {
    const s = setup();
    s.handlers.onPointerDown(s.pointer());
    s.win.dispatchEvent(new Event("blur"));
    s.outside("pointercancel");
    expect(s.calls).toEqual(["start", "end"]);
  });
  it("preserves reset boundaries and disabled guards", () => {
    const s = setup();
    s.handlers.onDoubleClick({ currentTarget: s.input });
    expect(s.calls).toEqual(["start", "reset", "end"]);
    const disabled = setup(true);
    disabled.handlers.onPointerDown(disabled.pointer());
    disabled.handlers.onKeyDown(disabled.key("End"));
    disabled.handlers.onDoubleClick({ currentTarget: disabled.input });
    expect(disabled.calls).toEqual([]);
  });
});
