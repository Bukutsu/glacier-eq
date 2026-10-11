import type { PEQData } from "../types";
import { parseStoredPeqResponse } from "./peq";

export const EDITOR_DRAFT_KEY = "glacier-editor-draft";
export interface EditorDraft {
  version: 1;
  name: string;
  peq: PEQData;
}

/** Stored drafts are untrusted input. Validate without clamping their data. */
export function parseEditorDraft(raw: string | null): EditorDraft | null {
  if (raw === null || raw === "null") return null;
  if (raw.length > 65536) throw new Error("EQ draft is too large");
  const draft = JSON.parse(raw) as Partial<EditorDraft> | null;
  if (!draft || draft.version !== 1 || typeof draft.name !== "string"
    || draft.name.length > 256 || !draft.peq
    || !Array.isArray(draft.peq.filters)
    || draft.peq.filters.length < 1 || draft.peq.filters.length > 32
    || draft.peq.filters.some((filter, index) =>
      !filter || filter.index !== index || typeof filter.enabled !== "boolean"
      || typeof filter.filter_type !== "string")) {
    throw new Error("Invalid EQ draft");
  }
  // Reuse the existing finite-value, filter-type and frequency validation.
  // Its normalized result is deliberately ignored: recovery must preserve
  // the stored draft until the editor applies its current capabilities.
  parseStoredPeqResponse(draft.peq);
  return draft as EditorDraft;
}
