import type { DeviceCapabilities, PEQData } from "../types";
import { normalizePeq, peqEquals } from "./peq";

export function restoreHistorySnapshot(options: {
  restore: (current: PEQData, normalize: (snapshot: PEQData) => PEQData) => PEQData | null;
  current: PEQData;
  clean: PEQData;
  capabilities: DeviceCapabilities;
}) {
  const { restore, current, clean, capabilities } = options;
  const peq = restore(current, (snapshot) => normalizePeq(snapshot, {
    integerPreamp: capabilities.integer_preamp,
    capabilities,
  }));
  return peq ? { peq, dirty: !peqEquals(peq, clean) } : null;
}
