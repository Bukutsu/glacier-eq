import { describe, expect, it } from "vitest";
import {
  computeThumbLayout,
  computeScrollFromDrag,
  computeScrollFromTrackClick,
} from "./fastScrollerMath";

describe("fastScrollerMath", () => {
  describe("computeThumbLayout", () => {
    it("returns hidden when content fits in clientHeight", () => {
      const layout = computeThumbLayout(0, 500, 500, 400);
      expect(layout.visible).toBe(false);
      expect(layout.maxScroll).toBe(0);
    });

    it("returns visible and calculates thumb layout proportionally when scrolling", () => {
      // scrollHeight: 1000, clientHeight: 500, trackHeight: 400
      // maxScroll: 500
      // thumbHeight: (500 / 1000) * 400 = 200
      // thumbTravel: 400 - 200 = 200
      const layout = computeThumbLayout(250, 1000, 500, 400);
      expect(layout.visible).toBe(true);
      expect(layout.maxScroll).toBe(500);
      expect(layout.thumbHeight).toBe(200);
      expect(layout.thumbTravel).toBe(200);
      expect(layout.thumbTop).toBe(100); // 250 / 500 * 200 = 100
    });

    it("enforces minimum thumb height", () => {
      // Very long content: scrollHeight 10,000, clientHeight 500, trackHeight 400
      // Proportional would be (500/10000)*400 = 20px, but minThumbHeight is 36px
      const layout = computeThumbLayout(0, 10000, 500, 400, 36);
      expect(layout.thumbHeight).toBe(36);
      expect(layout.thumbTravel).toBe(400 - 36);
    });

    it("clamps thumbTop within bounds when scrollTop is out of range", () => {
      const layoutNegative = computeThumbLayout(-50, 1000, 500, 400);
      expect(layoutNegative.thumbTop).toBe(0);

      const layoutOvershoot = computeThumbLayout(9999, 1000, 500, 400);
      expect(layoutOvershoot.thumbTop).toBe(layoutOvershoot.thumbTravel);
    });
  });

  describe("computeScrollFromDrag", () => {
    it("moves scrollTop 1:1 proportionally with finger drag", () => {
      // startY: 100, currentY: 150 (moved down 50px)
      // startScrollTop: 100, thumbTravel: 200, maxScroll: 500
      // scrollDelta: (50 / 200) * 500 = 125
      // expected: 100 + 125 = 225
      const scroll = computeScrollFromDrag(100, 150, 100, 200, 500);
      expect(scroll).toBe(225);
    });

    it("clamps scroll within 0 and maxScroll", () => {
      const scrollMin = computeScrollFromDrag(100, 0, 50, 200, 500);
      expect(scrollMin).toBe(0);

      const scrollMax = computeScrollFromDrag(100, 500, 400, 200, 500);
      expect(scrollMax).toBe(500);
    });
  });

  describe("computeScrollFromTrackClick", () => {
    it("scrolls so the thumb centers on the click position", () => {
      // clickY: 200 (middle of 400px track)
      // thumbHeight: 100, trackHeight: 400, maxScroll: 600
      // travel: 300
      // ratio: (200 - 50) / 300 = 150 / 300 = 0.5
      // expected: 0.5 * 600 = 300
      const scroll = computeScrollFromTrackClick(200, 100, 400, 600);
      expect(scroll).toBe(300);
    });
  });
});
