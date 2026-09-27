import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideModalPopState,
  discardBalanceNavigation,
  expectBalanceNavigation,
  isBalanceNavigation,
  MODAL_HISTORY_KEY,
  modalIdFromState,
  modalStateWithId,
  pushModalEntry,
  removeModalEntry,
  resetModalHistoryForTests,
  topModalEntry,
  type ModalHistoryEntry,
} from "./modalHistory";

function popState(state: unknown): PopStateEvent {
  return { state } as unknown as PopStateEvent;
}

function entry(id: string, canClose = true): ModalHistoryEntry {
  return { id, onClose: vi.fn(), canClose: () => canClose };
}

/** The app-level listener's rule: ignore balance navigations and any state
 *  that still names an open modal; otherwise tear every overlay down. */
function appLevelDecision(event: PopStateEvent): "ignore" | "teardown" {
  if (isBalanceNavigation(event)) return "ignore";
  const state = event.state;
  if (typeof state === "object" && state !== null && MODAL_HISTORY_KEY in state) return "ignore";
  return "teardown";
}

beforeEach(() => {
  resetModalHistoryForTests();
});

describe("modalStateWithId", () => {
  it("preserves the router's own state keys", () => {
    expect(modalStateWithId("modal-1", { usr: { key: "default" }, idx: 3 })).toEqual({
      usr: { key: "default" },
      idx: 3,
      [MODAL_HISTORY_KEY]: "modal-1",
    });
  });

  it("tolerates a missing or non-object history state", () => {
    expect(modalStateWithId("modal-1", null)).toEqual({ [MODAL_HISTORY_KEY]: "modal-1" });
    expect(modalIdFromState(null)).toBeUndefined();
    expect(modalIdFromState({ [MODAL_HISTORY_KEY]: 7 })).toBeUndefined();
  });
});

describe("isBalanceNavigation", () => {
  it("claims the event for every handler that sees it", () => {
    expectBalanceNavigation();
    const event = popState({});
    expect(isBalanceNavigation(event)).toBe(true);
    // The second listener on the same event must reach the same conclusion
    // instead of consuming a second pending balance.
    expect(isBalanceNavigation(event)).toBe(true);
    expect(isBalanceNavigation(popState({}))).toBe(false);
  });

  it("does not let an unclaimed balance swallow a later real Back", () => {
    expectBalanceNavigation();
    discardBalanceNavigation();
    expect(isBalanceNavigation(popState({}))).toBe(false);
  });
});

describe("decideModalPopState", () => {
  it("ignores a Back that lands on the top modal's own sentinel", () => {
    const top = entry("modal-1");
    expect(decideModalPopState(popState(modalStateWithId("modal-1", null)), top)).toBe("ignore");
  });

  it("dismisses the top modal when Back lands on the one beneath it", () => {
    // Nested stack: Back past modal-2 lands on modal-1's sentinel. Only the
    // top dialog may close; modal-1 stays open underneath.
    const top = entry("modal-2");
    expect(decideModalPopState(popState(modalStateWithId("modal-1", null)), top)).toBe("dismiss");
  });

  it("reinserts the sentinel while the operation cannot be closed", () => {
    expect(decideModalPopState(popState({}), entry("modal-1", false))).toBe("reinsert");
  });

  it("dismisses a user Back that left the stack", () => {
    expect(decideModalPopState(popState({}), entry("modal-1"))).toBe("dismiss");
    expect(decideModalPopState(popState({}), undefined)).toBe("ignore");
  });
});

describe("closing one modal must not close the next", () => {
  /** Close a modal with its button, then open another before the balance
   *  navigation resolves. Returns the event that navigation produced. */
  function closeThenReopen(trackBalance: boolean) {
    const first = entry("modal-1");
    const second = entry("modal-2");
    pushModalEntry(first);
    removeModalEntry(first);
    if (trackBalance) expectBalanceNavigation();
    pushModalEntry(second);
    return { event: popState({}), second };
  }

  it("would dismiss the reopened dialog if the balance were not recognised", () => {
    const { event, second } = closeThenReopen(false);
    // Both listeners act on the base state the balance navigation lands on:
    // the app-level handler tears every overlay down, and the modal handler
    // reads a foreign state and dismisses the top entry.
    expect(appLevelDecision(event)).toBe("teardown");
    expect(decideModalPopState(event, topModalEntry())).toBe("dismiss");
    expect(topModalEntry()).toBe(second);
  });

  it("leaves the reopened dialog alone once the balance is recognised", () => {
    const { event, second } = closeThenReopen(true);
    // The app-level listener is registered first and claims the event.
    expect(appLevelDecision(event)).toBe("ignore");
    // The modal handler then sees the same event and must not dismiss either.
    expect(isBalanceNavigation(event)).toBe(true);
    expect(topModalEntry()).toBe(second);
  });

  it("still tears overlays down for a genuine Back with no modal open", () => {
    expect(appLevelDecision(popState({}))).toBe("teardown");
  });

  it("still dismisses a genuine Back on the top modal", () => {
    const top = entry("modal-1");
    pushModalEntry(top);
    const back = popState({});
    expect(isBalanceNavigation(back)).toBe(false);
    expect(decideModalPopState(back, topModalEntry())).toBe("dismiss");
    expect(appLevelDecision(back)).toBe("teardown");
  });

  it("counts nested modal teardowns independently", () => {
    const first = entry("modal-1");
    const second = entry("modal-2");
    const third = entry("modal-3");
    pushModalEntry(first);
    pushModalEntry(second);

    removeModalEntry(second);
    removeModalEntry(first);
    expectBalanceNavigation();
    expectBalanceNavigation();
    pushModalEntry(third);

    for (let index = 0; index < 2; index += 1) {
      const stale = popState({});
      expect(appLevelDecision(stale)).toBe("ignore");
    }
    // A third navigation was never requested, so this one is a real Back.
    const real = popState({});
    expect(isBalanceNavigation(real)).toBe(false);
    expect(appLevelDecision(real)).toBe("teardown");
    expect(decideModalPopState(real, topModalEntry())).toBe("dismiss");
  });
});
