import { useEffect, useRef, useState, type PointerEvent, type TouchEvent, type RefObject } from "react";
import {
  computeThumbLayout,
  computeScrollFromDrag,
  computeScrollFromTrackClick,
  type FastScrollerLayout,
} from "../lib/fastScrollerMath";

interface FastScrollerProps {
  targetRef: RefObject<HTMLElement | null>;
}

export function FastScroller({ targetRef }: FastScrollerProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<FastScrollerLayout>({
    visible: false,
    maxScroll: 0,
    thumbHeight: 0,
    thumbTop: 0,
    thumbTravel: 0,
  });
  const [bounds, setBounds] = useState<{ top: number; height: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const fadeTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{
    startY: number;
    startScrollTop: number;
    thumbTravel: number;
    maxScroll: number;
  } | null>(null);

  const scheduleFade = () => {
    if (fadeTimerRef.current) window.clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = window.setTimeout(() => {
      setIsScrolling(false);
    }, 1500);
  };

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const sync = () => {
      const rect = target.getBoundingClientRect();
      const tabBar = document.querySelector(".mobile-tab-bar");
      const tabTop = tabBar ? tabBar.getBoundingClientRect().top : window.innerHeight;
      const visibleBottom = Math.min(rect.bottom, tabTop);
      const visibleHeight = Math.max(0, visibleBottom - rect.top);

      setBounds({ top: rect.top, height: visibleHeight });

      const nextLayout = computeThumbLayout(
        target.scrollTop,
        target.scrollHeight,
        target.clientHeight,
        visibleHeight,
      );
      setLayout(nextLayout);
    };

    const handleScroll = () => {
      sync();
      setIsScrolling(true);
      scheduleFade();
    };

    const resizeObserver = new ResizeObserver(sync);
    const mutationObserver = new MutationObserver(sync);

    target.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    resizeObserver.observe(target);
    mutationObserver.observe(target, { childList: true, subtree: true });

    sync();

    return () => {
      target.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (fadeTimerRef.current) window.clearTimeout(fadeTimerRef.current);
    };
  }, [targetRef]);

  if (!layout.visible || !bounds || bounds.height <= 0) {
    return null;
  }

  const startDragAt = (clientY: number) => {
    const track = trackRef.current;
    const target = targetRef.current;
    if (!track || !target) return;

    setIsDragging(true);
    setIsScrolling(true);
    if (fadeTimerRef.current) window.clearTimeout(fadeTimerRef.current);

    const trackRect = track.getBoundingClientRect();
    const clickY = clientY - trackRect.top;

    const initialScroll = computeScrollFromTrackClick(
      clickY,
      layout.thumbHeight,
      trackRect.height,
      layout.maxScroll,
    );
    target.scrollTop = initialScroll;

    dragRef.current = {
      startY: clientY,
      startScrollTop: initialScroll,
      thumbTravel: layout.thumbTravel,
      maxScroll: layout.maxScroll,
    };
  };

  const updateDragAt = (clientY: number) => {
    const drag = dragRef.current;
    const target = targetRef.current;
    if (!drag || !target) return;

    const nextScroll = computeScrollFromDrag(
      drag.startY,
      clientY,
      drag.startScrollTop,
      drag.thumbTravel,
      drag.maxScroll,
    );
    target.scrollTop = nextScroll;
  };

  const stopDrag = () => {
    setIsDragging(false);
    dragRef.current = null;
    scheduleFade();
  };

  // Pointer events (mouse, stylus, and desktop touch emulation)
  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    trackRef.current?.setPointerCapture(e.pointerId);
    startDragAt(e.clientY);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    updateDragAt(e.clientY);
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    stopDrag();
  };

  // Native mobile touch events (100% hardware-backed on Android WebView)
  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    startDragAt(touch.clientY);
  };

  const handleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    updateDragAt(touch.clientY);
  };

  const handleTouchEnd = () => {
    stopDrag();
  };

  return (
    <div
      ref={trackRef}
      className={`fast-scroller-track ${layout.visible ? "visible" : ""}`}
      style={{
        top: `${bounds.top}px`,
        height: `${bounds.height}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      role="scrollbar"
      aria-label="Fast scroll"
      aria-orientation="vertical"
      aria-valuenow={Math.round(targetRef.current?.scrollTop ?? 0)}
      aria-valuemin={0}
      aria-valuemax={layout.maxScroll}
    >
      <div
        className={`fast-scroller-thumb ${isDragging ? "dragging" : ""} ${isScrolling || isDragging ? "active" : ""}`}
        style={{
          height: `${layout.thumbHeight}px`,
          transform: `translateY(${layout.thumbTop}px)`,
        }}
      >
        <div className="fast-scroller-thumb-bar" />
      </div>
    </div>
  );
}
