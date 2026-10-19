import { useTranslation } from "react-i18next";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

interface DraftRecoveryProps {
  invalid: boolean;
  connected: boolean;
  isBusy: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}

export function DraftRecovery({
  invalid,
  connected,
  isBusy,
  onRestore,
  onDiscard,
}: DraftRecoveryProps) {
  const { t } = useTranslation("editor");
  return (
    <Popover.Root>
      <Popover.Trigger
        className="header-draft-trigger"
        aria-label={
          invalid ? t("draft.pausedUnreadable") : t("draft.pausedUnfinished")
        }
        title={invalid ? t("draft.discardHint") : t("draft.restoreHint")}
      >
        <Icon name="lock" />
        <strong>{t("draft.paused")}</strong>
        <span aria-hidden="true">·</span>
        <span>{invalid ? t("draft.unreadable") : t("draft.unfinished")}</span>
        <Icon name="expand_more" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="ui-popup-positioner"
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={8}
        >
          <Popover.Popup className="header-draft-popup">
            <Popover.Title>
              {invalid ? t("draft.unreadableTitle") : t("draft.restoreTitle")}
            </Popover.Title>
            <Popover.Description>
              {invalid
                ? t("draft.unreadableDescription")
                : t("draft.description")}
            </Popover.Description>
            {connected && !invalid && (
              <p className="header-draft-hint">{t("draft.disconnect")}</p>
            )}
            <div className="header-draft-actions">
              {!invalid && (
                <Button onClick={onRestore} disabled={connected || isBusy}>
                  {t("draft.restore")}
                </Button>
              )}
              <Button variant="ghost" onClick={onDiscard} disabled={isBusy}>
                {t("draft.discard")}
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
