import { useTranslation } from "react-i18next";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Collapsible } from "@/components/ui/Collapsible";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { OverflowMenu } from "@/components/ui/OverflowMenu";
import { copyEq, exportEqFile } from "@/features/eq/lib/exportEq";
import { readTextFile } from "@/lib/textFile";
import { FileImportButton } from "@/components/ui/FileImportButton";
import {
  DEFAULT_PROFILE_NAME,
  formatDb,
  normalizePeq,
} from "@/features/eq/lib/peq";
import { asyncContextEquals, type AsyncContext } from "@/lib/asyncContext";
import { invoke, openFileDialog } from "@/lib/rpc";
import type { PEQData, Profile } from "@/types";
import { loadProfile } from "../lib/loadProfile";
import {
  isReservedProfileName,
  profileIdentityKey,
} from "../lib/profileIdentity";
import { parseProfileImport } from "../lib/profileImport";

export interface MobileProfilesViewProps {
  peq: PEQData;
  profiles: Profile[];
  selectedPreset: string;
  dirty?: boolean;
  isBusy?: boolean;
  profileSearch: string;
  setProfileSearch: (value: string) => void;
  newProfileName: string;
  setNewProfileName: (value: string) => void;
  onSelectProfile: (profile: Profile) => void;
  onApplyProfile?: (profile: Profile) => void;
  /** Loads the profile and saves it to the connected DAC. */
  onUseOnDac?: (profile: Profile) => Promise<void>;
  onImportPEQ: (data: PEQData, name: string, isSaved: boolean) => boolean;
  onSave: () => void | Promise<void>;
  onDelete: (name: string) => void | Promise<void>;
  onRename: (from: string, to: string) => Promise<boolean>;
  onReloadProfiles: () => void;
  onOpenProfilesDir?: () => void;
  getAsyncContext: () => AsyncContext;
  setStatus: (message: string) => void;
  onReviewEq?: () => void;
  preview?: ReactNode;
  dacBanks?: ReactNode;
  dacEditor?: {
    status: string;
    unsaved: boolean;
    slot?: number | null;
    bankNumber?: number;
  };
  onSaveEditorToDacBank?: (slot: number) => Promise<boolean>;
}

export function MobileProfilesView(props: MobileProfilesViewProps) {
  const { t } = useTranslation("library");
  const {
    peq,
    profiles,
    selectedPreset,
    dirty = false,
    isBusy = false,
    profileSearch,
    setProfileSearch,
    newProfileName,
    setNewProfileName,
    onSelectProfile,
    onApplyProfile,
    onUseOnDac,
    onImportPEQ,
    onSave,
    onDelete,
    onRename,
    onReloadProfiles,
    onOpenProfilesDir,
    getAsyncContext,
    setStatus,
    onReviewEq,
    preview,
    dacBanks,
    dacEditor,
    onSaveEditorToDacBank,
  } = props;
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<{
    mode: "save" | "rename";
    context: AsyncContext;
    profile: string;
  } | null>(null);
  const [rename, setRename] = useState("");
  const [paste, setPaste] = useState<string | null>(null);
  const rowId = useId();
  const mounted = useRef(true);
  const actionPending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const identity = profileIdentityKey(selectedPreset);
  const selected = profiles.find(
    (profile) => profileIdentityKey(profile.name) === identity,
  );
  const builtIn = identity === profileIdentityKey(DEFAULT_PROFILE_NAME);
  const saved = !!selected && !builtIn;
  const disabled = isBusy || pending;
  const query = profileSearch.trim().toLocaleLowerCase();
  const visible = profiles.filter((profile) =>
    profile.name.toLocaleLowerCase().includes(query),
  );
  const savedCount = profiles.filter(
    (profile) =>
      profileIdentityKey(profile.name) !==
      profileIdentityKey(DEFAULT_PROFILE_NAME),
  ).length;
  const activeBands = peq.filters.filter((filter) => filter.enabled).length;
  const dialogName = (dialog?.mode === "save" ? newProfileName : rename).trim();
  const reservedDialogName = isReservedProfileName(dialogName);

  async function runAction(action: () => void | Promise<unknown>) {
    if (isBusy || actionPending.current) return;
    actionPending.current = true;
    setPending(true);
    try {
      await action();
    } catch (error) {
      if (mounted.current)
        setStatus(t("mobileProfilesView.actionFailed", { error: error }));
    } finally {
      actionPending.current = false;
      if (mounted.current) setPending(false);
    }
  }

  function openNameDialog(mode: "save" | "rename", profile = selectedPreset) {
    if (disabled) return;
    if (mode === "save")
      setNewProfileName(saved && dirty ? selectedPreset : "");
    else setRename(profile);
    setDialog({ mode, context: getAsyncContext(), profile });
  }

  async function importText(
    read: () => Promise<{ name: string; text: string } | null>,
  ) {
    const context = getAsyncContext();
    const current = () =>
      mounted.current && asyncContextEquals(context, getAsyncContext());
    const file = await read();
    if (!file || !current()) return;
    const imported = parseProfileImport(
      await invoke<unknown>("parse_autoeq", { text: file.text }),
      file.name,
    );
    if (!current()) return;
    if (!onImportPEQ(imported.data, imported.name, false)) return false;
    setStatus(
      [t("mobileProfilesView.importSucceeded"), ...imported.warnings].join(" "),
    );
    return true;
  }

  return (
    <div className="mobile-profile-library" aria-busy={disabled}>
      <Card
        className="mobile-profile-editor"
        aria-label={t("mobileProfilesView.currentEditorEQ")}
      >
        <div className="mobile-profile-section-heading">
          <span className="mobile-profile-eyebrow">
            {t("mobileProfilesView.inTheEditor")}
          </span>
          <Badge>
            {dacEditor?.status ??
              (dirty
                ? t("mobileProfilesView.unsavedChanges")
                : builtIn
                  ? t("mobileProfilesView.builtIn")
                  : saved
                    ? t("mobileProfilesView.saved")
                    : t("mobileProfilesView.notSaved"))}
          </Badge>
        </div>
        <h2 className="mobile-profile-editor-name">{selectedPreset}</h2>
        <p className="mobile-profile-description">
          {t("mobileProfilesView.activeBands", {
            count: activeBands,
            preamp: formatDb(peq.global_gain),
          })}
        </p>
        {builtIn && (
          <p className="mobile-profile-description">
            {t("mobileProfilesView.builtInHelp")}
          </p>
        )}
        {dacEditor?.slot != null &&
          dacEditor.unsaved &&
          onSaveEditorToDacBank && (
            <Button
              className="mobile-profile-dac-save"
              variant="primary"
              disabled={disabled}
              onClick={() =>
                void runAction(() =>
                  onSaveEditorToDacBank(dacEditor.slot as number),
                )
              }
            >
              <Icon name="save" />
              {t("profilesView.writeToUser", {
                number: dacEditor.bankNumber ?? dacEditor.slot - 159,
              })}
            </Button>
          )}
        <div className="mobile-profile-editor-actions">
          <Button
            variant={dacEditor?.unsaved ? "default" : "primary"}
            disabled={disabled}
            onClick={() => openNameDialog("save")}
          >
            {saved && dirty
              ? t("mobileProfilesView.saveChanges")
              : t("mobileProfilesView.saveAs")}
          </Button>
          {onReviewEq && (
            <Button disabled={disabled} onClick={onReviewEq}>
              {t("mobileProfilesView.editEQ")}
            </Button>
          )}
          <Button
            aria-label={t("profilesView.copy")}
            disabled={disabled}
            onClick={() => void runAction(() => copyEq(peq, setStatus))}
          >
            <Icon name="content_copy" /> {t("profilesView.copy")}
          </Button>
          <Button
            aria-label={t("mobileProfilesView.exportEQ")}
            disabled={disabled}
            onClick={() =>
              void runAction(() => exportEqFile(peq, selectedPreset, setStatus))
            }
          >
            <Icon name="file_download" /> {t("mobileProfilesView.exportEQ")}
          </Button>
        </div>
        {preview && (
          <Collapsible
            title={t("mobileProfilesView.eqPreview")}
            defaultOpen={false}
            compact
          >
            <div className="mobile-profile-preview">{preview}</div>
          </Collapsible>
        )}
      </Card>

      <section aria-labelledby="mobile-profile-library-title">
        <div className="mobile-profile-library-heading">
          <div>
            <h2 id="mobile-profile-library-title">
              {t("mobileProfilesView.yourLibrary")}
            </h2>
            <p className="mobile-profile-description">
              {t("mobileProfilesView.savedCount", { count: savedCount })}
            </p>
          </div>
          <div className="mobile-profile-library-tools">
            <FileImportButton
              label={t("mobileProfilesView.import")}
              accept=".txt"
              disabled={disabled}
              onImport={(file) =>
                void runAction(() =>
                  importText(() =>
                    file
                      ? readTextFile(file)
                      : openFileDialog({
                          filters: [
                            {
                              name: t("mobileProfilesView.autoEQText"),
                              extensions: ["txt"],
                            },
                          ],
                        }),
                  ),
                )
              }
            />
            <OverflowMenu label={t("mobileProfilesView.libraryActions")}>
              <Menu.Item
                className="ui-menu-item"
                disabled={disabled}
                onClick={() => setPaste("")}
              >
                <Icon name="content_paste" />
                {t("profilesView.pasteEQ")}
              </Menu.Item>
              <Menu.Item
                className="ui-menu-item"
                disabled={disabled}
                onClick={() => void runAction(onReloadProfiles)}
              >
                <Icon name="refresh" />
                {t("mobileProfilesView.refreshProfiles")}
              </Menu.Item>
              {onOpenProfilesDir && (
                <Menu.Item
                  className="ui-menu-item"
                  disabled={disabled}
                  onClick={() => void runAction(onOpenProfilesDir)}
                >
                  <Icon name="folder" />
                  {t("mobileProfilesView.openProfilesFolder")}
                </Menu.Item>
              )}
            </OverflowMenu>
          </div>
        </div>
        <div className="mobile-profile-search">
          <Icon name="search" />
          <Input
            aria-label={t("mobileProfilesView.searchProfiles")}
            className="pl-9 pr-11 text-base"
            placeholder={t("mobileProfilesView.searchPlaceholder")}
            value={profileSearch}
            onChange={(event) => setProfileSearch(event.target.value)}
            type="search"
          />
          {profileSearch && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("mobileProfilesView.clearProfileSearch")}
              onClick={() => setProfileSearch("")}
            >
              <Icon name="close" />
            </Button>
          )}
        </div>

        {dacBanks}
        {dacBanks && (
          <>
            <h3 className="profiles-local-heading">
              {t("mobileProfilesView.localProfiles")}
            </h3>
            <p className="mobile-profile-description">
              {t("mobileProfilesView.localProfilesHelp")}
            </p>
          </>
        )}
        <ul
          className="mobile-profile-list"
          aria-label={t("mobileProfilesView.savedProfiles")}
        >
          {visible.map((profile, index) => {
            // eslint-disable-next-line i18next/no-literal-string -- Local DOM ID, not UI text.
            const nameId = `${rowId}-name-${index}`;
            // eslint-disable-next-line i18next/no-literal-string -- Local DOM ID, not UI text.
            const loadId = `${rowId}-load-${index}`;
            // eslint-disable-next-line i18next/no-literal-string -- Local DOM ID, not UI text.
            const writeId = `${rowId}-write-${index}`;
            const isDefault =
              profileIdentityKey(profile.name) ===
              profileIdentityKey(DEFAULT_PROFILE_NAME);
            const current = profileIdentityKey(profile.name) === identity;
            const data = normalizePeq(profile.data);
            const bands = data.filters.filter(
              (filter) => filter.enabled,
            ).length;
            return (
              <li
                key={profile.name}
                aria-labelledby={nameId}
                className={
                  current
                    ? "mobile-profile-row is-current"
                    : "mobile-profile-row"
                }
              >
                <div className="mobile-profile-row-heading">
                  <h3 id={nameId}>
                    {isDefault && <Icon name="lock" />}
                    {profile.name}
                  </h3>
                  {current && <Badge>{t("mobileProfilesView.inEditor")}</Badge>}
                </div>
                <p className="mobile-profile-description">
                  {isDefault
                    ? t("mobileProfilesView.flatProfileDescription")
                    : t("mobileProfilesView.bandSummary", {
                        count: bands,
                        preamp: formatDb(data.global_gain),
                      })}
                </p>
                <div className="mobile-profile-row-actions">
                  {onUseOnDac && !isDefault && (
                    <Button
                      variant={dacEditor?.unsaved ? "default" : "primary"}
                      aria-labelledby={`${writeId} ${nameId}`}
                      disabled={disabled}
                      onClick={() => void runAction(() => onUseOnDac(profile))}
                    >
                      <Icon name="save" />
                      <span id={writeId}>
                        {dacEditor?.slot != null
                          ? t("profilesView.writeToUser", {
                              number:
                                dacEditor.bankNumber ?? dacEditor.slot - 159,
                            })
                          : t("profilesView.saveToDac")}
                      </span>
                    </Button>
                  )}
                  <Button
                    aria-labelledby={`${loadId} ${nameId}`}
                    disabled={disabled || (current && !dirty)}
                    onClick={() =>
                      void runAction(() =>
                        loadProfile({
                          profile,
                          selectedPreset,
                          dirty: dirty || Boolean(dacEditor?.unsaved),
                          getAsyncContext,
                          onSelectProfile: (next) => {
                            if (mounted.current) onSelectProfile(next);
                          },
                        }),
                      )
                    }
                  >
                    <span id={loadId}>
                      {current && !dirty ? (
                        <>
                          <Icon name="check" />
                          {t("mobileProfilesView.loaded")}
                        </>
                      ) : current ? (
                        <>
                          <Icon name="restart_alt" />
                          {t("mobileProfilesView.restore")}
                        </>
                      ) : (
                        t("mobileProfilesView.loadIntoEditor")
                      )}
                    </span>
                  </Button>
                  <OverflowMenu
                    label={t("mobileProfilesView.actionsFor", {
                      name: profile.name,
                    })}
                  >
                    <Menu.Item
                      className="ui-menu-item"
                      disabled={disabled}
                      onClick={() =>
                        void runAction(() =>
                          exportEqFile(data, profile.name, setStatus),
                        )
                      }
                    >
                      <Icon name="file_download" />
                      {t("mobileProfilesView.exportEQ")}
                    </Menu.Item>
                    {onApplyProfile && (
                      <Menu.Item
                        className="ui-menu-item"
                        disabled={disabled}
                        onClick={() =>
                          void runAction(() => onApplyProfile(profile))
                        }
                      >
                        <Icon name="usb" />
                        {t("mobileProfilesView.applyTemporarilyToDAC")}
                      </Menu.Item>
                    )}
                    {!isDefault && (
                      <>
                        <Menu.Item
                          className="ui-menu-item"
                          disabled={disabled}
                          onClick={() => openNameDialog("rename", profile.name)}
                        >
                          <Icon name="edit" />
                          {t("mobileProfilesView.rename")}
                        </Menu.Item>
                        <Menu.Item
                          className="ui-menu-item profiles-menu-danger"
                          disabled={disabled}
                          onClick={() =>
                            void runAction(() => onDelete(profile.name))
                          }
                        >
                          <Icon name="delete" />
                          {t("mobileProfilesView.delete")}
                        </Menu.Item>
                      </>
                    )}
                  </OverflowMenu>
                </div>
              </li>
            );
          })}
        </ul>
        {visible.length === 0 && (
          <div className="mobile-profile-empty" role="status">
            <Icon name="search_off" />
            <h3>{t("mobileProfilesView.noMatchingProfiles")}</h3>
            <p>{t("mobileProfilesView.tryAnotherNameOrClearYourSearch")}</p>
            <Button onClick={() => setProfileSearch("")}>
              {t("mobileProfilesView.clearSearch")}
            </Button>
          </div>
        )}
        {!query && savedCount === 0 && (
          <p className="mobile-profile-library-hint">
            {t("mobileProfilesView.emptyLibraryHint")}
          </p>
        )}
      </section>

      {paste !== null && (
        <Modal
          title={t("profilesView.pasteEQ")}
          closeDisabled={pending}
          onClose={() => setPaste(null)}
          className="profiles-import-dialog"
        >
          <form
            className="modal-body"
            onSubmit={(event) => {
              event.preventDefault();
              if (disabled || !paste.trim()) return;
              void runAction(async () => {
                if (
                  await importText(async () => ({
                    text: paste,
                    name: t("profilesView.pastedEQ"),
                  }))
                )
                  if (mounted.current) setPaste(null);
              });
            }}
          >
            <p className="profiles-note">{t("profilesView.pasteHelp")}</p>
            <label htmlFor="mobile-eq-text">{t("profilesView.eqText")}</label>
            <textarea
              id="mobile-eq-text"
              className="profiles-paste-text"
              data-dialog-autofocus
              rows={8}
              maxLength={1_048_576}
              spellCheck={false}
              value={paste}
              disabled={disabled}
              onChange={(event) => setPaste(event.target.value)}
            />
            <div className="modal-actions">
              <Button disabled={pending} onClick={() => setPaste(null)}>
                {t("profilesView.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={disabled || !paste.trim()}
              >
                {t("profilesView.editorOnly")}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {dialog && (
        <Modal
          title={
            dialog.mode === "save"
              ? t("mobileProfilesView.saveEQAsProfile")
              : t("mobileProfilesView.renameProfile")
          }
          onClose={() => setDialog(null)}
          closeDisabled={pending}
          className="mobile-profile-name-dialog"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (disabled) return;
              if (
                dialog.mode === "save" &&
                (!asyncContextEquals(dialog.context, getAsyncContext()) ||
                  dialog.profile !== selectedPreset)
              ) {
                setStatus(t("mobileProfilesView.editorChanged"));
                return;
              }
              void runAction(async () => {
                if (dialog.mode === "save") {
                  const saving = onSave();
                  setDialog(null);
                  await saving;
                } else if (await onRename(dialog.profile, rename.trim())) {
                  if (mounted.current) setDialog(null);
                }
              });
            }}
          >
            <label htmlFor="mobile-profile-name">
              {t("mobileProfilesView.profileName")}
            </label>
            <Input
              id="mobile-profile-name"
              data-dialog-autofocus
              autoComplete="off"
              value={dialog.mode === "save" ? newProfileName : rename}
              onChange={(event) =>
                dialog.mode === "save"
                  ? setNewProfileName(event.target.value)
                  : setRename(event.target.value)
              }
              placeholder={t("mobileProfilesView.namePlaceholder")}
              aria-invalid={reservedDialogName || undefined}
              aria-describedby={
                reservedDialogName ? "mobile-profile-reserved" : undefined
              }
              disabled={disabled}
            />
            {reservedDialogName && (
              <p
                id="mobile-profile-reserved"
                className="profiles-note profiles-warning"
              >
                {t("profilesView.reservedName", { name: dialogName })}
              </p>
            )}
            <p className="mobile-profile-description">
              {dialog.mode === "save"
                ? t("mobileProfilesView.saveHelp")
                : t("mobileProfilesView.renameHelp")}
            </p>
            <div className="mobile-profile-dialog-actions">
              <Button disabled={pending} onClick={() => setDialog(null)}>
                {t("mobileProfilesView.cancel")}
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={disabled || !dialogName || reservedDialogName}
              >
                {dialog.mode === "save"
                  ? t("mobileProfilesView.saveProfile")
                  : t("mobileProfilesView.rename")}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
