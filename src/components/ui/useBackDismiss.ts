import { useEffect, useId, useRef } from "react";
import {
  afterBalanceNavigations,
  decideModalPopState,
  expectBalanceNavigation,
  isBalanceNavigation,
  modalIdFromState,
  modalStateWithId,
  pushModalEntry,
  removeModalEntry,
  topModalEntry,
  type ModalHistoryEntry,
} from "@/lib/modalHistory";

let popstateListenerCount = 0;

function handlePopState(event: PopStateEvent) {
  // Our own teardown of a previous overlay navigates here too. Acting on it
  // would dismiss whichever overlay the user opened in the meantime.
  if (isBalanceNavigation(event)) return;
  const top = topModalEntry();
  if (top === undefined) return;
  const action = decideModalPopState(event, top);
  switch (action) {
    case "reinsert":
      window.history.pushState(
        modalStateWithId(top.id, window.history.state),
        "",
      );
      return;
    case "dismiss":
      removeModalEntry(top);
      top.onClose();
      return;
    case "ignore":
      return;
    default: {
      // A new popstate action must be handled here, not silently fall through
      // and leave the Back press doing nothing.
      const exhaustive: never = action;
      throw new Error(`unhandled modal popstate action: ${exhaustive}`);
    }
  }
}

/**
 * While `active`, a system Back closes this overlay instead of leaving the
 * page. Overlays share one history stack, so Back closes only the top one.
 */
export function useBackDismiss(
  active: boolean,
  onClose: () => void,
  closeDisabled = false,
): void {
  const id = `overlay-${useId()}`;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeDisabledRef = useRef(closeDisabled);
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    if (!active) return;
    const entry: ModalHistoryEntry = {
      id,
      onClose: () => onCloseRef.current(),
      canClose: () => !closeDisabledRef.current,
    };

    pushModalEntry(entry);
    const cancelSentinel = afterBalanceNavigations(() =>
      window.history.pushState(modalStateWithId(id, window.history.state), ""),
    );
    if (popstateListenerCount === 0) {
      window.addEventListener("popstate", handlePopState);
    }
    popstateListenerCount += 1;

    return () => {
      cancelSentinel();
      removeModalEntry(entry);
      popstateListenerCount = Math.max(0, popstateListenerCount - 1);
      if (popstateListenerCount === 0) {
        window.removeEventListener("popstate", handlePopState);
      }
      // Closing without Back must balance the sentinel this overlay pushed.
      // If Back already removed it, the current state no longer belongs to
      // this entry and no second history navigation occurs.
      if (modalIdFromState(window.history.state) === id) {
        // Mark the navigation before it is requested: it resolves after this
        // task, possibly once another overlay has pushed its own sentinel.
        expectBalanceNavigation();
        window.history.back();
      }
    };
  }, [active, id]);
}
