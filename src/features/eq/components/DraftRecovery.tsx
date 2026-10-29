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
        className="header-draft-trigger leg:relative leg:inline-flex leg:items-center leg:gap-[6px] leg:h-[22px] leg:my-[-3px] leg:p-[0_8px] leg:[border:1px_solid_color-mix(in_srgb,_var(--warning-foreground)_30%,_transparent)] leg:rounded-[var(--control-radius)] leg:[background:color-mix(in_srgb,_var(--warning-foreground)_8%,_var(--background))] leg:text-[color:var(--foreground)] leg:text-[length:12px] leg:leading-[1.4] leg:cursor-pointer leg:[&:hover]:[background:color-mix(in_srgb,_var(--warning-foreground)_14%,_var(--background))] leg:[&&[data-popup-open]]:[background:color-mix(in_srgb,_var(--warning-foreground)_14%,_var(--background))] leg:[&:focus-visible]:[outline:2px_solid_var(--ring)] leg:[&:focus-visible]:[outline-offset:2px] leg:touchy:[&::after]:content-[''] leg:touchy:[&::after]:absolute leg:touchy:[&::after]:inset-[-11px_0]"
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
          className="cmp:z-[var(--z-popover)] cmp:[isolation:isolate]"
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={8}
        >
          <Popover.Popup className="header-draft-popup leg:w-[300px] leg:max-w-[calc(100vw_-_16px)] leg:max-h-[var(--available-height)] leg:overflow-y-auto leg:p-[16px] leg:[border:1px_solid_var(--line-medium)] leg:rounded-[var(--radius-card)] leg:[background:var(--popover)] leg:text-[color:var(--popover-foreground)] leg:[box-shadow:var(--shadow-md)] leg:[outline:none] leg:box-border">
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
            <div className="leg:flex leg:flex-wrap leg:gap-[var(--space-2)] leg:mt-[12px]">
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
