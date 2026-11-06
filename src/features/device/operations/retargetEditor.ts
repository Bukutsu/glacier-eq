import { i18n } from "@/lib/i18n";
import type { EqEditor } from "@/features/eq/hooks/useEqEditor";
import type { ReportStatus } from "@/features/diagnostics/types";
import {
  normalizePeq,
  normalizePeqForDevice,
  peqEquals,
} from "@/features/eq/lib/peq";
import type { DeviceCapabilities } from "@/types";

// Normalizes the editor to a newly connected DAC. The clean baseline retargets
// with it: normalizePeq pads to the DAC's band count but never truncates, and
// peqEquals calls a length mismatch unequal, so a baseline left in the previous
// DAC's shape would pin the unsaved-changes flag on for the rest of the session.
export function retargetEditorToDevice(
  editor: Pick<
    EqEditor,
    | "peqRef"
    | "editorCleanPeqRef"
    | "pushToUndoStack"
    | "setPeq"
    | "noteEditorMutation"
    | "setDirty"
  >,
  reportStatus: ReportStatus,
  capabilities: DeviceCapabilities,
) {
  const { peqRef, editorCleanPeqRef } = editor;
  const constrained = normalizePeq(peqRef.current, { capabilities });
  if (peqEquals(constrained, peqRef.current)) return;
  editor.pushToUndoStack(peqRef.current);
  editor.setPeq(constrained);
  editor.noteEditorMutation();
  editorCleanPeqRef.current = normalizePeqForDevice(
    editorCleanPeqRef.current,
    capabilities,
  );
  editor.setDirty(!peqEquals(constrained, editorCleanPeqRef.current));
  reportStatus({
    level: "Info",
    message: i18n.t("device:useDevicePolling.editorAdjustedToDacLimits"),
    toastType: "info",
    source: "Device",
  });
}
