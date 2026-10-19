import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { i18n } from "@/lib/i18n";
import type { Namespace } from "i18next";
import { Preamp } from "./Preamp";
import { Slider } from "@/components/ui/Slider";

// These tests call components directly with mocked React hooks. Keep real
// catalog lookup without requiring a React render for useTranslation.
vi.mock("react-i18next", async (original) => ({
  ...(await original<typeof import("react-i18next")>()),
  useTranslation: (namespace: Namespace) => ({
    t: i18n.getFixedT(null, namespace),
    i18n,
    ready: true,
  }),
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (current: unknown) => ({ current }),
}));

describe("preamp cancellation", () => {
  it("restores the editor value, not the native range's step-rounded value", () => {
    const change = vi.fn();
    const start = vi.fn();
    const end = vi.fn();
    const element = Preamp({
      value: 1.234,
      range: [-12, 12],
      integerMode: false,
      onChange: change,
      onStartChange: start,
      onEndChange: end,
    });
    const slider = element.props.children.find(
      (child: ReactElement) => child.type === Slider,
    );
    slider.props.onStartChange();
    slider.props.onChange({ target: { value: "4.5" } });
    slider.props.onCancelChange(1.25);
    slider.props.onEndChange();
    expect(change.mock.calls).toEqual([[4.5], [1.234]]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });
});
