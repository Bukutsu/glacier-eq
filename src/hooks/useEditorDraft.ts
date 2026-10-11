import { useEffect, useRef, useState, type RefObject } from "react";
import type { PEQData } from "../types";
import { EDITOR_DRAFT_KEY, parseEditorDraft, type EditorDraft } from "../lib/editorDraft";
import { readLocalStorage, writeLocalStorage } from "../lib/safeStorage";
import { useToastStore } from "../stores/toastStore";

export function useEditorDraft(peq: PEQData, dirty: boolean, name: RefObject<string>) {
  const [loaded] = useState(() => {
    try {
      return { draft: parseEditorDraft(readLocalStorage(EDITOR_DRAFT_KEY)), invalid: false };
    } catch {
      return { draft: null, invalid: true };
    }
  });
  const [pendingDraft, setPendingDraft] = useState<EditorDraft | null>(loaded.draft);
  const [draftInvalid, setDraftInvalid] = useState(loaded.invalid);
  const warned = useRef(false);
  const lastSaved = useRef<string | null>(readLocalStorage(EDITOR_DRAFT_KEY));

  useEffect(() => {
    // Do not overwrite an unresolved or damaged draft on startup.
    if (pendingDraft || draftInvalid) {
      if (draftInvalid && !warned.current) {
        warned.current = true;
        useToastStore.getState().setStatus("Could not recover the unfinished EQ. Its stored draft has been kept.", "error");
      }
      return;
    }
    // Persist each committed editor state, rather than relying on unload:
    // Android may kill the process without a final lifecycle event.
    const value = dirty ? JSON.stringify({ version: 1, name: name.current.slice(0, 256), peq }) : "null";
    if (value === lastSaved.current || (!dirty && lastSaved.current === null)) return;
    if (!writeLocalStorage(EDITOR_DRAFT_KEY, value)) {
      if (!warned.current) {
        warned.current = true;
        useToastStore.getState().setStatus("Could not save the unfinished EQ for recovery. Save a profile before closing the app.", "error");
      }
    } else {
      lastSaved.current = value;
      warned.current = false;
    }
  }, [peq, dirty, name, pendingDraft, draftInvalid]);

  return {
    pendingDraft,
    draftInvalid,
    resolveDraft: () => { setPendingDraft(null); setDraftInvalid(false); },
  };
}
