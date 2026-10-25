import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceNavigation } from "./useWorkspaceNavigation";
import {
  expectBalanceNavigation,
  MODAL_HISTORY_KEY,
  resetModalHistoryForTests,
} from "@/lib/modalHistory";

const h = vi.hoisted(() => ({
  path: "/eq",
  refs: [] as { current: unknown }[],
  index: 0,
  effects: [] as (() => void | (() => void))[],
  event: () => {},
  navigate: vi.fn(),
}));
vi.mock("react-router", () => ({
  useLocation: () => ({ pathname: h.path }),
  useNavigate: () => h.navigate,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (current: unknown) => (h.refs[h.index++] ??= { current }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => h.effects.push(effect),
  useEffectEvent: (callback: () => void) => {
    h.event = callback;
    return () => h.event();
  },
}));

let events: EventTarget;
let cleanups: (() => void)[];
let frames: FrameRequestCallback[];
let reducedMotion: boolean;
function render(mobile = true, onBack = vi.fn()) {
  h.index = 0;
  h.effects = [];
  return useWorkspaceNavigation(mobile, onBack);
}
function commit() {
  for (const effect of h.effects) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
  for (const frame of frames.splice(0)) frame(0);
}
function pop(state: unknown = null) {
  const event = new Event("popstate");
  Object.assign(event, { state });
  events.dispatchEvent(event);
}

beforeEach(() => {
  h.refs = [];
  h.path = "/eq";
  h.navigate.mockReset().mockImplementation((path: string) => {
    h.path = path;
  });
  cleanups = [];
  frames = [];
  reducedMotion = false;
  events = new EventTarget();
  resetModalHistoryForTests();
  vi.stubGlobal("window", {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      frames.push(callback),
    cancelAnimationFrame: vi.fn(),
    matchMedia: () => ({ matches: reducedMotion }),
  });
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  vi.unstubAllGlobals();
  resetModalHistoryForTests();
});

describe("workspace navigation", () => {
  it("returns to the remembered subsection, not the tab root", () => {
    h.path = "/device/controls";
    let navigation = render(false);
    navigation.selectTab("eq");
    navigation = render(false);
    navigation.selectTab("device");
    expect(h.navigate.mock.calls).toEqual([["/eq"], ["/device/controls"]]);
  });

  it("groups Device under Settings on mobile and remembers that subsection", () => {
    h.path = "/device/controls";
    let navigation = render();
    const scrollTo = vi.fn();
    navigation.scrollRef.current = {
      scrollTop: 80,
      scrollTo,
    } as unknown as HTMLElement;
    navigation.selectTab("settings");
    expect(h.navigate).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    navigation.selectTab("eq");
    navigation = render();
    navigation.selectTab("settings");
    expect(h.navigate).toHaveBeenLastCalledWith("/device/controls");
  });

  it("honors reduced motion when retapping the current tab", () => {
    reducedMotion = true;
    const navigation = render();
    const scrollTo = vi.fn();
    navigation.scrollRef.current = {
      scrollTop: 80,
      scrollTo,
    } as unknown as HTMLElement;
    navigation.selectTab("eq");
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });

  it("restores each tab's own scroll position", () => {
    let navigation = render();
    const scroll = { scrollTop: 260, scrollTo: vi.fn() };
    navigation.scrollRef.current = scroll as unknown as HTMLElement;
    navigation.selectTab("profiles");
    navigation = render();
    commit();
    expect(scroll.scrollTo).toHaveBeenLastCalledWith({
      top: 0,
      behavior: "auto",
    });
    scroll.scrollTop = 120;
    navigation.selectTab("eq");
    navigation = render();
    // Only the scroll effect reruns on a route change.
    h.effects[0]();
    for (const frame of frames.splice(0)) frame(0);
    expect(scroll.scrollTo).toHaveBeenLastCalledWith({
      top: 260,
      behavior: "auto",
    });
  });

  it("ignores nested modal and balancing history events, but handles a real Back", () => {
    const onBack = vi.fn();
    render(true, onBack);
    commit();
    pop({ [MODAL_HISTORY_KEY]: "inner" });
    expectBalanceNavigation();
    pop();
    expect(onBack).not.toHaveBeenCalled();
    pop();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("uses the latest Back callback without reinstalling the listener, and cleans up", () => {
    const oldBack = vi.fn();
    render(true, oldBack);
    commit();
    const nextBack = vi.fn();
    h.path = "/profiles";
    render(true, nextBack);
    pop();
    expect(oldBack).not.toHaveBeenCalled();
    expect(nextBack).toHaveBeenCalledOnce();
    for (const cleanup of cleanups.splice(0)) cleanup();
    pop();
    expect(nextBack).toHaveBeenCalledOnce();
  });
});
