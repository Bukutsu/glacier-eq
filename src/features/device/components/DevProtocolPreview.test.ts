import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Combobox } from "@base-ui/react/combobox";
import { DEV_DUMMY_DEVICE } from "@/features/device/lib/devDevice";
import { groupDeviceProfiles } from "@/features/device/lib/deviceCatalog";
import type { SupportedDeviceInfo } from "@/types";
import { DevProtocolPreview, matchesPreviewChoice } from "./DevProtocolPreview";

const capture = vi.hoisted(() => ({
  root: null as unknown as ComponentProps<typeof Combobox.Root>,
}));
vi.mock("@base-ui/react/combobox", async (original) => {
  const actual = await original<typeof import("@base-ui/react/combobox")>();
  return {
    ...actual,
    Combobox: {
      ...actual.Combobox,
      Root: (props: ComponentProps<typeof Combobox.Root>) => {
        capture.root = props;
        return createElement(actual.Combobox.Root, props);
      },
    },
  };
});
const melody: SupportedDeviceInfo = {
  ...DEV_DUMMY_DEVICE,
  name: "SNOWSKY Melody",
  protocol: "SNOWSKY Melody",
  family: "FiiO",
  status: "Untested",
  vendor_id: 0x2972,
  product_id: 0x0126,
  spec: { name: "Melody", chip: "CS43131", outputs: "3.5 / 4.4mm" },
};
const model = groupDeviceProfiles([
  melody,
  {
    ...melody,
    vendor_id: 0x0a12,
    product_id: null,
    usb_product_names: ["Melody USB Audio"],
  },
])[0];
const choice = {
  value: "preview-melody",
  label: melody.name,
  device: {
    ...DEV_DUMMY_DEVICE,
    path: "preview-melody",
    profile_name: melody.name,
  },
  model,
};
function render(disabled = false, device = DEV_DUMMY_DEVICE) {
  const onChange = vi.fn();
  const html = renderToStaticMarkup(
    createElement(DevProtocolPreview, { device, disabled, onChange }),
  );
  return { html, onChange };
}
function change(value: unknown) {
  capture.root.onValueChange?.(
    value,
    {} as Parameters<NonNullable<typeof capture.root.onValueChange>>[1],
  );
}
beforeEach(() => vi.clearAllMocks());
describe("protocol preview picker", () => {
  it("keeps the current model label while the catalog loads instead of showing the default DAC", () => {
    const { html } = render(false, choice.device);
    expect(html).toContain("SNOWSKY Melody");
    expect(html).not.toContain("SNOWSKY Melody — SNOWSKY Melody");
    expect(html).not.toContain("vendor fallback");
    expect(capture.root.value).toMatchObject({
      value: choice.value,
      label: "SNOWSKY Melody",
    });
  });
  it("only commits a different explicit selection", () => {
    const { onChange } = render();
    change(null);
    change({ ...choice, value: DEV_DUMMY_DEVICE.path });
    expect(onChange).not.toHaveBeenCalled();
    change(choice);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(choice.device);
  });
  it("does not change selection while disabled", () => {
    const { onChange } = render(true);
    change(choice);
    expect(onChange).not.toHaveBeenCalled();
    expect(capture.root.disabled).toBe(true);
  });
  it("searches words, protocol, chip, and every grouped USB alias without repeating them in the label", () => {
    for (const query of [
      "",
      "  MELODY snowsky ",
      "FiiO",
      "CS43131",
      "2972:0126",
      "0a12",
      "USB Audio",
    ]) {
      expect(matchesPreviewChoice(choice, query)).toBe(true);
    }
    expect(matchesPreviewChoice(choice, "nonexistent")).toBe(false);
    expect(choice.label).toBe("SNOWSKY Melody");
    const dummy = {
      value: DEV_DUMMY_DEVICE.path,
      label: "Walkplay — Default dummy DAC",
      device: DEV_DUMMY_DEVICE,
      model: null,
    };
    expect(matchesPreviewChoice(dummy, "dummy WALKPLAY")).toBe(true);
    expect(matchesPreviewChoice(dummy, "melody")).toBe(false);
  });
});
