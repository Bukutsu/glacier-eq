import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";
import { Input } from "@/components/ui/Input";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { invokeForDevice } from "@/lib/rpc";
import type { DeviceMaintenanceRunner } from "@/features/device/operations/runDeviceMaintenance";
import type { MelodyWorkspace } from "@/features/device/hooks/useMelodyWorkspace";

export function MelodyBanks({
  path,
  workspace,
  isBusy,
  runMaintenance,
  onSaveEditor,
  slots,
  isMelody,
}: {
  path: string;
  workspace: MelodyWorkspace;
  isBusy: boolean;
  runMaintenance: DeviceMaintenanceRunner;
  onSaveEditor: (slot: number) => Promise<boolean>;
  slots: number[];
  isMelody: boolean;
}) {
  const { t } = useTranslation("device");
  const [names, setNames] = useState<Record<number, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const runner = useRef(runMaintenance);
  runner.current = runMaintenance;
  const busy = isBusy || workspace.switching;
  const validName = /^[a-z0-9]{1,8}$/i.test(draft);

  // Load names once per device and refresh request. The read itself marks
  // the device busy, so busy changes must not restart or cancel it: that
  // made each finished read start the next one, in an endless render loop.
  const loadedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!isMelody) {
      setNames({});
      loadedKey.current = null;
      return;
    }
    const key = `${path}:${attempt}`;
    if (isBusy || loadedKey.current === key) return;
    loadedKey.current = key;
    const isLatest = () => loadedKey.current === key;
    void (async () => {
      let started = false;
      try {
        await runner.current(async (current) => {
          started = true;
          const next: Record<number, string> = {};
          for (const slot of slots) {
            if (!isLatest() || !current()) return;
            next[slot] = await invokeForDevice<string>(path, "melody_name", {
              path,
              slot,
            });
          }
          if (isLatest() && current()) {
            setNames(next);
            setError(null);
          }
        });
      } catch (failure) {
        if (isLatest()) setError(failure);
      }
      // Another operation held the device: try again once it is idle.
      if (!started && isLatest()) loadedKey.current = null;
    })();
  }, [path, attempt, isBusy, isMelody, slots]);

  const rename = async (event: FormEvent, slot: number) => {
    event.preventDefault();
    if (!validName || busy || renaming) return;
    setRenaming(true);
    let saved = false;
    try {
      await runner.current(async (current) => {
        const actual = await invokeForDevice<string>(path, "melody_name", {
          path,
          slot,
          name: draft,
        });
        if (!current()) return;
        setNames((previous) => ({ ...previous, [slot]: actual }));
        setError(null);
        saved = true;
      });
      if (saved) setEditing(null);
    } catch (failure) {
      setError(failure);
    } finally {
      setRenaming(false);
    }
  };

  return (
    <section className="profiles-dac-banks cmp:min-w-[0] cmp:mt-[var(--space-3)] cmp:pb-[var(--space-3)] cmp:[border-bottom:1px_solid_var(--line-soft)] cmp:flex cmp:flex-col cmp:gap-[var(--space-2)]" aria-labelledby="dac-banks-title">
      <div className="melody-banks-heading cmp:flex cmp:items-start cmp:justify-between cmp:gap-[var(--space-3)]">
        <div>
          <h3
            id="dac-banks-title"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("melodyBanks.title")}
          </h3>
          <p className="profiles-note">{t("melodyBanks.instructions")}</p>
        </div>
        {isMelody && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("melodyControls.refreshSettings")}
            title={t("melodyControls.refreshSettings")}
            disabled={busy}
            onClick={() => setAttempt((value) => value + 1)}
          >
            <Icon name="refresh" />
          </Button>
        )}
      </div>
      <ul className="cmp:flex cmp:flex-col cmp:gap-[2px] cmp:m-[0_calc(-1_*_var(--space-2))] cmp:p-[0_var(--space-2)] cmp:[list-style:none]">
        {slots.map((slot, index) => (
          <li
            key={slot}
            className={`cmp:[&.is-current]:[--muted:var(--accent-foreground)] cmp:relative cmp:flex cmp:shrink-0 cmp:items-center cmp:gap-[var(--space-2)] cmp:min-w-[0] cmp:pr-[var(--space-1)] cmp:rounded-[var(--control-radius)] cmp:[transition:background-color_120ms] cmp:[&:hover]:[background:var(--accent)] cmp:[&&.is-current]:[background:var(--surface-soft)] cmp:[&.is-current::before]:content-[''] cmp:[&.is-current::before]:absolute cmp:[&.is-current::before]:top-[10px] cmp:[&.is-current::before]:bottom-[10px] cmp:[&.is-current::before]:left-[0] cmp:[&.is-current::before]:w-[2px] cmp:[&.is-current::before]:rounded-[2px] cmp:[&.is-current::before]:[background:var(--primary)] ${workspace.bank === slot ? "is-current" : ""}`}
          >
            <button
              type="button"
              data-slot="profile-load"
              className="cmp:flex cmp:flex-[1_1_auto] cmp:flex-col cmp:items-start cmp:gap-[2px] cmp:min-w-[0] cmp:min-h-[52px] cmp:p-[var(--space-2)_var(--space-3)] cmp:[border:0] cmp:rounded-[var(--control-radius)] cmp:[background:transparent] cmp:text-[color:inherit] cmp:[font:inherit] cmp:text-left cmp:cursor-pointer cmp:[&:focus-visible]:[outline:2px_solid_var(--ring)] cmp:[&:focus-visible]:[outline-offset:-2px] cmp:[.profiles-dac-banks_&:disabled]:opacity-[0.5] cmp:[.profiles-dac-banks_&:disabled]:cursor-not-allowed cmp:[.profiles-dac-banks_&]:min-w-[0]"
              title={t("melodyBanks.openLabel", {
                number: index + 1,
              })}
              aria-label={t("melodyBanks.openLabel", {
                number: index + 1,
              })}
              aria-pressed={workspace.bank === slot}
              disabled={busy}
              onClick={() => void workspace.select(slot)}
            >
              <span className="profiles-item-name">
                {t("melodySave.userBank", { number: index + 1 })}
              </span>
              <span className="profiles-item-meta">
                {names[slot] || t("melodyBanks.storedOnDac")}
              </span>
            </button>
            <div className="profiles-row-actions cmp:flex cmp:flex-[none] cmp:gap-[2px]">
              {workspace.bank === slot ? (
                <Badge className="cmp:[.profiles-dac-banks_&]:[border-color:color-mix(in_srgb,_var(--primary)_40%,_transparent)] cmp:[.profiles-dac-banks_&]:[background:color-mix(in_srgb,_var(--primary)_8%,_transparent)] cmp:[.profiles-dac-banks_&]:text-[color:var(--primary)]">
                  {t("melodyBanks.editing")}
                </Badge>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("melodyBanks.saveEditorLabel", {
                    number: index + 1,
                  })}
                  title={t("melodyBanks.saveEditorLabel", {
                    number: index + 1,
                  })}
                  disabled={busy}
                  onClick={() => void onSaveEditor(slot)}
                >
                  <Icon name="save" />
                </Button>
              )}
              {isMelody && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("melodyBanks.renameLabel", {
                    number: index + 1,
                  })}
                  title={t("melodyBanks.renameLabel", { number: index + 1 })}
                  disabled={busy}
                  onClick={() => {
                    setDraft(names[slot] ?? "");
                    setEditing(slot);
                  }}
                >
                  <Icon name="edit" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {workspace.experimental && (
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="melody-live"
            className="text-xs text-muted-foreground"
          >
            {t("melodyBanks.live")}
          </label>
          <Switch
            id="melody-live"
            label={t("melodyBanks.live")}
            checked={workspace.enabled}
            disabled={busy}
            onCheckedChange={workspace.setEnabled}
          />
        </div>
      )}
      {workspace.experimental && (
        <p className="text-xs text-muted-foreground">
          {t("melodyBanks.liveDescription")}
        </p>
      )}
      {workspace.error && <ErrorNotice>{workspace.error}</ErrorNotice>}
      {error != null && <ErrorNotice>{String(error)}</ErrorNotice>}
      {editing !== null && (
        <Modal
          title={t("melodyBanks.renameLabel", { number: editing - 159 })}
          className="profiles-import-dialog"
          closeDisabled={renaming}
          onClose={() => setEditing(null)}
        >
          <form
            className="modal-body"
            onSubmit={(event) => void rename(event, editing)}
          >
            <label htmlFor="melody-bank-name">
              {t("melodyControls.slotName")}
            </label>
            <Input
              id="melody-bank-name"
              data-dialog-autofocus
              autoComplete="off"
              maxLength={8}
              value={draft}
              disabled={renaming}
              onChange={(event) => setDraft(event.target.value)}
              aria-describedby="melody-bank-name-help"
            />
            <p id="melody-bank-name-help" className="profiles-note">
              {t("melodyControls.nameDescription")}
            </p>
            <div className="cmp:[.modal-content_&]:flex cmp:[.modal-content_&]:justify-end cmp:[.modal-content_&]:flex-wrap cmp:[.modal-content_&]:gap-[var(--space-2)] cmp:[.modal-content_&]:mt-[var(--space-4)]">
              <Button
                type="button"
                variant="ghost"
                disabled={renaming}
                onClick={() => setEditing(null)}
              >
                {t("melodyBanks.cancelRename")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  renaming ||
                  !validName ||
                  draft.toUpperCase() === names[editing]
                }
              >
                {t("melodyControls.rename")}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
