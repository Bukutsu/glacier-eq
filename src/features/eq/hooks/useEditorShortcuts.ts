import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { parseNumericInput } from "@/lib/numericInput";

import type { RefObject } from "react";

export function useEditorShortcuts({
  undo,
  redo,
  saveProfile,
  reset,
  pullEq,
  pushEq,
  isBusy,
  eqOperationInFlightRef,
  recoveryPending,
}: {
  undo: () => void;
  redo: () => void;
  saveProfile: () => unknown;
  reset: () => unknown;
  pullEq: () => unknown;
  pushEq: () => unknown;
  isBusy: boolean;
  eqOperationInFlightRef: RefObject<boolean>;
  recoveryPending: boolean;
}) {
  const undoRedoRef = useRef({
    undo,
    redo,
    save: saveProfile,
    reset,
    pull: pullEq,
    push: pushEq,
  });

  useEffect(() => {
    undoRedoRef.current = {
      undo,
      redo,
      save: saveProfile,
      reset,
      pull: pullEq,
      push: pushEq,
    };
  }, [undo, redo, saveProfile, reset, pullEq, pushEq]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent global shortcuts while modals or alerts are active
      if (document.querySelector("dialog[open], .reconnecting-overlay")) {
        return;
      }
      if (isBusy || eqOperationInFlightRef.current || recoveryPending) return;

      const active = document.activeElement;
      // A range or checkbox input is not text editing: the browser handles
      // its own arrow keys but has no undo/redo, and counting it as an editor
      // made Ctrl+Z / Ctrl+Y / Ctrl+Enter dead whenever a band slider or a
      // DeviceView balance slider happened to hold focus.
      const isTextEntry =
        active instanceof HTMLInputElement
          ? active.type === "text" ||
            active.type === "search" ||
            active.type === "url" ||
            active.type === "email" ||
            active.type === "password" ||
            active.type === "number" ||
            active.type === "tel"
          : false;
      const isEditingText =
        active &&
        (isTextEntry ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          (active instanceof HTMLElement && active.isContentEditable));

      const isCtrl = e.ctrlKey || e.metaKey;
      if (isCtrl) {
        const key = e.key.toLowerCase();
        if (isEditingText) {
          if (
            (key === "s" || key === "r") &&
            active instanceof HTMLInputElement &&
            active.getAttribute("role") === "spinbutton"
          ) {
            // Numeric fields keep a local draft until blur. Flush the commit
            // before a shortcut snapshots or replaces the editor state.
            const valid = parseNumericInput(active.value) !== null;
            flushSync(() => active.blur());
            if (!valid) {
              e.preventDefault();
              return;
            }
          }
          if (key === "s") {
            e.preventDefault();
            undoRedoRef.current.save();
          } else if (e.shiftKey && key === "r") {
            e.preventDefault();
            undoRedoRef.current.reset();
          } else if (key === "r") {
            e.preventDefault();
            undoRedoRef.current.pull();
          }
          return;
        }

        if (e.shiftKey && key === "z") {
          e.preventDefault();
          undoRedoRef.current.redo();
        } else if (key === "z") {
          e.preventDefault();
          undoRedoRef.current.undo();
        } else if (key === "y") {
          e.preventDefault();
          undoRedoRef.current.redo();
        } else if (key === "s") {
          e.preventDefault();
          undoRedoRef.current.save();
        } else if (e.shiftKey && key === "r") {
          e.preventDefault();
          undoRedoRef.current.reset();
        } else if (key === "r") {
          e.preventDefault();
          undoRedoRef.current.pull();
        } else if (key === "enter") {
          e.preventDefault();
          undoRedoRef.current.push();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBusy, recoveryPending]);
}
