import { i18n } from "@/lib/i18n";
import type { StatusReporter } from "@/stores/toastStore";
import { useCallback, useRef, useState } from "react";
import { invoke } from "@/lib/rpc";
import {
  isReservedProfileName,
  profileIdentityKey,
} from "@/features/profiles/lib/profileIdentity";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { profileOverwriteMessage } from "@/features/profiles/lib/profileOverwrite";
import {
  buildDefaultState,
  DEFAULT_PROFILE_NAME,
  normalizePeq,
  peqEquals,
} from "@/features/eq/lib/peq";
import type { DeviceCapabilities, PEQData, Profile } from "@/types";

export type { AsyncContext } from "@/lib/asyncContext";

export type ProfileMutationRunner = <T>(
  task: () => Promise<T>,
) => Promise<{ value: T; current: boolean }>;

/** Editor state the profile library reads and writes. */
export interface ProfilesEditor {
  peqRef: { current: PEQData };
  editorCleanPeqRef: { current: PEQData };
  capabilities: DeviceCapabilities;
  isBusy: boolean;
  pushToUndoStack: (peq: PEQData) => void;
  setPeq: (peq: PEQData) => void;
  setDirty: (dirty: boolean) => void;
  noteEditorMutation: () => void;
}

const withSyntheticDefault = (raw: Profile[]): Profile[] => [
  { name: DEFAULT_PROFILE_NAME, data: buildDefaultState(), modified: null },
  ...raw,
];

/**
 * Matches the editor's profile name against a freshly loaded library.
 * `previous` is the library before this load: a name that was never in it
 * (a generated, imported, recovered or DAC-read EQ) is not a lost profile,
 * so it keeps its name instead of turning into "Default EQ".
 */
export function reconcileProfileSelection(
  profiles: Profile[],
  selected: string,
  previous: Profile[],
): { name: string; missing: boolean } {
  const key = profileIdentityKey(selected);
  const match = profiles.find(
    (profile) => profileIdentityKey(profile.name) === key,
  );
  if (match) return { name: match.name, missing: false };
  const wasSaved = previous.some(
    (profile) => profileIdentityKey(profile.name) === key,
  );
  if (!wasSaved) return { name: selected, missing: false };
  return {
    name: DEFAULT_PROFILE_NAME,
    missing: selected !== DEFAULT_PROFILE_NAME,
  };
}

/**
 * Owns the profile library: list state, selection/search/name inputs, the
 * serialized save/delete queue, and load/save/delete/apply/import operations.
 */
export function useProfiles(editor: ProfilesEditor, setStatus: StatusReporter) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const [selectedPreset, setSelectedPreset] = useState(DEFAULT_PROFILE_NAME);
  const selectedPresetRef = useRef(selectedPreset);
  selectedPresetRef.current = selectedPreset;
  const [profileSearch, setProfileSearch] = useState("");
  const profileSearchRef = useRef(profileSearch);
  profileSearchRef.current = profileSearch;
  const [newProfileName, setNewProfileName] = useState("");
  const newProfileNameRef = useRef(newProfileName);
  newProfileNameRef.current = newProfileName;

  // All profile save/delete work runs through this queue in user request
  // order. `current` is false when a newer mutation was requested while the
  // task ran, so stale completions never update profiles or editor.
  const profileMutationQueueRef = useRef(Promise.resolve());
  const profileMutationTicketRef = useRef(0);
  const runProfileMutation = useCallback(
    async <T>(
      task: () => Promise<T>,
    ): Promise<{ value: T; current: boolean }> => {
      const ticket = ++profileMutationTicketRef.current;
      const run = profileMutationQueueRef.current.then(async () => {
        const value = await task();
        return { value, current: profileMutationTicketRef.current === ticket };
      });
      profileMutationQueueRef.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    [],
  );

  const applyProfile = useCallback(
    (profile: Profile) => {
      if (editor.isBusy) return;
      const { capabilities } = editor;
      editor.pushToUndoStack(editor.peqRef.current);
      const data = normalizePeq(profile.data, {
        enableLoadedFilters: true,
        integerPreamp: capabilities.integer_preamp,
        capabilities,
      });
      editor.setPeq(data);
      // Set now, not on the next render, so "Use on DAC" can save this EQ
      // straight after loading it.
      editor.peqRef.current = data;
      setSelectedPreset(profile.name);
      setProfileSearch("");
      setNewProfileName("");
      editor.editorCleanPeqRef.current = data;
      editor.noteEditorMutation();
      editor.setDirty(false);
    },
    [editor],
  );

  const importPeq = useCallback(
    (data: PEQData, name: string, isSaved: boolean): boolean => {
      if (editor.isBusy) return false;
      const { capabilities } = editor;
      const normalized = normalizePeq(data, {
        enableLoadedFilters: true,
        integerPreamp: capabilities.integer_preamp,
        capabilities,
      });
      if (
        selectedPresetRef.current === name &&
        peqEquals(editor.peqRef.current, normalized) &&
        (!isSaved || peqEquals(editor.editorCleanPeqRef.current, normalized))
      )
        return true;
      editor.pushToUndoStack(editor.peqRef.current);
      editor.setPeq(normalized);
      setSelectedPreset(name);
      setProfileSearch("");
      setNewProfileName(name);
      if (isSaved) editor.editorCleanPeqRef.current = normalized;
      editor.noteEditorMutation();
      editor.setDirty(!isSaved);
      return true;
    },
    [editor],
  );

  const profileLoadGenerationRef = useRef(0);
  const loadProfiles = useCallback(
    async (options?: {
      preserveSelection?: boolean;
      throwOnError?: boolean;
    }): Promise<Profile[]> => {
      const generation = ++profileLoadGenerationRef.current;
      try {
        const loadedProfiles = await invoke<Profile[]>("list_profiles");
        if (generation !== profileLoadGenerationRef.current) return [];
        const nextProfiles = withSyntheticDefault(loadedProfiles);
        const previousProfiles = profilesRef.current;
        profilesRef.current = nextProfiles;
        setProfiles(nextProfiles);
        if (!options?.preserveSelection) {
          const reconciliation = reconcileProfileSelection(
            nextProfiles,
            selectedPresetRef.current,
            previousProfiles,
          );
          if (reconciliation.name !== selectedPresetRef.current) {
            selectedPresetRef.current = reconciliation.name;
            setSelectedPreset(reconciliation.name);
          }
          if (reconciliation.missing) {
            const renamed = nextProfiles.find(
              (profile) =>
                profileIdentityKey(profile.name) !==
                  profileIdentityKey(DEFAULT_PROFILE_NAME) &&
                peqEquals(
                  normalizePeq(profile.data, { enableLoadedFilters: true }),
                  editor.peqRef.current,
                ),
            );
            if (renamed) {
              selectedPresetRef.current = renamed.name;
              setSelectedPreset(renamed.name);
            } else {
              // The selected file was removed or renamed outside this window.
              // Keep the editor data visible, but make the loss of its saved
              // identity explicit instead of continuing to label it as saved.
              setProfileSearch("");
              setNewProfileName("");
              editor.setDirty(true);
            }
          }
        }
        return nextProfiles;
      } catch (error) {
        if (generation !== profileLoadGenerationRef.current) return [];
        if (options?.throwOnError) throw error;
        setStatus(
          i18n.t("library:profiles.failedToLoadProfiles", { error: error }),
        );
        return [];
      }
    },
    [editor, setStatus],
  );

  const reloadProfiles = useCallback(
    () => loadProfiles({ throwOnError: true }),
    [loadProfiles],
  );

  const saveProfile = useCallback(async () => {
    if (editor.isBusy) return;
    const savedPeq = editor.peqRef.current;
    const savedContext = {
      selectedPreset: selectedPresetRef.current,
      profileSearch: profileSearchRef.current,
      newProfileName: newProfileNameRef.current,
    };
    const name =
      savedContext.newProfileName.trim() || savedContext.selectedPreset;
    if (!name || name === "Pulled from device") {
      setStatus(
        i18n.t("library:profiles.enterAProfileNameBeforeSaving"),
        "info",
      );
      return;
    }

    if (isReservedProfileName(name)) {
      setStatus(i18n.t("library:profilesView.reservedName", { name }), "info");
      return;
    }

    const existing = profiles.find(
      (p) => profileIdentityKey(p.name) === profileIdentityKey(name),
    );
    if (
      existing &&
      !(await confirmDialog({
        title: i18n.t("library:profiles.overwriteProfile"),
        message: profileOverwriteMessage(name, existing.data, savedPeq),
        confirmLabel: i18n.t("library:profiles.overwrite"),
        danger: true,
      }))
    )
      return;

    let writeCompleted = false;
    try {
      let canonicalName = existing?.name ?? name;
      const mutation = await runProfileMutation(async () => {
        await invoke("save_profile", { name, peq: savedPeq });
        writeCompleted = true;
        const loadedProfiles = await loadProfiles({ throwOnError: true });
        canonicalName =
          loadedProfiles.find(
            (profile) =>
              profileIdentityKey(profile.name) === profileIdentityKey(name),
          )?.name ?? canonicalName;
      });
      const contextStillCurrent =
        mutation.current &&
        peqEquals(editor.peqRef.current, savedPeq) &&
        selectedPresetRef.current === savedContext.selectedPreset &&
        profileSearchRef.current === savedContext.profileSearch &&
        newProfileNameRef.current === savedContext.newProfileName;
      if (contextStillCurrent) {
        setSelectedPreset(canonicalName);
        setProfileSearch("");
        setNewProfileName("");
        editor.editorCleanPeqRef.current = savedPeq;
        editor.setDirty(false);
      }
      setStatus(i18n.t("library:profiles.profileSaved"));
    } catch (error) {
      setStatus(
        writeCompleted
          ? i18n.t("library:profiles.savedRefreshFailed", { error: error })
          : i18n.t("library:profiles.failedToSaveProfile", { error: error }),
      );
    }
  }, [editor, profiles, loadProfiles, setStatus, runProfileMutation]);

  /** Deletes any saved profile; the editor falls back to Default EQ only
   *  when the deleted profile is the one it holds. */
  const deleteProfile = useCallback(
    async (deletedName: string) => {
      if (editor.isBusy) return;
      const deletedKey = profileIdentityKey(deletedName);
      if (deletedKey === profileIdentityKey(DEFAULT_PROFILE_NAME)) return;
      const wasSelected =
        profileIdentityKey(selectedPresetRef.current) === deletedKey;
      const selectedSnapshot = selectedPresetRef.current;
      const editorSnapshot = editor.peqRef.current;
      const deletedContext = {
        profileSearch: profileSearchRef.current,
        newProfileName: newProfileNameRef.current,
      };
      if (
        !(await confirmDialog({
          title: i18n.t("library:profiles.deleteProfile"),
          message: i18n.t("library:profiles.deleteMessage", {
            name: deletedName,
          }),
          confirmLabel: i18n.t("library:profiles.delete"),
          danger: true,
        }))
      )
        return;

      let writeCompleted = false;
      try {
        const mutation = await runProfileMutation(async () => {
          await invoke("delete_profile", { name: deletedName });
          writeCompleted = true;
          await loadProfiles({ preserveSelection: true, throwOnError: true });
        });
        const contextStillCurrent =
          wasSelected &&
          mutation.current &&
          selectedPresetRef.current === selectedSnapshot &&
          peqEquals(editor.peqRef.current, editorSnapshot) &&
          profileSearchRef.current === deletedContext.profileSearch &&
          newProfileNameRef.current === deletedContext.newProfileName;
        if (contextStillCurrent) {
          editor.pushToUndoStack(editorSnapshot);
          setSelectedPreset(DEFAULT_PROFILE_NAME);
          setProfileSearch("");
          setNewProfileName("");
          const defaultPeq = buildDefaultState();
          editor.setPeq(defaultPeq);
          editor.editorCleanPeqRef.current = defaultPeq;
          editor.setDirty(false);
        }
        setStatus(i18n.t("library:profiles.profileDeleted"));
      } catch (error) {
        setStatus(
          writeCompleted
            ? i18n.t("library:profiles.deletedRefreshFailed", { error: error })
            : i18n.t("library:profiles.failedToDeleteProfile", {
                error: error,
              }),
        );
      }
    },
    [editor, loadProfiles, setStatus, runProfileMutation],
  );

  /** Renames a saved profile; resolves true once the rename landed. */
  const renameProfile = useCallback(
    async (from: string, requestedName: string): Promise<boolean> => {
      if (editor.isBusy) return false;
      const to = requestedName.trim();
      if (isReservedProfileName(from) || !to || to === from) return false;
      if (isReservedProfileName(to)) {
        setStatus(
          i18n.t("library:profilesView.reservedName", { name: to }),
          "info",
        );
        return false;
      }

      let writeCompleted = false;
      try {
        let canonicalName = to;
        const mutation = await runProfileMutation(async () => {
          await invoke("rename_profile", { from, to });
          writeCompleted = true;
          const loadedProfiles = await loadProfiles({
            preserveSelection: true,
            throwOnError: true,
          });
          canonicalName =
            loadedProfiles.find(
              (profile) =>
                profileIdentityKey(profile.name) === profileIdentityKey(to),
            )?.name ?? canonicalName;
        });
        // The editor keeps its EQ and unsaved state; only its saved name moves.
        if (
          mutation.current &&
          profileIdentityKey(selectedPresetRef.current) ===
            profileIdentityKey(from)
        ) {
          selectedPresetRef.current = canonicalName;
          setSelectedPreset(canonicalName);
        }
        setStatus(i18n.t("library:profiles.profileRenamed"));
        return true;
      } catch (error) {
        setStatus(
          writeCompleted
            ? i18n.t("library:profiles.renamedRefreshFailed", { error: error })
            : i18n.t("library:profiles.failedToRenameProfile", {
                error: error,
              }),
        );
        return writeCompleted;
      }
    },
    [editor, loadProfiles, setStatus, runProfileMutation],
  );

  const openProfilesDir = useCallback(async () => {
    try {
      await invoke("open_profiles_dir");
    } catch (error) {
      setStatus(
        i18n.t("library:profiles.failedToOpenProfilesFolder", { error: error }),
      );
    }
  }, [setStatus]);

  return {
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
  };
}
