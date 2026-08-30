import { useEffect, useRef, useState, type RefObject } from "react";

interface ScrollMetrics {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

interface ScrollRect {
  top: number;
  right: number;
  height: number;
}

export function CustomScrollbar({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  const [metrics, setMetrics] = useState<ScrollMetrics>({
    scrollHeight: 0,
    clientHeight: 0,
    scrollTop: 0,
  });
  const [rect, setRect] = useState<ScrollRect | null>(null);
  const dragRef = useRef<{ startY: number; startScroll: number } | null>(null);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const sync = () => {
      if (!window.matchMedia("(min-width: 1280px)").matches) {
        setRect(null);
        return;
      }
      const bounds = target.getBoundingClientRect();
      setRect({ top: bounds.top, right: bounds.right, height: bounds.height });
      setMetrics({
        scrollHeight: target.scrollHeight,
        clientHeight: target.clientHeight,
        scrollTop: target.scrollTop,
      });
    };
    const onWheel = (event: WheelEvent) => {
      if (!window.matchMedia("(min-width: 1280px)").matches) return;
      if (event.defaultPrevented) return;
      if (target.scrollHeight <= target.clientHeight) return;
      event.preventDefault();
      target.scrollTop += event.deltaY;
    };
    const resizeObserver = new ResizeObserver(sync);
    const mutationObserver = new MutationObserver(sync);

    target.addEventListener("scroll", sync, { passive: true });
    target.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", sync);
    resizeObserver.observe(target);
    mutationObserver.observe(target, { childList: true, subtree: true });
    sync();

    return () => {
      target.removeEventListener("scroll", sync);
      target.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", sync);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [targetRef]);

  const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  if (maxScroll <= 0 || !rect) return null;

  const thumbHeight = Math.min(
    metrics.clientHeight,
    Math.max(28, (metrics.clientHeight ** 2) / metrics.scrollHeight),
  );
  const thumbTravel = Math.max(1, metrics.clientHeight - thumbHeight);
  const thumbTop = (metrics.scrollTop / maxScroll) * thumbTravel;

  const scrollToTrackPosition = (clientY: number, element: HTMLElement) => {
    const target = targetRef.current;
    if (!target) return;
    const rect = element.getBoundingClientRect();
    target.scrollTop = ((clientY - rect.top) / rect.height) * maxScroll;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = targetRef.current;
    if (!target) return;
    const amount = target.clientHeight * 0.9;
    const next = {
      ArrowDown: target.scrollTop + 48,
      ArrowUp: target.scrollTop - 48,
      PageDown: target.scrollTop + amount,
      PageUp: target.scrollTop - amount,
      Home: 0,
      End: maxScroll,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    target.scrollTop = next;
  };

  return (
    <div
      className="custom-scrollbar"
      style={{ top: rect.top, left: rect.right - 12, height: rect.height }}
      role="scrollbar"
      aria-label="Content scrollbar"
      aria-controls="main-scroll-pane"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={maxScroll}
      aria-valuenow={Math.round(metrics.scrollTop)}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          scrollToTrackPosition(event.clientY, event.currentTarget);
        }
      }}
    >
      <div
        className="custom-scrollbar-thumb"
        style={{ height: thumbHeight, transform: `translateY(${thumbTop}px)` }}
        onPointerDown={(event) => {
          event.stopPropagation();
          dragRef.current = { startY: event.clientY, startScroll: targetRef.current?.scrollTop ?? 0 };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          const target = targetRef.current;
          if (!drag || !target) return;
          target.scrollTop = drag.startScroll + ((event.clientY - drag.startY) / thumbTravel) * maxScroll;
        }}
        onPointerUp={(event) => {
          dragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          dragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
      />
    </div>
  );
}
