import { i18n } from "@/lib/i18n";

// The backend currently emits English progress messages, not message IDs.
// Keep this wire-format adapter at the event boundary until that API changes.
const PROGRESS_KEYS = {
  "Preparing EQ read…": "device:pullEq.preparingEqRead",
  "Reading device preamp…": "device:pullEq.readingDevicePreamp",
  "Read complete": "device:pullEq.readComplete",
  "Preparing EQ write…": "device:pushEq.preparingEqWrite",
  "Writing preamp…": "device:pushEq.writingPreamp",
  "Saving EQ to DAC…": "device:pushEq.savingEqToDac",
  "Saving EQ to DAC (restart expected)…": "device:progress.savingRestarting",
  "Write complete": "device:pushEq.writeComplete",
  "Temporary EQ applied": "device:applyProfileToRam.temporaryEqApplied",
} as const;

export function localizeDeviceProgress(message: string): string {
  if (Object.prototype.hasOwnProperty.call(PROGRESS_KEYS, message)) {
    return i18n.t(PROGRESS_KEYS[message as keyof typeof PROGRESS_KEYS]);
  }
  const band = /^(Reading|Writing) band (\d+)\/(\d+)…$/.exec(message);
  if (band) {
    return i18n.t(
      band[1] === "Reading"
        ? "device:progress.readingBand"
        : "device:progress.writingBand",
      { index: Number(band[2]), total: Number(band[3]) },
    );
  }
  return message;
}
