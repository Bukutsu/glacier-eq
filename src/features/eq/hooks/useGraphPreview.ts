import { useCallback, useEffect, useRef, useState } from "react";

import type { RefObject } from "react";

export function useGraphPreview({
  showGraph,
  floatingGraphPreview,
  mobileScrollRef,
}: {
  showGraph: boolean;
  floatingGraphPreview: boolean;
  mobileScrollRef: RefObject<HTMLElement | null>;
}) {
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [showGraphPreview, setShowGraphPreview] = useState(false);

  const graphPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAdjustingRef = useRef(false);

  const clearPreviewTimer = useCallback(() => {
    if (graphPreviewTimer.current) {
      clearTimeout(graphPreviewTimer.current);
      graphPreviewTimer.current = null;
    }
  }, []);

  const startGraphPreview = useCallback(() => {
    if (!showGraph || floatingGraphPreview === false) return;
    const scrollEl = mobileScrollRef.current;
    if (scrollEl && !graphCollapsed && scrollEl.scrollTop < 180) {
      return;
    }
    clearPreviewTimer();
    isAdjustingRef.current = true;
    setShowGraphPreview(true);
    // Android WebView may omit the range input's end event. An idle fallback
    // keeps the floating preview from becoming a permanent obstruction.
    graphPreviewTimer.current = setTimeout(() => {
      if (!isAdjustingRef.current) return;
      isAdjustingRef.current = false;
      setShowGraphPreview(false);
    }, 1500);
  }, [showGraph, floatingGraphPreview, graphCollapsed, clearPreviewTimer]);

  const schedulePreviewDismiss = useCallback(
    (delay = 1500) => {
      clearPreviewTimer();
      isAdjustingRef.current = false;
      graphPreviewTimer.current = setTimeout(() => {
        if (!isAdjustingRef.current) {
          setShowGraphPreview(false);
        }
      }, delay);
    },
    [clearPreviewTimer],
  );

  // Cleanup on unmount and when the graph is disabled.
  useEffect(() => {
    if (!showGraph) {
      clearPreviewTimer();
      isAdjustingRef.current = false;
      setShowGraphPreview(false);
    }
    return clearPreviewTimer;
  }, [showGraph, clearPreviewTimer]);

  // Range inputs do not consistently deliver pointerup to the input in Android
  // WebView, so finish an active preview gesture at the window boundary too.
  useEffect(() => {
    const finishAdjustment = () => {
      if (isAdjustingRef.current) schedulePreviewDismiss(1500);
    };
    window.addEventListener("pointerup", finishAdjustment, true);
    window.addEventListener("pointercancel", finishAdjustment, true);
    window.addEventListener("touchend", finishAdjustment, true);
    window.addEventListener("touchcancel", finishAdjustment, true);
    return () => {
      window.removeEventListener("pointerup", finishAdjustment, true);
      window.removeEventListener("pointercancel", finishAdjustment, true);
      window.removeEventListener("touchend", finishAdjustment, true);
      window.removeEventListener("touchcancel", finishAdjustment, true);
    };
  }, [schedulePreviewDismiss]);

  // Instantly dismiss preview when tapping on empty space
  useEffect(() => {
    if (!showGraphPreview) return;
    const handleTapToDismiss = (e: PointerEvent) => {
      // Narrow rather than assert: this is a window-level capture-phase
      // pointerdown whose target is unconstrained.
      const target = e.target instanceof Element ? e.target : null;
      if (
        target?.closest?.(
          "input, select, button, .control-slider, .eq-filter-handle, .mobile-graph-preview",
        )
      ) {
        return;
      }
      clearPreviewTimer();
      isAdjustingRef.current = false;
      setShowGraphPreview(false);
    };

    window.addEventListener("pointerdown", handleTapToDismiss, {
      capture: true,
      passive: true,
    });
    return () => {
      window.removeEventListener("pointerdown", handleTapToDismiss, {
        capture: true,
      });
    };
  }, [showGraphPreview, clearPreviewTimer]);

  const handlePreviewClick = useCallback(() => {
    mobileScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    clearPreviewTimer();
    isAdjustingRef.current = false;
    setShowGraphPreview(false);
  }, [clearPreviewTimer]);
  return {
    graphCollapsed,
    setGraphCollapsed,
    showGraphPreview,
    startGraphPreview,
    schedulePreviewDismiss,
    handlePreviewClick,
  };
}

export type GraphPreview = ReturnType<typeof useGraphPreview>;
