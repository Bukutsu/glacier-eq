// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo, useEffect, useRef, useState } from "react";
import { confirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { Select } from "./Select";
import { invoke, readText, writeText, save } from "../lib/rpc";
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
  onReloadProfiles: () => void | Promise<void>;
  onOpenProfilesDir?: () => void;
  hideProfileFolderButton?: boolean;
  onReset: () => void;
  onSave: () => void;
  onDelete: () => void;
  setStatus: (value: string) => void;
  onImportPEQ: (data: PEQData, name: string, isSaved: boolean) => void;
  getAsyncContext: () => AsyncContext;
  runProfileMutation: ProfileMutationRunner;
  dirty?: boolean;
  showActions?: boolean;
  isMobile?: boolean;
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

  const query = profileSearch.trim().toLowerCase();
  const filteredProfiles = profiles.filter(
    (p) => !query || fuzzyMatch(query, p.name),
  );
  const selectedProfile = profiles.find((p) => p.name === selectedPreset);
  const savedProfiles = profiles.filter((p) => p.modified != null);
  const selectedIsSaved = savedProfiles.some((p) => p.name === selectedPreset);

  const showSaveAs = (!selectedIsSaved && dirty) || saveAsOpen;
  const saveName = newProfileName.trim();
  const isOverwrite = savedProfiles.some(
    (p) => p.name.toLowerCase() === saveName.toLowerCase(),
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
    if (selectedPreset === profile.name) return;
    if (
      dirty &&
      !(await confirmDialog({
        title: "Discard changes?",
        message: "Loading this profile will replace the current unsaved changes.",
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
      setStatus("Error: Only .txt AutoEQ files are supported.");
      return;
    }

    try {
      if (file.size > 1_048_576) throw new Error("File exceeds the 1 MiB limit");
      const text = await file.text();
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
        setStatus(`Unable to read clipboard: ${err}`);
        console.error(err);
      }
    }
  };

  const handleCopy = async () => {
    try {
      const text = await invoke<string>("peq_to_autoeq", { peq });
      await writeText(text);
      setStatus("EQ settings copied to clipboard");
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
      setStatus("EQ settings exported successfully");
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

    try {
      if (
        nameExists &&
        !(await confirmDialog({
          title: "Overwrite profile?",
          message: `A profile named "${nameSnapshot.trim()}" already exists. Saving will replace it.`,
          confirmLabel: "Overwrite",
          danger: true,
        }))
      ) {
        return;
      }
      if (!isCurrent()) return;

      if (temporarySnapshot) {
        onImportPEQ(parsedSnapshot.peq, nameSnapshot || "Imported EQ", false);
        setParsed(null);
        setStatus("Applied to the editor without saving");
        return;
      }

      const name = nameSnapshot.trim();
      if (!name) {
        setStatus("Please enter a name for the profile.");
        return;
      }
      if (name === DEFAULT_PROFILE_NAME) {
        setStatus(`"${DEFAULT_PROFILE_NAME}" is reserved. Choose another profile name.`);
        return;
      }

      const mutation = await runProfileMutation(async () => {
        await invoke("save_profile", { name, peq: parsedSnapshot.peq });
        await onReloadProfiles();
      });
      if (!mutation.current || !isCurrent()) return;

      onImportPEQ(parsedSnapshot.peq, name, true);
      setParsed(null);
      setStatus(`Profile '${name}' saved`);
    } catch (err) {
      if (isCurrent()) setStatus(`Failed to save profile: ${err}`);
    } finally {
      if (mountedRef.current && operation === modalContextRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  const handleCancelImport = () => {
    invalidateModalOperation();
    setParsed(null);
  };

  const importNameLower = importName.trim().toLowerCase();
  const nameExists = parsed
    ? !isTemporary && savedProfiles.some((p) => p.name.toLowerCase() === importNameLower)
    : false;
  const activeFilters = parsed ? parsed.peq.filters.filter((f: Filter) => f.enabled) : [];

  return (
    <div className="profiles-view-wrapper">
      <section className="profile-card">
        <div className="profile-card-head">
          <div className="profile-title">
            <strong>Profile Library</strong>
            <span className="profile-count-tag">{savedProfiles.length} saved</span>
          </div>
          <div className="profile-card-tools">
            <button
              type="button"
              className="icon-btn"
              title="Reload profiles"
              aria-label="Reload profiles"
              onClick={onReloadProfiles}
            >
              <Icon>refresh</Icon>
            </button>
            {!hideProfileFolderButton && onOpenProfilesDir && (
              <button
                type="button"
                className="icon-btn"
                title="Open profiles folder"
                aria-label="Open profiles folder"
                onClick={onOpenProfilesDir}
              >
                <Icon>folder</Icon>
              </button>
            )}
          </div>
        </div>

        <div className="profile-search-wrap">
          <Icon className="search-icon">search</Icon>
          <input
            className="profile-search"
            placeholder="Search profiles…"
            aria-label="Search profiles"
            value={profileSearch}
            onChange={(e) => setProfileSearch(e.target.value)}
          />
          {profileSearch.length > 0 && (
            <button
              type="button"
              className="profile-search-clear"
              title="Clear search"
              aria-label="Clear search"
              onClick={() => setProfileSearch("")}
            >
              <Icon>close</Icon>
            </button>
          )}
        </div>

        <div className="preset-list" role="radiogroup" aria-label="Profiles list">
          {filteredProfiles.length === 0 ? (
            <div className="empty-profiles">
              <Icon>search_off</Icon>
              <span>No profiles found</span>
            </div>
          ) : (
            filteredProfiles.map((profile) => {
              const isSelected = selectedPreset === profile.name;
              return (
                <div
                  key={profile.name}
                  className={`profile-row ${isSelected ? "selected" : ""}`}
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={0}
                  onClick={() => handleSelectProfile(profile)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelectProfile(profile);
                    }
                  }}
                >
                  <div className="profile-row-info">
                    <Icon className="profile-row-indicator">
                      {isSelected ? "radio_button_checked" : "radio_button_unchecked"}
                    </Icon>
                    <span className="profile-name-text">{profile.name}</span>
                    {isSelected && <span className="profile-active-badge">Active</span>}
                  </div>

                  {onApplyProfile && (
                    <button
                      type="button"
                      className="profile-apply-btn"
                      title={`Try ${profile.name} on DAC temporarily`}
                      aria-label={`Try ${profile.name} on DAC temporarily`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onApplyProfile(profile);
                      }}
                    >
                      <Icon>send</Icon>
                      <span>Try</span>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {showActions && (
          <div className="profile-actions-area">
            {showSaveAs ? (
              <>
                <div className="profile-save-field">
                  <label htmlFor="profile-save-name">
                    {selectedIsSaved ? "Save as new copy" : "New profile name"}
                  </label>
                  <div className="profile-name-input-wrap">
                    <input
                      id="profile-save-name"
                      className="profile-search"
                      placeholder="Profile name…"
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                    />
                    {!!saveName && (
                      <span className={`profile-name-badge ${isOverwrite ? "overwrite" : "new"}`}>
                        {isOverwrite ? "Overwrite" : "New"}
                      </span>
                    )}
                  </div>
                </div>

                <div className="profile-management-actions">
                  <button
                    type="button"
                    className="save primary-save"
                    onClick={onSave}
                    title={saveLabel}
                    disabled={!canSave}
                  >
                    <Icon>save</Icon>
                    <span>{saveLabel}</span>
                  </button>
                  {saveAsOpen && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setNewProfileName("");
                        setSaveAsOpen(false);
                      }}
                    >
                      <span>Cancel</span>
                    </button>
                  )}
                  {dirty && (
                    <button
                      type="button"
                      className="profile-icon-action"
                      title="Discard changes"
                      aria-label="Discard changes"
                      onClick={onReset}
                    >
                      <Icon>restart_alt</Icon>
                    </button>
                  )}
                </div>
              </>
            ) : selectedIsSaved ? (
              <>
                <div className="profile-management-actions">
                  {dirty && (
                    <button
                      type="button"
                      className="save primary-save"
                      onClick={onSave}
                      title="Save changes"
                    >
                      <Icon>save</Icon>
                      <span>Save changes</span>
                    </button>
                  )}
                  {dirty && (
                    <button
                      type="button"
                      className="profile-icon-action"
                      title="Discard changes"
                      aria-label="Discard changes"
                      onClick={onReset}
                    >
                      <Icon>restart_alt</Icon>
                    </button>
                  )}
                  <button
                    type="button"
                    className="profile-icon-action danger"
                    title="Delete profile"
                    aria-label="Delete profile"
                    onClick={onDelete}
                  >
                    <Icon>delete</Icon>
                  </button>
                  <button
                    type="button"
                    className="profile-save-as-toggle"
                    title="Save current profile as a new copy"
                    onClick={() => {
                      setNewProfileName("");
                      setSaveAsOpen(true);
                    }}
                  >
                    <Icon>content_copy</Icon>
                    <span>Save as copy…</span>
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className="profile-save-as-toggle"
                title="Save current EQ as a new profile"
                onClick={() => {
                  setNewProfileName("");
                  setSaveAsOpen(true);
                }}
              >
                <Icon>add</Icon>
                <span>Save current EQ as new profile…</span>
              </button>
            )}
          </div>
        )}

        <div className="profile-card-foot">
          <small className="modified">
            {selectedProfile?.modified != null
              ? `Modified: ${new Date(selectedProfile.modified * 1000).toLocaleDateString()}`
              : "Glacier data folder"}
          </small>
        </div>
      </section>

      <section className="profile-action-group import-section">
        <div className="profile-action-head">
          <strong>Import / Export</strong>
        </div>
        <input
          className="hidden-file-input"
          type="file"
          ref={fileInputRef}
          accept=".txt"
          onChange={handleFileChange}
        />
        <div className="transfer-actions">
          <button type="button" className="icon-action" onClick={handleImportFileClick}>
            <Icon>file_upload</Icon>
            <span>Import File</span>
          </button>
          <button type="button" className="icon-action" onClick={handlePaste}>
            <Icon>content_paste</Icon>
            <span>Paste</span>
          </button>
          <button type="button" className="icon-action" onClick={handleExportFile}>
            <Icon>file_download</Icon>
            <span>Export File</span>
          </button>
          <button type="button" className="icon-action" onClick={handleCopy}>
            <Icon>content_copy</Icon>
            <span>Copy</span>
          </button>
        </div>
      </section>

      {parsed && (
        <Modal title="Import Profile" onClose={handleCancelImport}>
          <div className="modal-body">
            <div className="import-mode-tabs" role="group" aria-label="Import destination mode">
              <button
                type="button"
                className={!isTemporary ? "active" : ""}
                aria-pressed={!isTemporary}
                onClick={() => {
                  invalidateModalOperation();
                  setIsTemporary(false);
                }}
              >
                Save to Profile
              </button>
              <button
                type="button"
                className={isTemporary ? "active" : ""}
                aria-pressed={isTemporary}
                onClick={() => {
                  invalidateModalOperation();
                  setIsTemporary(true);
                }}
              >
                Try temporarily
              </button>
            </div>

            <div className="import-flow-content">
              {!isTemporary ? (
                <div className="import-field-group">
                  <label htmlFor="import-name">Profile Name</label>
                  <input
                    id="import-name"
                    type="text"
                    value={importName}
                    onChange={(e) => {
                      invalidateModalOperation();
                      setImportName(e.target.value);
                    }}
                    placeholder="Profile Name…"
                  />
                  {savedProfiles.length > 0 && (
                    <div className="import-field-group" style={{ marginTop: "8px" }}>
                      <label htmlFor="overwrite-select">Or overwrite an existing profile:</label>
                      <Select
                        id="overwrite-select"
                        value={profiles.some((p) => p.name === importName) ? importName : ""}
                        onChange={(val) => {
                          if (val) {
                            invalidateModalOperation();
                            setImportName(val);
                          }
                        }}
                        options={[
                          { value: "", label: "-- Select profile --" },
                          ...savedProfiles.map((p) => ({ value: p.name, label: p.name })),
                        ]}
                      />
                    </div>
                  )}
                  {nameExists && (
                    <span className="import-overwrite-warning">
                      A profile with this name already exists. Saving will replace it.
                    </span>
                  )}
                </div>
              ) : (
                <p className="import-temp-note">
                  This will apply the imported filters to your current session without saving a permanent profile.
                </p>
              )}

              {activeFilters.length > 0 && (
                <div className="import-preview-section">
                  <span>Filters Preview:</span>
                  <div className="import-preview-box">
                    {activeFilters.map((f: Filter, idx: number) => (
                      <div key={idx} className="preview-line">
                        Band {f.index + 1}: {f.filter_type} fc {f.freq}Hz, gain {f.gain.toFixed(1)}dB, Q {f.q.toFixed(2)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {parsed.warnings.length > 0 && (
                <div className="import-warnings-section">
                  <span>Compatibility Adjustments:</span>
                  <div className="import-warnings-box">
                    {parsed.warnings.map((w: string, idx: number) => (
                      <div key={idx} className="warning-line">
                        • {w}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn filled"
                disabled={isSubmitting || (!isTemporary && !importName.trim())}
                onClick={handleConfirmImport}
              >
                <Icon>check</Icon>
                <span>{isTemporary ? "Apply to Editor" : "Save Profile"}</span>
              </button>
              <button
                type="button"
                className="btn"
                disabled={isSubmitting}
                onClick={handleCancelImport}
              >
                <span>Cancel</span>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
});
