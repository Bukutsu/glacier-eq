import { i18n } from "@/lib/i18n";
import type { PEQData } from "@/types";

/** Editor name for a DAC read that matches no saved profile. */
export const PULLED_PROFILE_NAME = "Pulled from device";

/** The name to show for an editor profile name. */
export function profileTitle(name: string): string {
  return name === PULLED_PROFILE_NAME
    ? i18n.t("library:profiles.pulledFromDac")
    : name;
}

export async function resolvePulledProfile(
  peq: PEQData,
  matchProfile: (peq: PEQData) => Promise<string | null>,
  isCurrent: () => boolean,
): Promise<string | null> {
  const match = await matchProfile(peq);
  return isCurrent() ? (match ?? PULLED_PROFILE_NAME) : null;
}
