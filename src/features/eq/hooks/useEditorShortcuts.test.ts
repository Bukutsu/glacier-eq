import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorShortcuts } from "./useEditorShortcuts";

const effects = vi.hoisted(() => [] as (() => void | (() => void))[]);
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => effects.push(effect),
}));
vi.mock("react-dom", () => ({
  flushSync: (callback: () => void) => callback(),
}));

class Input {
  type = "text";
  value = "7";
  role = "spinbutton";
  onBlur = () => {};
  getAttribute(name: string) {
    return name === "role" ? this.role : null;
  }
  blur() {
    this.onBlur();
  }
}

let events: EventTarget;
let input: Input;
let cleanup: (() => void)[];
let saved: number;
let read: number;
let reset: number;
let committed: number;

function shortcut(key: string, shiftKey = false) {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key, ctrlKey: true, metaKey: false, shiftKey });
  events.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  effects.length = 0;
  events = new EventTarget();
  input = new Input();
  committed = 2.5;
  saved = read = reset = 0;
  input.onBlur = () => {
    const value = Number(input.value);
    if (Number.isFinite(value)) committed = value;
  };
  vi.stubGlobal("HTMLInputElement", Input);
  vi.stubGlobal("HTMLElement", Input);
  vi.stubGlobal("document", {
    activeElement: input,
    querySelector: () => null,
  });
  vi.stubGlobal("window", events);
  useEditorShortcuts({
    undo: vi.fn(),
    redo: vi.fn(),
    saveProfile: () => { saved = committed; },
    reset: () => { reset = committed; },
    pullEq: () => { read = committed; },
    pushEq: vi.fn(),
    isBusy: false,
    eqOperationInFlightRef: { current: false },
    recoveryPending: false,
  });
  cleanup = effects.map((effect) => effect()).filter(
    (value): value is () => void => typeof value === "function",
  );
});

afterEach(() => {
  cleanup.forEach((dispose) => dispose());
  vi.unstubAllGlobals();
});

describe("editor shortcuts with a numeric draft", () => {
  it.each([
    ["s", false, () => saved],
    ["r", false, () => read],
    ["r", true, () => reset],
  ])("commits before Ctrl+%s (shift=%s)", (key, shift, result) => {
    const event = shortcut(key, shift);
    expect(event.defaultPrevented).toBe(true);
    expect(result()).toBe(7);
  });

  it.each(["s", "r"])("blocks Ctrl+%s for invalid text", (key) => {
    input.value = "7oops";
    const event = shortcut(key);
    expect(event.defaultPrevented).toBe(true);
    expect(committed).toBe(2.5);
    expect(saved).toBe(0);
    expect(read).toBe(0);
  });

  it("does not blur unrelated text fields or intercept their undo", () => {
    input.role = "";
    const onBlur = vi.fn();
    input.onBlur = onBlur;
    const event = shortcut("z");
    expect(event.defaultPrevented).toBe(false);
    expect(onBlur).not.toHaveBeenCalled();
    shortcut("s");
    expect(onBlur).not.toHaveBeenCalled();
    expect(saved).toBe(2.5);
  });
});
