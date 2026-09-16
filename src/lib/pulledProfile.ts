import type { PEQData } from "../types";

export async function resolvePulledProfile(
  peq: PEQData,
  matchProfile: (peq: PEQData) => Promise<string | null>,
  isCurrent: () => boolean,
): Promise<string | null> {
  const match = await matchProfile(peq);
  return isCurrent() ? match ?? "Pulled from device" : null;
}
