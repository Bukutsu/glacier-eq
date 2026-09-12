/**
 * Pure math helpers for fast-scroller layout and drag calculations.
 */

export interface FastScrollerLayout {
  visible: boolean;
  maxScroll: number;
  thumbHeight: number;
  thumbTop: number;
  thumbTravel: number;
}

export function computeThumbLayout(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  trackHeight: number,
  minThumbHeight = 36,
): FastScrollerLayout {
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  if (maxScroll <= 0 || trackHeight <= 0 || clientHeight <= 0) {
    return {
      visible: false,
      maxScroll: 0,
      thumbHeight: 0,
      thumbTop: 0,
      thumbTravel: 0,
    };
  }

  const thumbHeight = Math.min(
    trackHeight * 0.8,
    Math.max(minThumbHeight, (clientHeight / scrollHeight) * trackHeight),
  );
  const thumbTravel = Math.max(1, trackHeight - thumbHeight);
  const clampedScrollTop = Math.max(0, Math.min(maxScroll, scrollTop));
  const thumbTop = (clampedScrollTop / maxScroll) * thumbTravel;

  return {
    visible: true,
    maxScroll,
    thumbHeight,
    thumbTop,
    thumbTravel,
  };
}

export function computeScrollFromDrag(
  startY: number,
  currentY: number,
  startScrollTop: number,
  thumbTravel: number,
  maxScroll: number,
): number {
  if (thumbTravel <= 0 || maxScroll <= 0) return 0;
  const deltaY = currentY - startY;
  const scrollDelta = (deltaY / thumbTravel) * maxScroll;
  return Math.max(0, Math.min(maxScroll, startScrollTop + scrollDelta));
}

export function computeScrollFromTrackClick(
  clickY: number,
  thumbHeight: number,
  trackHeight: number,
  maxScroll: number,
): number {
  const travel = trackHeight - thumbHeight;
  if (travel <= 0 || maxScroll <= 0) return 0;
  const ratio = (clickY - thumbHeight / 2) / travel;
  return Math.max(0, Math.min(maxScroll, ratio * maxScroll));
}
