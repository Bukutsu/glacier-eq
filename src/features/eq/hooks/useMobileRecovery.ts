import { useEffect, useRef, useState } from "react";
import type { EqEditor } from "./useEqEditor";

// Keep this above responsive layouts so resizing cannot repeat auto-recovery.
export function useMobileRecovery(
  editor: EqEditor,
  connected: boolean,
  enabled: boolean,
) {
  const [restored, setRestored] = useState(false);
  const [autoRestoreDone, setAutoRestoreDone] = useState(false);
  const tried = useRef(false);
  const { pendingDraft, draftInvalid, dirty, restoreDraft } = editor;
  useEffect(() => {
    if (!enabled || tried.current || !pendingDraft || draftInvalid) return;
    tried.current = true;
    void restoreDraft().then((didRestore) => {
      setRestored(didRestore);
      setAutoRestoreDone(true);
    });
  }, [enabled, pendingDraft, draftInvalid, restoreDraft]);
  useEffect(() => {
    if (restored && (!dirty || connected)) setRestored(false);
  }, [restored, dirty, connected]);

  return {
    restored,
    autoRestoreDone,
    keep: () => setRestored(false),
    discard: () => {
      editor.discardRestoredDraft();
      setRestored(false);
    },
  };
}
export type MobileRecoveryState = ReturnType<typeof useMobileRecovery>;
