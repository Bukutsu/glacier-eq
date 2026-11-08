import { i18n } from "@/lib/i18n";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { PEQData } from "@/types";
import {
  EDITOR_DRAFT_KEY,
  parseEditorDraft,
  type EditorDraft,
} from "@/features/eq/lib/editorDraft";
import { readLocalStorage, writeLocalStorage } from "@/lib/safeStorage";
import { useToastStore } from "@/stores/toastStore";

/**
 * Startup recovery of a saved draft. Exactly one state at a time:
 *
 *   none --(load ok, draft found)--> pending(draft)
 *   none --(load throws)-----------> invalid
 *   pending | invalid --resolveDraft--> none
 *
 * Autosave is paused until the state is `none`.
 */
type DraftRecovery =
  | { kind: "none" }
  | { kind: "pending"; draft: EditorDraft }
  | { kind: "invalid" };

function loadDraftRecovery(): DraftRecovery {
  try {
    const draft = parseEditorDraft(readLocalStorage(EDITOR_DRAFT_KEY));
    return draft ? { kind: "pending", draft } : { kind: "none" };
  } catch {
    return { kind: "invalid" };
  }
}

export function useEditorDraft(
  peq: PEQData,
  dirty: boolean,
  name: RefObject<string>,
) {
  const [recovery, setRecovery] = useState(loadDraftRecovery);
  const pendingDraft = recovery.kind === "pending" ? recovery.draft : null;
  const draftInvalid = recovery.kind === "invalid";
  const warned = useRef(false);
  const lastSaved = useRef<string | null>(readLocalStorage(EDITOR_DRAFT_KEY));

  useEffect(() => {
    // Do not overwrite an unresolved or damaged draft on startup.
    if (pendingDraft || draftInvalid) {
      if (draftInvalid && !warned.current) {
        warned.current = true;
        useToastStore
          .getState()
          .setStatus(i18n.t("editor:draft.recoverFailed"), "error");
      }
      return;
    }
    // Persist each committed editor state, rather than relying on unload:
    // Android may kill the process without a final lifecycle event.
    const value = dirty
      ? JSON.stringify({ version: 1, name: name.current.slice(0, 256), peq })
      : "null";
    if (value === lastSaved.current || (!dirty && lastSaved.current === null))
      return;
    if (!writeLocalStorage(EDITOR_DRAFT_KEY, value)) {
      if (!warned.current) {
        warned.current = true;
        useToastStore
          .getState()
          .setStatus(i18n.t("editor:draft.saveFailed"), "error");
      }
    } else {
      lastSaved.current = value;
      warned.current = false;
    }
  }, [peq, dirty, name, pendingDraft, draftInvalid]);

  return {
    pendingDraft,
    draftInvalid,
    resolveDraft: () => setRecovery({ kind: "none" }),
  };
}
