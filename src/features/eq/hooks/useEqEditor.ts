import { i18n } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { invoke } from "@/lib/rpc";

import { confirmDialog } from "@/components/ui/ConfirmDialog";

import {
  buildDefaultState,
  DEFAULT_PROFILE_NAME,
  normalizePeq,
  normalizePeqForDevice,
  peqEquals,
} from "@/features/eq/lib/peq";

import { asyncContextEquals, type AsyncContext } from "@/lib/asyncContext";

import { restoreHistorySnapshot } from "@/features/eq/lib/restoredHistory";
import { parseAutoEqResult } from "@/features/tuning/lib/parsedAutoEq";
import type { Filter, PEQData } from "@/types";
import { type StatusReporter } from "@/stores/toastStore";

import { useHistoryStore } from "@/features/eq/stores/historyStore";

import { useEditorDraft } from "@/features/eq/hooks/useEditorDraft";
import { hasUnfinishedEdits } from "@/features/eq/lib/editorDraft";

import { OFFLINE_EDITOR_CAPABILITIES } from "@/features/device/lib/dacSpecs";

import { profileIdentityKey } from "@/features/profiles/lib/profileIdentity";

import { decodeUtf8 } from "@/lib/utf8";
import { useProfiles } from "@/features/profiles/hooks/useProfiles";

import type { DeviceState } from "@/features/device/hooks/useDeviceState";
import type { GraphPreview } from "./useGraphPreview";

export function useEqEditor(
  device: DeviceState,
  preview: GraphPreview,
  setStatus: StatusReporter,
) {
  const {
    capabilities,
    isBusy,
    connected,
    eqOperationInFlightRef,
    connectedRef,
    connectionGenerationRef,
    operationRevisionRef,
  } = device;
  const { startGraphPreview, schedulePreviewDismiss } = preview;
  const [peq, setPeq] = useState<PEQData>(buildDefaultState);

  const [dirty, setDirty] = useState(false);

  const peqRef = useRef(peq);

  peqRef.current = peq;

  const editorCleanPeqRef = useRef(peq);

  const selectedPresetRef = useRef(DEFAULT_PROFILE_NAME);

  // Bumped whenever the editor PEQ actually changes, so async completions
  // (pulls, imports, pushes) can detect edits that happened while they ran.
  const editorRevisionRef = useRef(0);

  const noteEditorMutation = useCallback(() => {
    editorRevisionRef.current += 1;
  }, []);

  const [activeBandIndex, setActiveBandIndex] = useState<number | null>(null);

  const pushToUndoStack = useCallback((currentPeq: PEQData) => {
    useHistoryStore.getState().pushSnapshot(currentPeq, {
      kind: "preset",
      selectedPreset: selectedPresetRef.current,
      cleanPeq: editorCleanPeqRef.current,
    });
  }, []);

  const handleStartChange = useCallback(() => {
    startGraphPreview();
    pushToUndoStack(peqRef.current);
  }, [startGraphPreview, pushToUndoStack]);

  const handleEndChange = useCallback(() => {
    schedulePreviewDismiss(1500);
  }, [schedulePreviewDismiss]);

  const handlePreampStartChange = useCallback(() => {
    // Preamp is positioned directly below the graph; never trigger the floating preview
    pushToUndoStack(peqRef.current);
  }, [pushToUndoStack]);

  const { pendingDraft, draftInvalid, resolveDraft } = useEditorDraft(
    peq,
    hasUnfinishedEdits(dirty, peq, editorCleanPeqRef.current),
    selectedPresetRef,
  );

  const recoveryPending = Boolean(pendingDraft || draftInvalid);

  const profilesEditor = useMemo(
    () => ({
      peqRef,
      editorCleanPeqRef,
      capabilities,
      isBusy: isBusy || recoveryPending,
      pushToUndoStack,
      setPeq,
      setDirty,
      noteEditorMutation,
    }),
    [
      capabilities,
      isBusy,
      recoveryPending,
      pushToUndoStack,
      noteEditorMutation,
    ],
  );

  const {
    profiles,
    selectedPreset,
    setSelectedPreset,
    profileSearch,
    setProfileSearch,
    newProfileName,
    setNewProfileName,
    loadProfiles,
    reloadProfiles,
    saveProfile,
    deleteProfile,
    renameProfile,
    openProfilesDir,
    applyProfile,
    importPeq,
    runProfileMutation,
  } = useProfiles(profilesEditor, setStatus);

  const restoreDraft = async () => {
    if (!pendingDraft || connected || isBusy || eqOperationInFlightRef.current)
      return;
    const context = getAsyncContext();
    if (
      dirty &&
      !(await confirmDialog({
        title: i18n.t("editor:draft.restoreTitle"),
        message: i18n.t("editor:draft.replaceConfirmation"),
        confirmLabel: i18n.t("editor:draft.confirmRestore"),
      }))
    )
      return;
    if (
      !asyncContextEquals(context, getAsyncContext()) ||
      connectedRef.current ||
      eqOperationInFlightRef.current
    )
      return;
    const name =
      pendingDraft.name && pendingDraft.name !== DEFAULT_PROFILE_NAME
        ? pendingDraft.name
        : i18n.t("editor:draft.recovered");
    // This explicit recovery path changes only the editor, never the DAC.
    pushToUndoStack(peqRef.current);
    setPeq(
      normalizePeq(pendingDraft.peq, {
        capabilities: OFFLINE_EDITOR_CAPABILITIES,
      }),
    );
    setSelectedPreset(name);
    setNewProfileName(name);
    setProfileSearch("");
    noteEditorMutation();
    setDirty(true);
    resolveDraft();
  };

  selectedPresetRef.current = selectedPreset;

  const restoreHistory = useCallback(
    (direction: "undo" | "redo") => {
      const history = useHistoryStore.getState();
      const restored = restoreHistorySnapshot({
        restore: history[direction],
        current: peqRef.current,
        currentMetadata: {
          kind: "preset",
          selectedPreset: selectedPresetRef.current,
          cleanPeq: editorCleanPeqRef.current,
        },
        clean: editorCleanPeqRef.current,
        capabilities,
      });
      if (!restored) return;
      const metadata = useHistoryStore.getState().lastRestoredMetadata;
      // Narrowed, not read through optionals: the union makes "a preset with
      // no clean baseline" unrepresentable, so the restore path no longer needs
      // a `??` fallback that would compute dirty against the wrong baseline.
      const restoredPreset = metadata?.kind === "preset" ? metadata : null;
      const metadataProfileExists = restoredPreset
        ? profiles.some(
            (profile) =>
              profileIdentityKey(profile.name) ===
              profileIdentityKey(restoredPreset.selectedPreset),
          )
        : false;
      const restoredClean = normalizePeqForDevice(
        metadataProfileExists && restoredPreset
          ? restoredPreset.cleanPeq
          : editorCleanPeqRef.current,
        capabilities,
      );
      peqRef.current = restored.peq;
      editorCleanPeqRef.current = restoredClean;
      setPeq(restored.peq);
      if (restoredPreset && metadataProfileExists) {
        selectedPresetRef.current = restoredPreset.selectedPreset;
        setSelectedPreset(restoredPreset.selectedPreset);
      } else if (restoredPreset) {
        selectedPresetRef.current = DEFAULT_PROFILE_NAME;
        setSelectedPreset(DEFAULT_PROFILE_NAME);
      }
      noteEditorMutation();
      setDirty(
        !metadataProfileExists || !peqEquals(restored.peq, restoredClean),
      );
    },
    [capabilities, noteEditorMutation, profiles, setSelectedPreset],
  );

  const undo = useCallback(() => restoreHistory("undo"), [restoreHistory]);

  const redo = useCallback(() => restoreHistory("redo"), [restoreHistory]);

  const getAsyncContext = useCallback(
    (): AsyncContext => ({
      editorRevision: editorRevisionRef.current,
      connectionRevision: connectionGenerationRef.current,
      operationRevision: operationRevisionRef.current,
    }),
    [],
  );

  // Auto-refresh profiles when window gains focus or tab becomes visible (catches external file changes)
  useEffect(() => {
    const handleFocus = () => loadProfiles();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadProfiles();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadProfiles]);

  // Drag-and-drop .txt file import
  const dropRequestRef = useRef(0);

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      // A rejected extension is still a newer user action. Invalidate an
      // older in-flight drop before validating the new one.
      const request = ++dropRequestRef.current;
      if (!file.name.endsWith(".txt")) {
        setStatus(i18n.t("editor:import.onlyText"), "info");
        return;
      }
      // Only the newest drop may land, and only onto the editor/connection
      // context it started with; anything else raced a newer user action.
      const context = getAsyncContext();
      try {
        if (file.size > 1_048_576)
          throw new Error(i18n.t("editor:import.tooLarge"));
        const text = decodeUtf8(await file.arrayBuffer());
        if (
          request !== dropRequestRef.current ||
          !asyncContextEquals(context, getAsyncContext())
        )
          return;
        const rawResult = await invoke<unknown>("parse_autoeq", { text });
        if (
          request !== dropRequestRef.current ||
          !asyncContextEquals(context, getAsyncContext())
        )
          return;
        const result = parseAutoEqResult(rawResult);
        const name =
          result.headphone_name || file.name.replace(/\.[^/.]+$/, "");
        if (!importPeq(result.peq, name, false)) {
          setStatus(i18n.t("editor:import.busy"), "info");
          return;
        }
        setStatus(
          result.warnings.length > 0
            ? i18n.t("editor:import.adjusted", {
                name,
                count: result.warnings.length,
              })
            : i18n.t("editor:import.success", { name }),
        );
      } catch (err) {
        if (request === dropRequestRef.current) {
          setStatus(i18n.t("editor:import.failed", { error: String(err) }));
        }
      }
    };
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [importPeq, getAsyncContext]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const updateFilter = useCallback(
    (index: number, updated: Filter, showPreview = true) => {
      if (isBusy || eqOperationInFlightRef.current) return;
      setActiveBandIndex(index);
      if (showPreview) startGraphPreview();
      setPeq((previous) => {
        const filters = [...previous.filters];
        filters[index] = updated;
        return { ...previous, filters };
      });
      noteEditorMutation();
      // A no-op edit or one restored exactly to the clean baseline must not
      // mark the profile dirty.
      setDirty(
        !peqEquals(
          {
            ...peqRef.current,
            filters: peqRef.current.filters.map((f, i) =>
              i === index ? updated : f,
            ),
          },
          editorCleanPeqRef.current,
        ),
      );
    },
    [isBusy, startGraphPreview, noteEditorMutation],
  );

  const handleFilterChangeNoPreview = useCallback(
    (index: number, filter: Filter) => updateFilter(index, filter, false),
    [updateFilter],
  );

  const reset = useCallback(async () => {
    if (isBusy || eqOperationInFlightRef.current) return;
    if (
      !(await confirmDialog({
        title: i18n.t("editor:reset.title"),
        message: i18n.t("editor:reset.description"),
        confirmLabel: i18n.t("editor:reset.confirm"),
        danger: true,
      }))
    )
      return;
    pushToUndoStack(peqRef.current);
    const defaultPeq = buildDefaultState();
    setPeq(defaultPeq);
    noteEditorMutation();
    setSelectedPreset(DEFAULT_PROFILE_NAME);
    setDirty(!peqEquals(defaultPeq, editorCleanPeqRef.current));
  }, [isBusy, pushToUndoStack, noteEditorMutation]);

  const canUndoHistory = useHistoryStore((s) => s.past.length > 0);

  const canRedoHistory = useHistoryStore((s) => s.future.length > 0);

  const handlePreampChange = useCallback(
    (global_gain: number) => {
      if (isBusy || eqOperationInFlightRef.current) return;
      const next = { ...peqRef.current, global_gain };
      setPeq(next);
      noteEditorMutation();
      setDirty(!peqEquals(next, editorCleanPeqRef.current));
    },
    [isBusy, noteEditorMutation],
  );
  return {
    peq,
    setPeq,
    dirty,
    setDirty,
    peqRef,
    editorCleanPeqRef,
    selectedPresetRef,
    editorRevisionRef,
    noteEditorMutation,
    activeBandIndex,
    setActiveBandIndex,
    pushToUndoStack,
    handleStartChange,
    handleEndChange,
    handlePreampStartChange,
    pendingDraft,
    draftInvalid,
    resolveDraft,
    recoveryPending,
    profiles,
    selectedPreset,
    setSelectedPreset,
    profileSearch,
    setProfileSearch,
    newProfileName,
    setNewProfileName,
    loadProfiles,
    reloadProfiles,
    saveProfile,
    deleteProfile,
    renameProfile,
    openProfilesDir,
    applyProfile,
    importPeq,
    runProfileMutation,
    restoreDraft,
    undo,
    redo,
    getAsyncContext,
    updateFilter,
    handleFilterChangeNoPreview,
    reset,
    canUndoHistory,
    canRedoHistory,
    handlePreampChange,
  };
}

export type EqEditor = ReturnType<typeof useEqEditor>;
