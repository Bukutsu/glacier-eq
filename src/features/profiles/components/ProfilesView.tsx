import { useTranslation } from "react-i18next";
// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import type { StatusReporter } from "@/stores/toastStore";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { invoke, readText } from "@/lib/rpc";
import { copyEq, exportEqFile } from "@/features/eq/lib/exportEq";
import { Tooltip } from "@/components/ui/Tooltip";
import { profileIdentityKey } from "@/features/profiles/lib/profileIdentity";
import { loadProfile } from "@/features/profiles/lib/loadProfile";
import { readTextFile } from "@/lib/textFile";
import { fuzzyMatch } from "@/lib/search";
import { isTauri } from "@/lib/platform";
import {
  DEFAULT_PROFILE_NAME,
  formatDb,
  normalizePeq,
} from "@/features/eq/lib/peq";
import {
  parseAutoEqResult,
  type ParsedAutoEqResult,
} from "@/features/tuning/lib/parsedAutoEq";
import { asyncContextEquals, type AsyncContext } from "@/lib/asyncContext";
import type { Filter, PEQData, Profile } from "@/types";
import type { ProfileMutationRunner } from "@/features/profiles/hooks/useProfiles";

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
  onUseOnDac?: (profile: Profile) => Promise<void>;
  isBusy?: boolean;
  onReloadProfiles: () => void | Promise<Profile[]>;
  onOpenProfilesDir?: () => void;
  /** Profiles are files that can change outside the app (desktop, Android). */
  profilesOnDisk?: boolean;
  onReset: () => void;
  onSave: () => void;
  onDelete: (name: string) => void | Promise<void>;
  onRename: (from: string, to: string) => Promise<boolean>;
  setStatus: StatusReporter;
  onImportPEQ: (data: PEQData, name: string, isSaved: boolean) => boolean;
  getAsyncContext: () => AsyncContext;
  runProfileMutation: ProfileMutationRunner;
  dirty?: boolean;
  showActions?: boolean;
  isMobile?: boolean;
  preview?: ReactNode;
  dacBanks?: ReactNode;
  dacEditor?: {
    status: string;
    unsaved: boolean;
    slot?: number | null;
    bankNumber?: number;
  };
  onSaveEditorToDacBank?: (slot: number) => Promise<boolean>;
  liveApply?: boolean;
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
  onUseOnDac,
  isBusy = false,
  onReloadProfiles,
  onOpenProfilesDir,
  profilesOnDisk = false,
  onReset,
  onSave,
  onDelete,
  onRename,
  setStatus,
  onImportPEQ,
  getAsyncContext,
  runProfileMutation,
  dirty = false,
  showActions = true,
  preview,
  dacBanks,
  dacEditor,
  onSaveEditorToDacBank,
  liveApply = false,
  onReviewEq,
}: ProfilesViewProps) {
  const { t } = useTranslation("library");
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [parsed, setParsed] = useState<ParsedAutoEqResult | null>(null);
  const [importName, setImportName] = useState("");
  const [isTemporary, setIsTemporary] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [manualPaste, setManualPaste] = useState<string | null>(null);
  const [rename, setRename] = useState<{ from: string; name: string } | null>(
    null,
  );
  const [isRenaming, setIsRenaming] = useState(false);
  const [isParsingPaste, setIsParsingPaste] = useState(false);

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
  const savedProfiles = profiles.filter((p) => p.modified != null);
  const selectedIsSaved = savedProfiles.some(
    (profile) => profileIdentityKey(profile.name) === selectedPresetKey,
  );

  const showSaveAs = (!selectedIsSaved && dirty) || saveAsOpen;
  const saveName = newProfileName.trim();
  const isOverwrite = savedProfiles.some(
    (p) => profileIdentityKey(p.name) === profileIdentityKey(saveName),
  );
  const canSave = showSaveAs ? !!saveName : selectedIsSaved && dirty;
  const renameTarget = rename?.name.trim() ?? "";
  const renameTaken =
    rename !== null &&
    savedProfiles.some(
      (profile) =>
        profileIdentityKey(profile.name) === profileIdentityKey(renameTarget) &&
        profileIdentityKey(profile.name) !== profileIdentityKey(rename.from),
    );
  const canRename =
    !!renameTarget &&
    renameTarget !== rename?.from &&
    profileIdentityKey(renameTarget) !==
      profileIdentityKey(DEFAULT_PROFILE_NAME) &&
    !renameTaken &&
    !isRenaming;
  const saveLabel = showSaveAs
    ? isOverwrite
      ? t("profilesView.overwriteProfile")
      : t("profilesView.saveProfile")
    : dirty
      ? t("profilesView.saveChanges")
      : t("profilesView.profileSaved");

  const handleSelectProfile = (profile: Profile) =>
    loadProfile({
      profile,
      selectedPreset,
      dirty: dirty || Boolean(dacEditor?.unsaved),
      getAsyncContext,
      confirm: confirmDialog,
      onSelectProfile,
    });

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
      setStatus(t("profilesView.unsupportedFileType"), "info");
      return;
    }

    try {
      const { text } = await readTextFile(file);
      await parseAndLoadText(text, file.name.replace(/\.[^/.]+$/, ""), request);
    } catch (error) {
      if (request === parseRequestRef.current) {
        setStatus(t("profilesView.failedToImport", { error: error }));
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
      setManualPaste(null);
      setParsed(result);
      const initialName =
        result.headphone_name ||
        defaultNameFallback ||
        t("profilesView.importedProfile");
      setImportName(initialName);
      setIsTemporary(false);
      setStatus(t("profilesView.parsedAutoEQProfile"));
    } catch (error) {
      if (request === parseRequestRef.current) {
        setStatus(t("profilesView.failedToImport", { error: error }));
      }
    }
  };

  const handlePaste = async () => {
    const request = ++parseRequestRef.current;
    try {
      const text = await readText();
      if (!text.trim()) throw new Error(t("profilesView.clipboardIsEmpty"));
      await parseAndLoadText(
        text,
        t("profilesView.pasted", {
          date: new Date().toLocaleDateString(),
        }),
        request,
      );
    } catch (err) {
      if (request === parseRequestRef.current) {
        if (!isTauri()) {
          setManualPaste("");
        } else {
          setStatus(t("profilesView.couldNotReadClipboard", { error: err }));
          console.error(err);
        }
      }
    }
  };

  const handleCopy = () => copyEq(peq, setStatus);
  const handleExportFile = () =>
    exportEqFile(peq, importName || selectedPreset, setStatus);

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
          title: t("profilesView.overwriteTitle"),
          message: t("profilesView.overwriteMessage", {
            name: nameSnapshot.trim(),
          }),
          confirmLabel: t("profilesView.overwrite"),
          danger: true,
        }))
      ) {
        return;
      }
      if (!isCurrent()) return;

      if (temporarySnapshot) {
        const applied = onImportPEQ(
          parsedSnapshot.peq,
          nameSnapshot || t("profilesView.importedEQ"),
          false,
        );
        if (!applied) {
          setStatus(t("profilesView.importEditorBusy"), "info");
          return;
        }
        setParsed(null);
        setStatus(t("profilesView.appliedToEditorWithoutSaving"));
        return;
      }

      const name = nameSnapshot.trim();
      if (!name) {
        setStatus(t("profilesView.enterANameForTheProfile"), "info");
        return;
      }
      if (name === DEFAULT_PROFILE_NAME) {
        setStatus(
          t("profilesView.reservedName", {
            name: DEFAULT_PROFILE_NAME,
          }),
          "info",
        );
        return;
      }

      let canonicalName =
        profiles.find(
          (profile) =>
            profileIdentityKey(profile.name) === profileIdentityKey(name),
        )?.name ?? name;
      const mutation = await runProfileMutation(async () => {
        await invoke("save_profile", { name, peq: parsedSnapshot.peq });
        writeCompleted = true;
        const loadedProfiles = await onReloadProfiles();
        canonicalName =
          loadedProfiles?.find(
            (profile) =>
              profileIdentityKey(profile.name) === profileIdentityKey(name),
          )?.name ?? canonicalName;
      });
      if (!mutation.current || !isCurrent()) return;

      const applied = onImportPEQ(parsedSnapshot.peq, canonicalName, true);
      if (!applied) {
        setStatus(t("profilesView.savedEditorBusy"), "info");
        return;
      }
      setParsed(null);
      setStatus(t("profilesView.profileSavedNamed", { name: canonicalName }));
    } catch (err) {
      if (isCurrent()) {
        setStatus(
          writeCompleted
            ? t("profilesView.savedRefreshFailed", {
                error: err,
              })
            : t("profilesView.failedToSaveProfile", { error: err }),
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
    ? !isTemporary &&
      savedProfiles.some((p) => profileIdentityKey(p.name) === importNameKey)
    : false;
  const activeFilters = parsed
    ? parsed.peq.filters.filter((f: Filter) => f.enabled)
    : [];
  const handleReloadProfiles = () => {
    void Promise.resolve(onReloadProfiles()).catch((error) => {
      setStatus(t("profilesView.failedToRefreshProfiles", { error: error }));
    });
  };

  const beginSaveAs = () => {
    setNewProfileName("");
    setSaveAsOpen(true);
  };
  const isBuiltIn =
    selectedPresetKey === profileIdentityKey(DEFAULT_PROFILE_NAME);
  const editorState =
    dacEditor?.status ??
    (dirty
      ? selectedIsSaved
        ? t("profilesView.unsavedChanges")
        : t("profilesView.notSaved")
      : selectedIsSaved
        ? t("profilesView.saved")
        : isBuiltIn
          ? t("profilesView.builtIn")
          : t("profilesView.notSaved"));
  const enabledBands = peq.filters.filter((filter) => filter.enabled).length;

  return (
    <div className="profiles-workspace">
      <section className="profiles-library" aria-labelledby="profiles-title">
        <header className="profiles-header">
          <div className="profiles-heading">
            <h2 id="profiles-title">{t("profilesView.library")}</h2>
            <span className="profiles-note">
              {t("profilesView.savedCount", { count: savedProfiles.length })}
            </span>
          </div>
          <div className="profiles-header-actions">
            <Button variant="ghost" onClick={handlePaste}>
              <Icon name="content_paste" /> {t("profilesView.paste")}
            </Button>
            <Button onClick={handleImportFileClick}>
              <Icon name="file_upload" /> {t("profilesView.import")}
            </Button>
          </div>
        </header>

        <div className="profiles-search">
          <Icon name="search" />
          <Input
            type="search"
            className="pl-9 pr-11"
            aria-label={t("profilesView.searchProfiles")}
            placeholder={t("profilesView.searchPlaceholder")}
            value={profileSearch}
            onChange={(event) => setProfileSearch(event.target.value)}
          />
          {profileSearch.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="profiles-search-clear"
              aria-label={t("profilesView.clearSearch")}
              onClick={() => setProfileSearch("")}
            >
              <Icon name="close" />
            </Button>
          )}
        </div>

        {dacBanks}
        {dacBanks && (
          <h3 className="profiles-local-heading">
            {t("profilesView.localProfiles")}
          </h3>
        )}
        {query && filteredProfiles.length === 0 && (
          <div className="profiles-empty" role="status">
            <h3>{t("profilesView.noMatchingProfiles")}</h3>
            <p>{t("profilesView.noMatchesHint")}</p>
            <Button variant="ghost" onClick={() => setProfileSearch("")}>
              {t("profilesView.clearSearch")}
            </Button>
          </div>
        )}
        <ul
          className="profiles-list"
          aria-label={t("profilesView.profilesList")}
        >
          {filteredProfiles.map((profile) => {
            const isSelected =
              profileIdentityKey(profile.name) === selectedPresetKey;
            const isDefault =
              profileIdentityKey(profile.name) ===
              profileIdentityKey(DEFAULT_PROFILE_NAME);
            const bands = profile.data.filters.filter(
              (filter) => filter.enabled,
            ).length;
            const meta = isDefault
              ? t("profilesView.flatReadOnly")
              : [
                  t("profilesView.bandCount", { count: bands }),
                  t("profilesView.preamp", {
                    // The desktop DTO names this globalGain; normalizePeq reads both.
                    gain: formatDb(normalizePeq(profile.data).global_gain),
                  }),
                  profile.modified != null &&
                    new Date(profile.modified * 1000).toLocaleDateString(),
                ]
                  .filter(Boolean)
                  .join(" · ");
            const loadLabel =
              isSelected && dirty
                ? t("profilesView.revertToSaved", { name: profile.name })
                : t("profilesView.loadIntoEditor", { name: profile.name });

            return (
              <li
                key={profile.name}
                className={`profiles-item${isSelected ? " is-current" : ""}`}
              >
                <button
                  type="button"
                  data-slot="profile-load"
                  className="profiles-load"
                  aria-pressed={isSelected}
                  aria-label={loadLabel}
                  title={
                    isSelected && dirty
                      ? t("profilesView.revertTooltip")
                      : undefined
                  }
                  onClick={() => void handleSelectProfile(profile)}
                >
                  <span className="profiles-item-name" title={profile.name}>
                    {isDefault && <Icon name="lock" size={14} />}
                    {profile.name}
                  </span>
                  <span className="profiles-item-meta">{meta}</span>
                </button>
                {isSelected && (
                  <span className="profiles-badge" data-modified={dirty}>
                    {dirty
                      ? t("profilesView.edited")
                      : t("profilesView.inEditor")}
                  </span>
                )}
                <div className="profiles-row-actions">
                  {onUseOnDac && !isDefault && (
                    <Tooltip
                      label={
                        dacEditor?.slot != null
                          ? t("profilesView.writeToUser", {
                              number:
                                dacEditor.bankNumber ?? dacEditor.slot - 159,
                            })
                          : t("profilesView.saveToDac")
                      }
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={isBusy}
                        aria-label={
                          dacEditor?.slot != null
                            ? t("profilesView.saveProfileToUser", {
                                name: profile.name,
                                number:
                                  dacEditor.bankNumber ?? dacEditor.slot - 159,
                              })
                            : t("profilesView.saveProfileToDac", {
                                name: profile.name,
                              })
                        }
                        onClick={() => void onUseOnDac(profile)}
                      >
                        <Icon name="save" />
                      </Button>
                    </Tooltip>
                  )}
                  {onApplyProfile && !isDefault && (
                    <Tooltip label={t("profilesView.applyToDACUntilRestart")}>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("profilesView.applyToDACTemporarily", {
                          name: profile.name,
                        })}
                        onClick={() => onApplyProfile(profile)}
                      >
                        <Icon name="send" />
                      </Button>
                    </Tooltip>
                  )}
                  {showActions && !isDefault && (
                    <>
                      <Tooltip label={t("profilesView.rename")}>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("profilesView.renameLabel", {
                            name: profile.name,
                          })}
                          onClick={() =>
                            setRename({
                              from: profile.name,
                              name: profile.name,
                            })
                          }
                        >
                          <Icon name="edit" />
                        </Button>
                      </Tooltip>
                      <Tooltip label={t("profilesView.delete")}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="profiles-delete"
                          aria-label={t("profilesView.deleteLabel", {
                            name: profile.name,
                          })}
                          onClick={() => void onDelete(profile.name)}
                        >
                          <Icon name="delete" />
                        </Button>
                      </Tooltip>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {/* The built-in profile is always listed, so the hint follows it. */}
        {!query && savedProfiles.length === 0 && (
          <p className="profiles-note profiles-empty-hint">
            {t("profilesView.emptyLibraryHint")}
          </p>
        )}
        <footer className="profiles-library-footer">
          <p className="profiles-note">
            {dacBanks
              ? t("profilesView.loadHelpMelody")
              : liveApply
                ? t("profilesView.liveLoadHelp")
                : t("profilesView.loadHelp")}
          </p>
          {profilesOnDisk && (
            <div className="profiles-footer-actions">
              <Button variant="ghost" onClick={handleReloadProfiles}>
                <Icon name="refresh" /> {t("profilesView.refresh")}
              </Button>
              {onOpenProfilesDir && (
                <Button variant="ghost" onClick={onOpenProfilesDir}>
                  <Icon name="folder" /> {t("profilesView.openFolder")}
                </Button>
              )}
            </div>
          )}
        </footer>
      </section>

      <section
        className="profiles-editor"
        aria-labelledby="profiles-editor-title"
      >
        <header className="profiles-editor-header">
          <h2 id="profiles-editor-title" className="profiles-eyebrow">
            {t("profilesView.inTheEditor")}
          </h2>
          <Badge
            className="data-[modified=true]:border-[color-mix(in_srgb,var(--warning-foreground)_40%,transparent)] data-[modified=true]:text-[var(--warning-foreground)]"
            data-modified={
              dacEditor
                ? dacEditor.unsaved
                : dirty || (!selectedIsSaved && !isBuiltIn)
            }
          >
            {editorState}
          </Badge>
        </header>
        <h3 className="profiles-editor-name" title={selectedPreset}>
          {selectedPreset}
        </h3>
        <p className="profiles-note">
          {t("profilesView.bandSummary", {
            count: enabledBands,
            preamp: formatDb(peq.global_gain),
          })}
        </p>

        {showActions &&
          dacEditor?.slot != null &&
          dacEditor.unsaved &&
          onSaveEditorToDacBank && (
            <div className="profiles-editor-actions profiles-dac-save">
              <Button
                variant="primary"
                disabled={isBusy}
                onClick={() =>
                  void onSaveEditorToDacBank(dacEditor.slot as number)
                }
              >
                <Icon name="save" />
                {t("profilesView.writeToUser", {
                  number: dacEditor.bankNumber ?? dacEditor.slot - 159,
                })}
              </Button>
            </div>
          )}

        {showActions &&
          (showSaveAs ? (
            <form
              className="profile-save-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSave) onSave();
              }}
            >
              <label htmlFor="profile-save-name">
                {t("profilesView.profileName")}
              </label>
              <Input
                id="profile-save-name"
                ref={saveNameRef}
                name="profile-name"
                autoComplete="off"
                placeholder={t("profilesView.namePlaceholder")}
                value={newProfileName}
                aria-describedby={
                  isOverwrite ? "profile-overwrite-hint" : undefined
                }
                onChange={(event) => setNewProfileName(event.target.value)}
              />
              {isOverwrite && (
                <p
                  id="profile-overwrite-hint"
                  className="profiles-note profiles-warning"
                >
                  {t("profilesView.overwriteWarning")}
                </p>
              )}
              <div className="profiles-editor-actions">
                <Button
                  type="submit"
                  variant={dacEditor?.unsaved ? "default" : "primary"}
                  disabled={!canSave}
                >
                  {saveLabel}
                </Button>
                {saveAsOpen && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setNewProfileName("");
                      setSaveAsOpen(false);
                    }}
                  >
                    {t("profilesView.cancel")}
                  </Button>
                )}
                {!saveAsOpen && dirty && (
                  <Button variant="ghost" onClick={onReset}>
                    {t("profilesView.discardChanges")}
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <div className="profiles-editor-actions">
              {selectedIsSaved && (
                <Button
                  variant={dacEditor?.unsaved ? "default" : "primary"}
                  onClick={onSave}
                  disabled={!canSave}
                >
                  {dirty
                    ? t("profilesView.saveChanges")
                    : t("profilesView.profileSaved")}
                </Button>
              )}
              <Button
                variant={selectedIsSaved ? "default" : "primary"}
                onClick={beginSaveAs}
              >
                {selectedIsSaved
                  ? t("profilesView.saveAsCopy")
                  : t("profilesView.saveAsNewProfile")}
              </Button>
              {dirty && (
                <Button variant="ghost" onClick={onReset}>
                  {t("profilesView.discardChanges")}
                </Button>
              )}
            </div>
          ))}
        {preview && (
          <div
            className="profiles-preview"
            aria-label={t("profilesView.currentEQPreview")}
          >
            {preview}
          </div>
        )}
        <div className="profiles-editor-tools">
          {onReviewEq && (
            <Button variant="ghost" onClick={onReviewEq}>
              <Icon name="tune" /> {t("profilesView.editEQ")}
            </Button>
          )}
          <Button variant="ghost" onClick={handleExportFile}>
            <Icon name="ios_share" /> {t("profilesView.export")}
          </Button>
          <Button variant="ghost" onClick={handleCopy}>
            <Icon name="content_copy" /> {t("profilesView.copy")}
          </Button>
        </div>
      </section>

      <input
        className="hidden-file-input"
        type="file"
        aria-label={t("profilesView.import")}
        ref={fileInputRef}
        accept=".txt"
        onChange={handleFileChange}
      />

      {manualPaste !== null && (
        <Modal
          title={t("profilesView.pasteEQ")}
          className="profiles-import-dialog"
          closeDisabled={isParsingPaste}
          onClose={() => {
            parseRequestRef.current += 1;
            setManualPaste(null);
          }}
        >
          <form
            className="modal-body"
            onSubmit={async (event) => {
              event.preventDefault();
              if (isParsingPaste || !manualPaste.trim()) return;
              const request = ++parseRequestRef.current;
              setIsParsingPaste(true);
              try {
                await parseAndLoadText(
                  manualPaste,
                  t("profilesView.pastedEQ"),
                  request,
                );
              } finally {
                if (mountedRef.current) setIsParsingPaste(false);
              }
            }}
          >
            <p className="profiles-note">{t("profilesView.pasteHelp")}</p>
            <label htmlFor="manual-eq-text">{t("profilesView.eqText")}</label>
            <textarea
              id="manual-eq-text"
              className="profiles-paste-text"
              data-dialog-autofocus
              rows={8}
              maxLength={1_048_576}
              spellCheck={false}
              value={manualPaste}
              disabled={isParsingPaste}
              onChange={(event) => setManualPaste(event.target.value)}
            />
            <div className="modal-actions">
              <Button
                variant="ghost"
                disabled={isParsingPaste}
                onClick={() => {
                  parseRequestRef.current += 1;
                  setManualPaste(null);
                }}
              >
                {t("profilesView.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={isParsingPaste || !manualPaste.trim()}
              >
                {isParsingPaste
                  ? t("profilesView.parsing")
                  : t("profilesView.previewImport")}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {parsed && (
        <Modal
          title={t("profilesView.importProfile")}
          className="profiles-import-dialog"
          onClose={handleCancelImport}
          closeDisabled={isSubmitting}
        >
          <div className="modal-body">
            <div
              className="profiles-import-modes"
              role="group"
              aria-label={t("profilesView.importDestinationMode")}
            >
              <Button
                variant={!isTemporary ? "default" : "ghost"}
                aria-pressed={!isTemporary}
                disabled={isSubmitting}
                onClick={() => {
                  if (isSubmitting) return;
                  invalidateModalOperation();
                  setIsTemporary(false);
                }}
              >
                {t("profilesView.saveProfile")}
              </Button>
              <Button
                variant={isTemporary ? "default" : "ghost"}
                aria-pressed={isTemporary}
                disabled={isSubmitting}
                onClick={() => {
                  if (isSubmitting) return;
                  invalidateModalOperation();
                  setIsTemporary(true);
                }}
              >
                {t("profilesView.editorOnly")}
              </Button>
            </div>
            {!isTemporary ? (
              <div className="profiles-import-fields">
                <label htmlFor="import-name">
                  {t("profilesView.profileName")}
                </label>
                <Input
                  id="import-name"
                  value={importName}
                  disabled={isSubmitting}
                  placeholder={t("profilesView.namePlaceholder")}
                  onChange={(event) => {
                    if (isSubmitting) return;
                    invalidateModalOperation();
                    setImportName(event.target.value);
                  }}
                />
                {savedProfiles.length > 0 && (
                  <>
                    <label htmlFor="overwrite-select">
                      {t("profilesView.overwriteAnExistingProfile")}
                    </label>
                    <Select
                      id="overwrite-select"
                      value={
                        profiles.some((p) => p.name === importName)
                          ? importName
                          : ""
                      }
                      disabled={isSubmitting}
                      onChange={(value) => {
                        if (isSubmitting) return;
                        if (value) {
                          invalidateModalOperation();
                          setImportName(value);
                        }
                      }}
                      options={[
                        { value: "", label: t("profilesView.selectProfile") },
                        ...savedProfiles.map((profile) => ({
                          value: profile.name,
                          label: profile.name,
                        })),
                      ]}
                    />
                  </>
                )}
                {nameExists && (
                  <p className="profiles-note profiles-warning">
                    {t("profilesView.overwriteWarning")}
                  </p>
                )}
              </div>
            ) : (
              <p className="profiles-note">
                {t("profilesView.temporaryImportHelp")}
              </p>
            )}

            {activeFilters.length > 0 && (
              <section
                className="profiles-import-preview"
                aria-label={t("profilesView.filterPreview")}
              >
                <h3>{t("profilesView.filterPreview")}</h3>
                <div className="profiles-import-filter-list">
                  {activeFilters.map((filter, index) => (
                    <p key={index}>
                      {t("profilesView.filterSummary", {
                        band: filter.index + 1,
                        type: filter.filter_type,
                        frequency: filter.freq,
                        gain: filter.gain.toFixed(1),
                        q: filter.q.toFixed(2),
                      })}
                    </p>
                  ))}
                </div>
              </section>
            )}
            {parsed.warnings.length > 0 && (
              <section
                className="profiles-import-warnings"
                aria-label={t("profilesView.importWarnings")}
              >
                <h3>{t("profilesView.importWarnings")}</h3>
                <ul>
                  {parsed.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </section>
            )}
            <div className="modal-actions">
              <Button
                variant="primary"
                disabled={isSubmitting || (!isTemporary && !importName.trim())}
                onClick={handleConfirmImport}
              >
                {isTemporary
                  ? t("profilesView.applyToEditor")
                  : t("profilesView.saveProfile")}
              </Button>
              <Button
                variant="ghost"
                disabled={isSubmitting}
                onClick={handleCancelImport}
              >
                {t("profilesView.cancel")}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {rename !== null && (
        <Modal
          title={t("profilesView.renameProfile")}
          className="profiles-import-dialog"
          closeDisabled={isRenaming}
          onClose={() => setRename(null)}
        >
          <form
            className="modal-body"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!canRename) return;
              setIsRenaming(true);
              try {
                if (
                  (await onRename(rename.from, renameTarget)) &&
                  mountedRef.current
                )
                  setRename(null);
              } finally {
                if (mountedRef.current) setIsRenaming(false);
              }
            }}
          >
            <label htmlFor="profile-rename-name">
              {t("profilesView.profileName")}
            </label>
            <Input
              id="profile-rename-name"
              name="profile-rename"
              autoComplete="off"
              data-dialog-autofocus
              value={rename.name}
              disabled={isRenaming}
              aria-describedby={
                renameTaken ? "profile-rename-taken" : undefined
              }
              onChange={(event) =>
                setRename({ from: rename.from, name: event.target.value })
              }
            />
            {renameTaken && (
              <p
                id="profile-rename-taken"
                className="profiles-note profiles-warning"
              >
                {t("profilesView.nameTaken")}
              </p>
            )}
            <div className="modal-actions">
              <Button
                variant="ghost"
                disabled={isRenaming}
                onClick={() => setRename(null)}
              >
                {t("profilesView.cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={!canRename}>
                {isRenaming
                  ? t("profilesView.renaming")
                  : t("profilesView.rename")}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
});
