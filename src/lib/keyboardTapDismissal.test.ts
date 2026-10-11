import { afterEach, describe, expect, it, vi } from "vitest";
import { installKeyboardTapDismissal } from "./keyboardTapDismissal";

class MockElement extends EventTarget {
  blur = vi.fn();
  constructor(private text = false, private interactive = false) { super(); }
  matches() { return this.text; }
  closest() { return this.interactive ? this : null; }
}
afterEach(() => vi.unstubAllGlobals());
function setup() {
  vi.stubGlobal("HTMLElement", MockElement);
  vi.stubGlobal("Element", MockElement);
  const doc = Object.assign(new EventTarget(), { activeElement: new MockElement(true) });
  const blank = new MockElement();
  const interactive = new MockElement(false, true);
  const remove = installKeyboardTapDismissal(doc as unknown as Document);
  const send = (type: string, target = blank, x = 10, pointerId = 1, pointerType = "touch") => {
    const event = new Event(type);
    Object.defineProperty(event, "target", { value: target });
    Object.assign(event, { pointerId, pointerType, clientX: x, clientY: 10, isPrimary: true });
    doc.dispatchEvent(event);
  };
  return { doc, blank, interactive, remove, send };
}
describe("Android blank-area keyboard dismissal", () => {
  it("blurs text entry on a short blank-area touch without consuming the event", () => {
    const s = setup();
    s.send("pointerdown");
    s.send("pointerup");
    expect(s.doc.activeElement.blur).toHaveBeenCalledTimes(1);
    s.remove();
  });
  it("never blurs for an action/control, scrolling, cancellation, or a mouse", () => {
    const s = setup();
    s.send("pointerdown", s.interactive); s.send("pointerup", s.interactive);
    s.send("pointerdown"); s.send("pointermove", s.blank, 40); s.send("pointerup");
    s.send("pointerdown"); s.send("pointercancel"); s.send("pointerup");
    s.send("pointerdown", s.blank, 10, 1, "mouse"); s.send("pointerup");
    expect(s.doc.activeElement.blur).not.toHaveBeenCalled();
    s.remove();
  });
  it("does not dismiss newly focused fields and removes listeners", () => {
    const s = setup();
    const old = s.doc.activeElement;
    s.send("pointerdown");
    s.doc.activeElement = new MockElement(true);
    s.send("pointerup");
    expect(old.blur).not.toHaveBeenCalled();
    expect(s.doc.activeElement.blur).not.toHaveBeenCalled();
    s.remove();
    s.send("pointerdown"); s.send("pointerup");
    expect(s.doc.activeElement.blur).not.toHaveBeenCalled();
  });
});
