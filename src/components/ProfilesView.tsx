// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import type { StatusReporter } from "../stores/toastStore";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { confirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { Select } from "./Select";
import { invoke, readText, writeText, save } from "../lib/rpc";
import { profileIdentityKey } from "../lib/profileIdentity";
import { decodeUtf8 } from "../lib/utf8";
import { fuzzyMatch } from "../lib/search";
import { DEFAULT_PROFILE_NAME } from "../lib/peq";
import {
  parseAutoEqResult,
  type ParsedAutoEqResult,
} from "../lib/parsedAutoEq";
import { asyncContextEquals, type AsyncContext } from "../lib/asyncContext";
import type { Filter, PEQData, Profile } from "../types";
import type { ProfileMutationRunner } from "./ToolsPanel";

export interface ProfilesViewProps {
  peq: PEQData;
  profiles: Profile[];
  selectedPreset: string;
  profileSearch: string;
  setProfileSearch: (value: string) => void;
  newProfileName: string;
  setNewProfileName: (value: string) => void;
  onSelectProfile: (profile: Profile) => void;
  onApplyProfile?: (profile: Profile) => void;
  onReloadProfiles: () => void | Promise<Profile[]>;
  onOpenProfilesDir?: () => void;
  hideProfileFolderButton?: boolean;
  onReset: () => void;
  onSave: () => void;
  onDelete: () => void;
  setStatus: StatusReporter;
  onImportPEQ: (data: PEQData, name: string, isSaved: boolean) => boolean;
  getAsyncContext: () => AsyncContext;
  runProfileMutation: ProfileMutationRunner;
  dirty?: boolean;
  showActions?: boolean;
  isMobile?: boolean;
  preview?: ReactNode;
  onReviewEq?: () => void;
}



export const ProfilesView = memo(function ProfilesView({
  peq,
  profiles,
  selectedPreset,
  profileSearch,
  setProfileSearch,
  newProfileName,
  setNewProfileName,
  onSelectProfile,
  onApplyProfile,
  onReloadProfiles,
  onOpenProfilesDir,
  hideProfileFolderButton,
  onReset,
  onSave,
  onDelete,
  setStatus,
  onImportPEQ,
  getAsyncContext,
  runProfileMutation,
  dirty = false,
  showActions = true,
  preview,
  onReviewEq,
}: ProfilesViewProps) {
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [parsed, setParsed] = useState<ParsedAutoEqResult | null>(null);
  const [importName, setImportName] = useState("");
  const [isTemporary, setIsTemporary] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const parseRequestRef = useRef(0);
  const modalContextRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      parseRequestRef.current += 1;
      modalContextRef.current += 1;
    };
  }, []);

  useEffect(() => {
    setSaveAsOpen(false);
  }, [selectedPreset]);

  const saveNameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (saveAsOpen) saveNameRef.current?.focus();
  }, [saveAsOpen]);

  const query = profileSearch.trim().toLowerCase();
  const filteredProfiles = profiles.filter(
    (p) => !query || fuzzyMatch(query, p.name),
  );
  const selectedPresetKey = profileIdentityKey(selectedPreset);
  const selectedProfile = profiles.find(
    (profile) => profileIdentityKey(profile.name) === selectedPresetKey,
  );
  const savedProfiles = profiles.filter((p) => p.modified != null);
  const selectedIsSaved = savedProfiles.some(
    (profile) => profileIdentityKey(profile.name) === selectedPresetKey,
  );

  const showSaveAs = (!selectedIsSaved && dirty) || saveAsOpen;
  const saveName = newProfileName.trim();
  const isOverwrite = savedProfiles.some(
    (p) => profileIdentityKey(p.name) === profileIdentityKey(saveName),
  );
  const canSave = showSaveAs ? !!saveName : (selectedIsSaved && dirty);
  const saveLabel = showSaveAs
    ? isOverwrite
      ? "Overwrite profile"
      : "Save profile"
    : dirty
      ? "Save changes"
      : "Profile saved";

  const handleSelectProfile = async (profile: Profile) => {
    if (profileIdentityKey(selectedPreset) === profileIdentityKey(profile.name)) return;
    if (
      dirty &&
      !(await confirmDialog({
        title: "Discard changes?",
        message: "Loading this profile will discard your unsaved changes.",
        confirmLabel: "Discard and load",
      }))
    ) {
      return;
    }
    onSelectProfile(profile);
  };

  const invalidateModalOperation = () => {
    modalContextRef.current += 1;
    setIsSubmitting(false);
  };

  const handleImportFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const request = ++parseRequestRef.current;

    if (!file.name.endsWith(".txt")) {
      setStatus("Only .txt AutoEQ files are supported.", "info");
      return;
    }

    try {
      if (file.size > 1_048_576) throw new Error("File exceeds the 1 MiB limit.");
      const text = decodeUtf8(await file.arrayBuffer());
      await parseAndLoadText(text, file.name.replace(/\.[^/.]+$/, ""), request);
    } catch (error) {
      if (request === parseRequestRef.current) {
        setStatus(`Failed to import: ${error}`);
      }
    }
  };

  const parseAndLoadText = async (
    text: string,
    defaultNameFallback: string,
    request: number,
  ) => {
    try {
      const rawResult = await invoke<unknown>("parse_autoeq", { text });
      if (request !== parseRequestRef.current) return;
      const result = parseAutoEqResult(rawResult);
      invalidateModalOperation();
      setParsed(result);
      const initialName =
        result.headphone_name || defaultNameFallback || "Imported Profile";
      setImportName(initialName);
      setIsTemporary(false);
      setStatus("Parsed AutoEQ profile");
    } catch (error) {
      if (request === parseRequestRef.current) {
        setStatus(`Failed to import: ${error}`);
      }
    }
  };

  const handlePaste = async () => {
    const request = ++parseRequestRef.current;
    try {
      const text = await readText();
      if (!text.trim()) throw new Error("Clipboard is empty.");
      await parseAndLoadText(
        text,
        `Pasted ${new Date().toLocaleDateString()}`,
        request,
      );
    } catch (err) {
      if (request === parseRequestRef.current) {
        setStatus(`Could not read clipboard: ${err}`);
        console.error(err);
      }
    }
  };

  const handleCopy = async () => {
    try {
      const text = await invoke<string>("peq_to_autoeq", { peq });
      await writeText(text);
      setStatus("Copied EQ to clipboard");
    } catch (err) {
      setStatus(`Failed to copy: ${err}`);
    }
  };

  const handleExportFile = async () => {
    try {
      const text = await invoke<string>("peq_to_autoeq", { peq });
      const baseName = importName || selectedPreset || "eq_profile";
      const defaultName = `${baseName.replace(/[^a-zA-Z0-9_\-@+&.() ]/g, "")}.txt`;
      const path = await save({
        defaultPath: defaultName,
        filters: [{ name: "Text Files", extensions: ["txt"] }],
      });
      if (!path) {
        setStatus("Export cancelled.");
        return;
      }
      const savedName = await invoke<string | null>("save_text_file", {
        path,
        content: text,
      });
      if (savedName === null) {
        setStatus("Export cancelled.");
        return;
      }
      setStatus("Exported EQ profile");
    } catch (err) {
      setStatus(`Failed to export: ${err}`);
    }
  };

  const handleConfirmImport = async () => {
    if (!parsed || isSubmitting) return;

    const operation = ++modalContextRef.current;
    const context = getAsyncContext();
    const parsedSnapshot = parsed;
    const nameSnapshot = importName;
    const temporarySnapshot = isTemporary;
    const isCurrent = () =>
      mountedRef.current &&
      operation === modalContextRef.current &&
      asyncContextEquals(context, getAsyncContext());
    setIsSubmitting(true);
    let writeCompleted = false;

    try {
      if (
        nameExists &&
        !(await confirmDialog({
          title: "Overwrite profile?",
          message: `A profile named "${nameSnapshot.trim()}" already exists. Overwrite it?`,
          confirmLabel: "Overwrite",
          danger: true,
        }))
      ) {
        return;
      }
      if (!isCurrent()) return;

      if (temporarySnapshot) {
        const applied = onImportPEQ(parsedSnapshot.peq, nameSnapshot || "Imported EQ", false);
        if (!applied) {
          setStatus("Import was not applied because a device operation is in progress.", "info");
          return;
        }
        setParsed(null);
        setStatus("Applied to editor without saving");
        return;
      }

      const name = nameSnapshot.trim();
      if (!name) {
        setStatus("Enter a name for the profile.", "info");
        return;
      }
      if (name === DEFAULT_PROFILE_NAME) {
        setStatus(`"${DEFAULT_PROFILE_NAME}" is reserved. Choose another name.`, "info");
        return;
      }

      let canonicalName = profiles.find(
        (profile) => profileIdentityKey(profile.name) === profileIdentityKey(name),
      )?.name ?? name;
      const mutation = await runProfileMutation(async () => {
        await invoke("save_profile", { name, peq: parsedSnapshot.peq });
        writeCompleted = true;
        const loadedProfiles = await onReloadProfiles();
        canonicalName = loadedProfiles?.find(
          (profile) => profileIdentityKey(profile.name) === profileIdentityKey(name),
        )?.name ?? canonicalName;
      });
      if (!mutation.current || !isCurrent()) return;

      const applied = onImportPEQ(parsedSnapshot.peq, canonicalName, true);
      if (!applied) {
        setStatus("Profile was saved, but a device operation is in progress. The editor was not changed.", "info");
        return;
      }
      setParsed(null);
      setStatus(`Profile "${canonicalName}" saved`);
    } catch (err) {
      if (isCurrent()) {
        setStatus(
          writeCompleted
            ? `Profile was saved, but the profile list could not be refreshed: ${err}`
            : `Failed to save profile: ${err}`,
        );
      }
    } finally {
      if (mountedRef.current && operation === modalContextRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  const handleCancelImport = () => {
    if (isSubmitting) return;
    invalidateModalOperation();
    setParsed(null);
  };

  const importNameKey = profileIdentityKey(importName.trim());
  const nameExists = parsed
    ? !isTemporary && savedProfiles.some((p) => profileIdentityKey(p.name) === importNameKey)
    : false;
  const activeFilters = parsed ? parsed.peq.filters.filter((f: Filter) => f.enabled) : [];
  const handleReloadProfiles = () => {
    void Promise.resolve(onReloadProfiles()).catch((error) => {
      setStatus(`Failed to refresh profiles: ${error}`);
    });
  };

  const beginSaveAs = () => {
    setNewProfileName("");
    setSaveAsOpen(true);
  };
  const editorState = dirty
    ? selectedIsSaved ? "Unsaved changes" : "Unsaved EQ"
    : selectedIsSaved ? "Saved profile" : selectedPreset === DEFAULT_PROFILE_NAME ? "Built-in EQ" : "Not saved";
  const enabledBands = peq.filters.filter(filter => filter.enabled).length;

  return (
    <div className="profiles-workspace">
      <section className="profiles-library" aria-labelledby="profiles-title">
        <header className="profiles-header">
          <div>
            <h2 id="profiles-title">Profiles</h2>
            <p className="profiles-note">{savedProfiles.length} saved</p>
          </div>
          <div className="profiles-header-actions">
            <Button onClick={handleImportFileClick}><Icon name="file_upload" /> Import profile</Button>
            <ProfilesMenu label="Import options">
              <Menu.Item className="ui-menu-item" onClick={handlePaste}>
                <Icon name="content_paste" /> Paste EQ from clipboard
              </Menu.Item>
            </ProfilesMenu>
          </div>
        </header>

        <div className="profiles-search">
          <Input type="search" className="pr-11" aria-label="Search profiles" placeholder="Search profiles…"
            value={profileSearch} onChange={event => setProfileSearch(event.target.value)} />
          {profileSearch.length > 0 && (
            <Button variant="ghost" size="icon" className="profiles-search-clear"
              aria-label="Clear search" onClick={() => setProfileSearch("")}>
              <Icon name="close" />
            </Button>
          )}
        </div>

        {!query && savedProfiles.length === 0 && (
          <div className="profiles-empty">
            <h3>No saved profiles yet</h3>
            <p>Save your current EQ or import a profile to start your library.</p>
          </div>
        )}
        {query && filteredProfiles.length === 0 && (
          <div className="profiles-empty" role="status">
            <h3>No matching profiles</h3>
            <p>Try another name or clear the search.</p>
            <Button variant="ghost" onClick={() => setProfileSearch("")}>Clear search</Button>
          </div>
        )}
        <div className="profiles-list" role="group" aria-label="Profiles list">
          {filteredProfiles.map(profile => {
            const isSelected = profileIdentityKey(profile.name) === selectedPresetKey;
            const bands = profile.data.filters.filter(filter => filter.enabled).length;
            return (
              <div key={profile.name} className={`profiles-item${isSelected ? " is-current" : ""}`}>
                <Button variant="ghost" className="profiles-load" aria-pressed={isSelected}
                  aria-label={`Load ${profile.name} into editor`} onClick={() => handleSelectProfile(profile)}>
                  <span className="profiles-item-text">
                    <span className="profiles-item-name" title={profile.name}>{profile.name}</span>
                    <span className="profiles-note">{profile.modified == null ? "Built-in" : `${bands} ${bands === 1 ? "band" : "bands"}`}</span>
                  </span>
                  {isSelected && <span className="profiles-badge">In editor</span>}
                </Button>
                {onApplyProfile && (
                  <ProfilesMenu label={`Actions for ${profile.name}`}>
                    <Menu.Item className="ui-menu-item" aria-label={`Apply ${profile.name} to DAC temporarily`}
                      onClick={() => onApplyProfile(profile)}>
                      <Icon name="send" /> Apply temporarily to DAC
                    </Menu.Item>
                  </ProfilesMenu>
                )}
              </div>
            );
          })}
        </div>
        <footer className="profiles-library-footer">
          <Button variant="ghost" onClick={handleReloadProfiles}><Icon name="refresh" /> Refresh</Button>
          {!hideProfileFolderButton && onOpenProfilesDir && (
            <Button variant="ghost" onClick={onOpenProfilesDir}><Icon name="folder" /> Open folder</Button>
          )}
        </footer>
      </section>

      <section className="profiles-editor" aria-labelledby="profiles-editor-title">
        <header className="profiles-header">
          <h2 id="profiles-editor-title">In the editor</h2>
          <ProfilesMenu label="More profile actions">
            <Menu.Item className="ui-menu-item" onClick={handleExportFile}>
              <Icon name="file_download" /> Export EQ file
            </Menu.Item>
            <Menu.Item className="ui-menu-item" onClick={handleCopy}>
              <Icon name="content_copy" /> Copy EQ to clipboard
            </Menu.Item>
            {onApplyProfile && selectedProfile && selectedIsSaved && (
              <Menu.Item className="ui-menu-item" onClick={() => onApplyProfile(selectedProfile)}>
                <Icon name="send" /> Apply saved profile to DAC temporarily
              </Menu.Item>
            )}
            {showActions && dirty && (
              <Menu.Item className="ui-menu-item" onClick={onReset}>
                <Icon name="restart_alt" /> Discard changes
              </Menu.Item>
            )}
            {showActions && selectedIsSaved && !showSaveAs && (
              <Menu.Item className="ui-menu-item profiles-menu-danger" onClick={onDelete}>
                <Icon name="delete" /> Delete profile
              </Menu.Item>
            )}
          </ProfilesMenu>
        </header>
        <h3 className="profiles-editor-name" title={selectedPreset}>{selectedPreset}</h3>
        <div className="profiles-editor-meta">
          <span>{enabledBands} {enabledBands === 1 ? "band" : "bands"}</span>
          <span>{peq.global_gain.toFixed(2)} dB preamp</span>
        </div>
        <p className="profiles-editor-state" data-modified={dirty}>{editorState}</p>

        {showActions && (
          showSaveAs ? (
            <form className="profile-save-form" onSubmit={event => {
              event.preventDefault();
              if (canSave) onSave();
            }}>
              <label htmlFor="profile-save-name">Profile name</label>
              <Input id="profile-save-name" ref={saveNameRef} name="profile-name" autoComplete="off"
                placeholder="Profile name…" value={newProfileName}
                aria-describedby={isOverwrite ? "profile-overwrite-hint" : undefined}
                onChange={event => setNewProfileName(event.target.value)} />
              {isOverwrite && <p id="profile-overwrite-hint" className="profiles-note profiles-warning">
                A profile with this name already exists. Saving will replace it.
              </p>}
              <div className="profiles-editor-actions">
                <Button type="submit" variant="primary" disabled={!canSave}>{saveLabel}</Button>
                {saveAsOpen && (
                  <Button variant="ghost" onClick={() => {
                    setNewProfileName("");
                    setSaveAsOpen(false);
                  }}>Cancel</Button>
                )}
              </div>
            </form>
          ) : (
            <div className="profiles-editor-actions">
              {selectedIsSaved && (
                <Button variant="primary" onClick={onSave} disabled={!canSave}>
                  {dirty ? "Save changes" : "Profile saved"}
                </Button>
              )}
              <Button variant={selectedIsSaved ? "default" : "primary"} onClick={beginSaveAs}>
                {selectedIsSaved ? "Save as copy" : "Save as new profile"}
              </Button>
            </div>
          )
        )}
        {onReviewEq && <Button variant="ghost" className="profiles-edit-eq" onClick={onReviewEq}>Edit EQ</Button>}
        {preview && <div className="profiles-preview" aria-label="Current EQ preview">{preview}</div>}
        <p className="profiles-note profiles-safety">Loading a profile changes the editor, not the DAC.</p>
        {selectedProfile?.modified != null && (
          <p className="profiles-note">Modified {new Date(selectedProfile.modified * 1000).toLocaleDateString()}</p>
        )}
      </section>

      <input className="hidden-file-input" type="file" ref={fileInputRef} accept=".txt" onChange={handleFileChange} />

      {parsed && (
        <Modal title="Import profile" className="profiles-import-dialog" onClose={handleCancelImport} closeDisabled={isSubmitting}>
          <div className="modal-body">
            <div className="profiles-import-modes" role="group" aria-label="Import destination mode">
              <Button variant={!isTemporary ? "default" : "ghost"} aria-pressed={!isTemporary} disabled={isSubmitting}
                onClick={() => {
                  if (isSubmitting) return;
                  invalidateModalOperation();
                  setIsTemporary(false);
                }}>Save profile</Button>
              <Button variant={isTemporary ? "default" : "ghost"} aria-pressed={isTemporary} disabled={isSubmitting}
                onClick={() => {
                  if (isSubmitting) return;
                  invalidateModalOperation();
                  setIsTemporary(true);
                }}>Editor only</Button>
            </div>
            {!isTemporary ? (
              <div className="profiles-import-fields">
                <label htmlFor="import-name">Profile name</label>
                <Input id="import-name" value={importName} disabled={isSubmitting} placeholder="Profile name…"
                  onChange={event => {
                    if (isSubmitting) return;
                    invalidateModalOperation();
                    setImportName(event.target.value);
                  }} />
                {savedProfiles.length > 0 && (
                  <>
                    <label htmlFor="overwrite-select">Overwrite an existing profile</label>
                    <Select id="overwrite-select" value={profiles.some(p => p.name === importName) ? importName : ""}
                      disabled={isSubmitting} onChange={value => {
                        if (isSubmitting) return;
                        if (value) {
                          invalidateModalOperation();
                          setImportName(value);
                        }
                      }} options={[
                        { value: "", label: "Select profile" },
                        ...savedProfiles.map(profile => ({ value: profile.name, label: profile.name })),
                      ]} />
                  </>
                )}
                {nameExists && <p className="profiles-note profiles-warning">
                  A profile with this name already exists. Saving will replace it.
                </p>}
              </div>
            ) : <p className="profiles-note">Loads the imported filters into the EQ editor without saving a profile.</p>}

            {activeFilters.length > 0 && (
              <section className="profiles-import-preview" aria-label="Filter preview">
                <h3>Filter preview</h3>
                <div className="profiles-import-filter-list">
                  {activeFilters.map((filter, index) => (
                    <p key={index}>
                      Band {filter.index + 1}: {filter.filter_type} at {filter.freq} Hz,
                      {" "}{filter.gain.toFixed(1)} dB, Q {filter.q.toFixed(2)}
                    </p>
                  ))}
                </div>
              </section>
            )}
            {parsed.warnings.length > 0 && (
              <section className="profiles-import-warnings" aria-label="Import warnings">
                <h3>Import warnings</h3>
                <ul>{parsed.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
              </section>
            )}
            <div className="modal-actions">
              <Button variant="primary" disabled={isSubmitting || (!isTemporary && !importName.trim())}
                onClick={handleConfirmImport}>{isTemporary ? "Apply to editor" : "Save profile"}</Button>
              <Button variant="ghost" disabled={isSubmitting} onClick={handleCancelImport}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
});

function ProfilesMenu({ label, children }: { label: string; children: ReactNode }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Menu.Root>
      <Menu.Trigger ref={triggerRef} aria-label={label} render={<Button variant="ghost" size="icon" />}>
        <Icon name="more_vert" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6} positionMethod="fixed" className="ui-popup-positioner">
          <Menu.Popup className="ui-menu profiles-menu" aria-label={label} onClick={event => {
            // Native dialogs must remember the trigger, not an unmounted menu item.
            if (event.target instanceof Element && event.target.closest('[role="menuitem"]')) {
              triggerRef.current?.focus();
            }
          }}>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
