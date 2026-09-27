// Modal instances share one history stack. A system Back event removes only
// the top entry; returning to an underlying modal's sentinel must not dismiss
// that underlying dialog as well.
//
// Closing a modal has to balance the sentinel it pushed, and `history.back()`
// is asynchronous: that navigation can land after the next modal has already
// pushed its own sentinel. Both this module's popstate handler and the
// app-level overlay teardown listen for `popstate`, so a balance navigation has
// to be recognisable as bookkeeping rather than a user Back. Counting them —
// and remembering the event they landed on, since every handler receives the
// same object — keeps a stale teardown from closing a dialog the user never
// dismissed.

export const MODAL_HISTORY_KEY = "__glacierModal";

export interface ModalHistoryEntry {
  id: string;
  onClose: () => void;
  canClose: () => boolean;
}

const modalHistoryStack: ModalHistoryEntry[] = [];
const balanceEvents = new WeakSet<object>();
let pendingBalanceNavigations = 0;

export function modalStateWithId(id: string, current: unknown): Record<string, unknown> {
  return typeof current === "object" && current !== null
    ? { ...(current as Record<string, unknown>), [MODAL_HISTORY_KEY]: id }
    : { [MODAL_HISTORY_KEY]: id };
}

export function modalIdFromState(state: unknown): string | undefined {
  if (typeof state !== "object" || state === null) return undefined;
  const id = (state as Record<string, unknown>)[MODAL_HISTORY_KEY];
  return typeof id === "string" ? id : undefined;
}

export function pushModalEntry(entry: ModalHistoryEntry): void {
  modalHistoryStack.push(entry);
}

/** Remove the entry wherever it sits, so an unmount under nested modals cannot
 *  leave a live dialog on the stack. */
export function removeModalEntry(entry: ModalHistoryEntry): void {
  const index = modalHistoryStack.lastIndexOf(entry);
  if (index >= 0) modalHistoryStack.splice(index, 1);
}

export function topModalEntry(): ModalHistoryEntry | undefined {
  return modalHistoryStack[modalHistoryStack.length - 1];
}

export function modalStackDepth(): number {
  return modalHistoryStack.length;
}

/** Record that a `history.back()` is in flight to undo a pushed sentinel. */
export function expectBalanceNavigation(): void {
  pendingBalanceNavigations += 1;
}

/**
 * True when this popstate is a balance navigation this module requested rather
 * than a user Back. The first handler to ask claims the event, so every other
 * handler on it reaches the same conclusion.
 */
export function isBalanceNavigation(event: object): boolean {
  if (balanceEvents.has(event)) return true;
  if (pendingBalanceNavigations === 0) return false;
  pendingBalanceNavigations -= 1;
  balanceEvents.add(event);
  return true;
}

/** A balance navigation that found no modal open can never be claimed by a
 *  later dialog, so it must not be allowed to swallow a real Back later. */
export function discardBalanceNavigation(): void {
  pendingBalanceNavigations = 0;
}

export type ModalPopStateAction = "ignore" | "reinsert" | "dismiss";

export function decideModalPopState(
  event: object,
  top: ModalHistoryEntry | undefined,
): ModalPopStateAction {
  if (top === undefined) return "ignore";
  // The browser is already sitting on this dialog's own sentinel, so the
  // navigation that produced it was not a Back aimed past the stack.
  if (modalIdFromState((event as { state?: unknown }).state) === top.id) return "ignore";
  // The browser has already moved off the sentinel. Reinsert it so Back
  // cannot bypass a close-disabled operation such as an in-flight save.
  if (!top.canClose()) return "reinsert";
  // Back past the top dialog lands on whatever is beneath it, so only the top
  // entry closes; anything nested below stays open.
  return "dismiss";
}

/** Test-only: reset the shared stack and balance bookkeeping. */
export function resetModalHistoryForTests(): void {
  modalHistoryStack.length = 0;
  pendingBalanceNavigations = 0;
}
