import type { MobileRecoveryState } from "../hooks/useMobileRecovery";
import type { EqEditor } from "../hooks/useEqEditor";
import {
  DraftRestoredNotice,
  MobileDraftRecovery,
} from "./MobileDraftRecovery";

export function MobileRecovery({
  editor,
  connected,
  isBusy,
  recovery,
}: {
  editor: EqEditor;
  connected: boolean;
  isBusy: boolean;
  recovery: MobileRecoveryState;
}) {
  const { restored, autoRestoreDone } = recovery;
  const { draftInvalid, restoreDraft } = editor;
  return (
    <>
      {editor.recoveryPending && (draftInvalid || autoRestoreDone) && (
        <MobileDraftRecovery
          invalid={draftInvalid}
          connected={connected}
          isBusy={isBusy}
          onRestore={restoreDraft}
          onDiscard={editor.resolveDraft}
        />
      )}
      {restored && (
        <DraftRestoredNotice
          isBusy={isBusy}
          onKeep={recovery.keep}
          onDiscard={recovery.discard}
        />
      )}
    </>
  );
}
