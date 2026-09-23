import { useCallback, useRef, useState } from "react";
import { invoke } from "../../lib/rpc";
import { profileIdentityKey } from "../../lib/profileIdentity";
import { confirmDialog } from "../../components/ConfirmDialog";
import { profileOverwriteMessage } from "../../lib/profileOverwrite";
import {
  buildDefaultState,
  DEFAULT_PROFILE_NAME,
  normalizePeq,
  peqEquals,
} from "../../lib/peq";
import type { DeviceCapabilities, PEQData, Profile } from "../../types";

export type { AsyncContext } from "../../lib/asyncContext";

export type ProfileMutationRunner = <T>(
  task: () => Promise<T>,
) => Promise<{ value: T; current: boolean }>;

/** Editor state the profile library reads and writes. */
export interface ProfilesEditor {
  peqRef: { current: PEQData };
  editorCleanPeqRef: { current: PEQData };
  capabilities: DeviceCapabilities;
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
 * Owns the profile library: list state, selection/search/name inputs, the
 * serialized save/delete queue, and load/save/delete/apply/import operations.
 */
export function useProfiles(
  editor: ProfilesEditor,
  setStatus: (message: string) => void,
) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
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
    async <T,>(task: () => Promise<T>): Promise<{ value: T; current: boolean }> => {
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
      const { capabilities } = editor;
      editor.pushToUndoStack(editor.peqRef.current);
      const data = normalizePeq(profile.data, { enableLoadedFilters: true, integerPreamp: capabilities.integer_preamp, capabilities });
      editor.setPeq(data);
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
    (data: PEQData, name: string, isSaved: boolean) => {
      const { capabilities } = editor;
      editor.pushToUndoStack(editor.peqRef.current);
      const normalized = normalizePeq(data, { enableLoadedFilters: true, integerPreamp: capabilities.integer_preamp, capabilities });
      editor.setPeq(normalized);
      setSelectedPreset(name);
      setProfileSearch("");
      setNewProfileName(name);
      if (isSaved) editor.editorCleanPeqRef.current = normalized;
      editor.noteEditorMutation();
      editor.setDirty(!isSaved);
    },
    [editor],
  );

  const profileLoadGenerationRef = useRef(0);
  const loadProfiles = useCallback(async (): Promise<Profile[]> => {
    const generation = ++profileLoadGenerationRef.current;
    try {
      const loadedProfiles = await invoke<Profile[]>("list_profiles");
      if (generation !== profileLoadGenerationRef.current) return [];
      const nextProfiles = withSyntheticDefault(loadedProfiles);
      setProfiles(nextProfiles);
      return nextProfiles;
    } catch (error) {
      if (generation !== profileLoadGenerationRef.current) return [];
      setStatus(`Failed to load profiles: ${error}`);
      return [];
    }
  }, [setStatus]);

  const saveProfile = useCallback(async () => {
    const savedPeq = editor.peqRef.current;
    const savedContext = {
      selectedPreset: selectedPresetRef.current,
      profileSearch: profileSearchRef.current,
      newProfileName: newProfileNameRef.current,
    };
    const name = savedContext.newProfileName.trim() || savedContext.selectedPreset;
    if (
      !name ||
      name === DEFAULT_PROFILE_NAME ||
      name === "Pulled from device"
    ) {
      setStatus("Enter a profile name before saving.");
      return;
    }

    const existing = profiles.find(
      (p) => profileIdentityKey(p.name) === profileIdentityKey(name),
    );
    if (existing && !(await confirmDialog({
      title: "Overwrite profile?",
      message: profileOverwriteMessage(name, existing.data, savedPeq),
      confirmLabel: "Overwrite",
      danger: true,
    }))) return;

    try {
      let canonicalName = existing?.name ?? name;
      const mutation = await runProfileMutation(async () => {
        await invoke("save_profile", { name, peq: savedPeq });
        const loadedProfiles = await loadProfiles();
        canonicalName = loadedProfiles.find(
          (profile) => profileIdentityKey(profile.name) === profileIdentityKey(name),
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
      setStatus("Profile saved");
    } catch (error) {
      setStatus(`Failed to save profile: ${error}`);
    }
  }, [editor, profiles, loadProfiles, setStatus, runProfileMutation]);

  const deleteSelectedProfile = useCallback(async () => {
    const deletedName = selectedPresetRef.current;
    if (deletedName === DEFAULT_PROFILE_NAME) return;
    const editorSnapshot = editor.peqRef.current;
    const deletedContext = {
      profileSearch: profileSearchRef.current,
      newProfileName: newProfileNameRef.current,
    };
    if (!(await confirmDialog({
      title: "Delete profile?",
      message: `Delete profile "${deletedName}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    }))) return;

    try {
      const mutation = await runProfileMutation(async () => {
        await invoke("delete_profile", { name: deletedName });
        await loadProfiles();
      });
      const contextStillCurrent =
        mutation.current &&
        selectedPresetRef.current === deletedName &&
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
      setStatus("Profile deleted");
    } catch (error) {
      setStatus(`Failed to delete profile: ${error}`);
    }
  }, [editor, loadProfiles, setStatus, runProfileMutation]);

  const openProfilesDir = useCallback(async () => {
    try {
      await invoke("open_profiles_dir");
    } catch (error) {
      setStatus(`Failed to open profiles folder: ${error}`);
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
    saveProfile,
    deleteSelectedProfile,
    openProfilesDir,
    applyProfile,
    importPeq,
    runProfileMutation,
  };
}
