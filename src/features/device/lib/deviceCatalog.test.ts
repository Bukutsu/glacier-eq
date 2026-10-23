import { describe, expect, it } from "vitest";
import { DEV_DUMMY_DEVICE } from "./devDevice";
import type { SupportedDeviceInfo } from "@/types";
import {
  filterDeviceModels,
  groupDeviceProfiles,
  usbId,
} from "./deviceCatalog";

const melody: SupportedDeviceInfo = {
  ...DEV_DUMMY_DEVICE,
  name: "SNOWSKY Melody",
  protocol: "FiiO Melody",
  family: "FiiO",
  status: "Untested",
  vendor_id: 0x2972,
  product_id: 0x0126,
  spec: { name: "Melody", chip: "CS43131", outputs: "3.5 / 4.4mm" },
};
const named: SupportedDeviceInfo = {
  ...melody,
  name: "FIIO LS-TC2",
  protocol: "FIIO LS-TC2",
  product_id: null,
  usb_product_names: ["FIIO DSP Audio"],
};
const tested: SupportedDeviceInfo = {
  ...melody,
  name: "FiiO JA11",
  protocol: "FiiO JA11",
  status: "Tested",
  product_id: 0x0102,
};
const models = groupDeviceProfiles([
  melody,
  {
    ...melody,
    vendor_id: 0x0a12,
    product_id: null,
    usb_product_names: ["SNOWSKY Melody"],
  },
  named,
  tested,
]);

describe("build-backed device catalog", () => {
  it("groups USB variants without losing identities or source status", () => {
    expect(models).toHaveLength(3);
    const model = models.find((m) => m.profile.name === "SNOWSKY Melody")!;
    expect(model.variants).toHaveLength(2);
    expect(model.profile.status).toBe("Untested");
    expect(model.variants.map((v) => v.vendor_id)).toEqual([0x2972, 0x0a12]);
    expect(
      groupDeviceProfiles([
        melody,
        { ...melody, protocol: "Different protocol" },
      ]),
    ).toHaveLength(2);
  });
  it("searches model, family, chip, alias, and every USB variant", () => {
    for (const query of [
      "snowsky melody",
      "FiiO 0126",
      "2972:0126",
      "0x2972:0x0126",
      "0a12",
      "CS43131",
    ]) {
      expect(
        filterDeviceModels(models, query, "").some(
          (m) => m.profile.name === "SNOWSKY Melody",
        ),
      ).toBe(true);
    }
    expect(
      filterDeviceModels(models, "dsp audio", "").map((m) => m.profile.name),
    ).toEqual(["FIIO LS-TC2"]);
    expect(filterDeviceModels(models, "not a device", "")).toEqual([]);
  });
  it("combines status and search without changing registration status", () => {
    expect(
      filterDeviceModels(models, "", "Tested").map((m) => m.profile.name),
    ).toEqual(["FiiO JA11"]);
    expect(filterDeviceModels(models, "melody", "Tested")).toEqual([]);
    expect(filterDeviceModels(models, "melody", "Untested")).toHaveLength(1);
    expect(filterDeviceModels(models, "  ", "")).toHaveLength(3);
    expect(usbId(0xa12)).toBe("0A12");
  });
});
