import type { DeviceCapabilities, PEQData } from "../types";
import type { HistoryMetadata } from "../stores/historyStore";
import { normalizePeq, peqEquals } from "./peq";

export function restoreHistorySnapshot(options: {
  restore: (
    current: PEQData,
    normalize: (snapshot: PEQData) => PEQData,
    currentMetadata?: HistoryMetadata | null,
  ) => PEQData | null;
  current: PEQData;
  currentMetadata?: HistoryMetadata | null;
  clean: PEQData;
  capabilities: DeviceCapabilities;
}) {
  const { restore, current, currentMetadata, clean, capabilities } = options;
  const peq = restore(current, (snapshot) => normalizePeq(snapshot, {
    integerPreamp: capabilities.integer_preamp,
    capabilities,
  }), currentMetadata);
  return peq ? { peq, dirty: !peqEquals(peq, clean) } : null;
}
