import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Collapsible } from "@/components/ui/Collapsible";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { OverflowMenu } from "@/components/ui/OverflowMenu";
import { exportEqFile } from "@/features/eq/lib/exportEq";
import {
  DEFAULT_PROFILE_NAME,
  formatDb,
  normalizePeq,
} from "@/features/eq/lib/peq";
import { asyncContextEquals, type AsyncContext } from "@/lib/asyncContext";
import { invoke, openFileDialog } from "@/lib/rpc";
import type { PEQData, Profile } from "@/types";
import { loadProfile } from "../lib/loadProfile";
import { profileIdentityKey } from "../lib/profileIdentity";
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
  onImportPEQ: (data: PEQData, name: string, isSaved: boolean) => boolean;
  onSave: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onRename: (name: string) => Promise<boolean>;
  onReloadProfiles: () => void;
  onOpenProfilesDir?: () => void;
  getAsyncContext: () => AsyncContext;
  setStatus: (message: string) => void;
  onReviewEq?: () => void;
  preview?: ReactNode;
}

export function MobileProfilesView(props: MobileProfilesViewProps) {
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
  } = props;
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<{
    mode: "save" | "rename";
    context: AsyncContext;
    profile: string;
  } | null>(null);
  const [rename, setRename] = useState("");
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

  async function runAction(action: () => void | Promise<unknown>) {
    if (isBusy || actionPending.current) return;
    actionPending.current = true;
    setPending(true);
    try {
      await action();
    } catch (error) {
      if (mounted.current) setStatus(`Profile action failed: ${error}`);
    } finally {
      actionPending.current = false;
      if (mounted.current) setPending(false);
    }
  }

  function openNameDialog(mode: "save" | "rename") {
    if (disabled) return;
    if (mode === "save")
      setNewProfileName(saved && dirty ? selectedPreset : "");
    else setRename(selectedPreset);
    setDialog({ mode, context: getAsyncContext(), profile: selectedPreset });
  }

  async function importFile() {
    const context = getAsyncContext();
    const current = () =>
      mounted.current && asyncContextEquals(context, getAsyncContext());
    const file = await openFileDialog({
      filters: [{ name: "AutoEQ text", extensions: ["txt"] }],
    });
    if (!file || !current()) return;
    const imported = parseProfileImport(
      await invoke<unknown>("parse_autoeq", { text: file.text }),
      file.name,
    );
    if (!current()) return;
    if (
      dirty &&
      !(await confirmDialog({
        title: "Discard changes?",
        message: "Importing EQ will replace your unsaved editor changes.",
        confirmLabel: "Discard and import",
      }))
    )
      return;
    if (!current()) return;
    if (onImportPEQ(imported.data, imported.name, false))
      setStatus(
        [
          "EQ imported into the editor. Save it to keep it in your library.",
          ...imported.warnings,
        ].join(" "),
      );
  }

  return (
    <div className="mobile-profile-library" aria-busy={disabled}>
      <Card className="mobile-profile-editor" aria-label="Current editor EQ">
        <div className="mobile-profile-section-heading">
          <span className="mobile-profile-eyebrow">In the editor</span>
          <Badge>
            {dirty
              ? "Unsaved changes"
              : builtIn
                ? "Built-in"
                : saved
                  ? "Saved"
                  : "Not saved"}
          </Badge>
        </div>
        <h2 className="mobile-profile-editor-name">{selectedPreset}</h2>
        <p className="mobile-profile-description">
          {activeBands} {activeBands === 1 ? "active band" : "active bands"} ·{" "}
          {formatDb(peq.global_gain)} preamp
        </p>
        {builtIn && (
          <p className="mobile-profile-description">
            The built-in profile is read-only. Save your edits under a new name.
          </p>
        )}
        <div className="mobile-profile-editor-actions">
          <Button
            variant="primary"
            disabled={disabled}
            onClick={() => openNameDialog("save")}
          >
            {saved && dirty ? "Save changes" : "Save as…"}
          </Button>
          {onReviewEq && (
            <Button disabled={disabled} onClick={onReviewEq}>
              Edit EQ
            </Button>
          )}
          <OverflowMenu label="Editor profile actions">
            <Menu.Item
              className="ui-menu-item"
              disabled={disabled}
              onClick={() =>
                void runAction(() =>
                  exportEqFile(peq, selectedPreset, setStatus),
                )
              }
            >
              <Icon name="file_download" />
              Export EQ
            </Menu.Item>
            {saved && (
              <>
                <Menu.Item
                  className="ui-menu-item"
                  disabled={disabled}
                  onClick={() => openNameDialog("rename")}
                >
                  <Icon name="edit" />
                  Rename saved profile
                </Menu.Item>
                <Menu.Item
                  className="ui-menu-item"
                  disabled={disabled}
                  onClick={() => void runAction(onDelete)}
                >
                  <Icon name="delete" />
                  Delete saved profile
                </Menu.Item>
              </>
            )}
          </OverflowMenu>
        </div>
        {preview && (
          <Collapsible title="EQ preview" defaultOpen={false} compact>
            <div className="mobile-profile-preview">{preview}</div>
          </Collapsible>
        )}
      </Card>

      <section aria-labelledby="mobile-profile-library-title">
        <div className="mobile-profile-library-heading">
          <div>
            <h2 id="mobile-profile-library-title">Your library</h2>
            <p className="mobile-profile-description">
              {savedCount} saved {savedCount === 1 ? "profile" : "profiles"}
            </p>
          </div>
          <div className="mobile-profile-library-tools">
            <Button
              disabled={disabled}
              onClick={() => void runAction(importFile)}
            >
              <Icon name="file_upload" />
              Import
            </Button>
            <OverflowMenu label="Library actions">
              <Menu.Item
                className="ui-menu-item"
                disabled={disabled}
                onClick={() => void runAction(onReloadProfiles)}
              >
                <Icon name="refresh" />
                Refresh profiles
              </Menu.Item>
              {onOpenProfilesDir && (
                <Menu.Item
                  className="ui-menu-item"
                  disabled={disabled}
                  onClick={() => void runAction(onOpenProfilesDir)}
                >
                  <Icon name="folder" />
                  Open profiles folder
                </Menu.Item>
              )}
            </OverflowMenu>
          </div>
        </div>
        <div className="mobile-profile-search">
          <Icon name="search" />
          <Input
            aria-label="Search profiles"
            className="pl-9 pr-11 text-base"
            placeholder="Search profiles…"
            value={profileSearch}
            onChange={(event) => setProfileSearch(event.target.value)}
            type="search"
          />
          {profileSearch && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Clear profile search"
              onClick={() => setProfileSearch("")}
            >
              <Icon name="close" />
            </Button>
          )}
        </div>

        <ul className="mobile-profile-list" aria-label="Saved profiles">
          {visible.map((profile) => {
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
                className={
                  current
                    ? "mobile-profile-row is-current"
                    : "mobile-profile-row"
                }
              >
                <div className="mobile-profile-row-heading">
                  <h3>
                    {isDefault && <Icon name="lock" />}
                    {profile.name}
                  </h3>
                  {current && <Badge>In editor</Badge>}
                </div>
                <p className="mobile-profile-description">
                  {isDefault
                    ? "A flat starting point. Always available."
                    : `${bands} ${bands === 1 ? "band" : "bands"} · ${formatDb(data.global_gain)} preamp`}
                </p>
                <div className="mobile-profile-row-actions">
                  <Button
                    disabled={disabled || (current && !dirty)}
                    onClick={() =>
                      void runAction(() =>
                        loadProfile({
                          profile,
                          selectedPreset,
                          dirty,
                          getAsyncContext,
                          confirm: confirmDialog,
                          onSelectProfile: (next) => {
                            if (mounted.current) onSelectProfile(next);
                          },
                        }),
                      )
                    }
                  >
                    {current && !dirty ? (
                      <>
                        <Icon name="check" />
                        Loaded
                      </>
                    ) : current ? (
                      <>
                        <Icon name="restart_alt" />
                        Restore
                      </>
                    ) : (
                      "Load into editor"
                    )}
                  </Button>
                  <OverflowMenu label={`Actions for ${profile.name}`}>
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
                      Export EQ
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
                        Apply temporarily to DAC
                      </Menu.Item>
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
            <h3>No matching profiles</h3>
            <p>Try another name or clear your search.</p>
            <Button onClick={() => setProfileSearch("")}>Clear search</Button>
          </div>
        )}
        {!query && savedCount === 0 && (
          <p className="mobile-profile-library-hint">
            Save the EQ in your editor or import an AutoEQ text file to start
            your library.
          </p>
        )}
      </section>

      {dialog && (
        <Modal
          title={
            dialog.mode === "save" ? "Save EQ as profile" : "Rename profile"
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
                !asyncContextEquals(dialog.context, getAsyncContext()) ||
                dialog.profile !== selectedPreset
              ) {
                setStatus(
                  "The editor changed. Close this dialog and try again.",
                );
                return;
              }
              void runAction(async () => {
                if (dialog.mode === "save") {
                  const saving = onSave();
                  setDialog(null);
                  await saving;
                } else if (await onRename(rename.trim())) {
                  if (mounted.current) setDialog(null);
                }
              });
            }}
          >
            <label htmlFor="mobile-profile-name">Profile name</label>
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
              placeholder="e.g. Evening listening"
              disabled={disabled}
            />
            <p className="mobile-profile-description">
              {dialog.mode === "save"
                ? "Saves the current editor EQ to your library. Nothing is written to your DAC."
                : "Changes the saved name, not the EQ in your editor."}
            </p>
            <div className="mobile-profile-dialog-actions">
              <Button disabled={pending} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={
                  disabled ||
                  !(dialog.mode === "save" ? newProfileName : rename).trim() ||
                  profileIdentityKey(
                    (dialog.mode === "save" ? newProfileName : rename).trim(),
                  ) === profileIdentityKey(DEFAULT_PROFILE_NAME)
                }
              >
                {dialog.mode === "save" ? "Save profile" : "Rename"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
