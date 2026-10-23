import type { SupportedDeviceInfo } from "@/types";

export interface CatalogModel {
  profile: SupportedDeviceInfo;
  variants: SupportedDeviceInfo[];
}

export function groupDeviceProfiles(
  profiles: SupportedDeviceInfo[],
): CatalogModel[] {
  const models = new Map<string, CatalogModel>();
  for (const profile of profiles) {
    const key = JSON.stringify([profile.name, profile.protocol]);
    const model = models.get(key);
    if (model) model.variants.push(profile);
    else models.set(key, { profile, variants: [profile] });
  }
  return [...models.values()].sort((a, b) =>
    a.profile.name.localeCompare(b.profile.name),
  );
}

export function usbId(value: number): string {
  return value.toString(16).padStart(4, "0").toUpperCase();
}

export function filterDeviceModels(
  models: CatalogModel[],
  query: string,
  status: string,
): CatalogModel[] {
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/\b0x/g, ""))
    .filter(Boolean);
  return models.filter(({ profile, variants }) => {
    if (status && profile.status !== status) return false;
    const searchable = [
      profile.name,
      profile.family,
      profile.protocol,
      profile.status,
      profile.spec?.chip,
      ...variants.flatMap((variant) => [
        usbId(variant.vendor_id),
        variant.product_id == null ? "" : usbId(variant.product_id),
        ...(variant.usb_product_names ?? []),
        `${usbId(variant.vendor_id)}:${variant.product_id == null ? "*" : usbId(variant.product_id)}`,
      ]),
    ]
      .join(" ")
      .toLowerCase();
    return words.every((word) => searchable.includes(word));
  });
}
