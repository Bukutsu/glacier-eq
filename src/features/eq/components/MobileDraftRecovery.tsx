import { Trans, useTranslation } from "react-i18next";
import { useId } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";

interface MobileDraftRecoveryProps {
  invalid: boolean;
  connected: boolean;
  isBusy: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}

export function MobileDraftRecovery({
  invalid,
  connected,
  isBusy,
  onRestore,
  onDiscard,
}: MobileDraftRecoveryProps) {
  const { t } = useTranslation("editor");
  const titleId = useId();
  return (
    <Card className="m-4 shrink-0 p-4" aria-labelledby={titleId}>
      <div role="status">
        <div className="flex items-center gap-2">
          <Icon name={invalid ? "error" : "restart_alt"} />
          <h2 id={titleId} className="m-0 text-sm font-semibold">
            {invalid ? t("draft.unreadable") : t("draft.unfinished")}
          </h2>
        </div>
        <p className="mb-0 mt-2 text-xs leading-relaxed text-muted-foreground">
          {invalid ? t("draft.mobileUnreadable") : t("draft.mobileDescription")}
        </p>
      </div>
      {connected && !invalid && (
        <p className="mb-0 mt-2 text-xs leading-relaxed text-muted-foreground">
          <Trans
            t={t}
            i18nKey="draft.disconnectInDevice"
            components={{
              device: (
                <Link
                  className="text-foreground underline underline-offset-2"
                  to="/device"
                />
              ),
            }}
          />
        </p>
      )}
      <div
        className={`mt-3 grid gap-2 ${invalid ? "grid-cols-1" : "grid-cols-2"}`}
      >
        {!invalid && (
          <Button
            variant="primary"
            className="min-h-11"
            disabled={connected || isBusy}
            onClick={onRestore}
          >
            {t("draft.restore")}
          </Button>
        )}
        <Button className="min-h-11" disabled={isBusy} onClick={onDiscard}>
          {t("draft.discard")}
        </Button>
      </div>
    </Card>
  );
}

interface DraftRestoredNoticeProps {
  isBusy: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}

/** Shown after the app put an unfinished EQ back into the editor by itself. */
export function DraftRestoredNotice({
  isBusy,
  onKeep,
  onDiscard,
}: DraftRestoredNoticeProps) {
  const { t } = useTranslation("editor");
  return (
    <div className="draft-restored-notice cmp:compact:flex cmp:compact:flex-wrap cmp:compact:items-center cmp:compact:gap-[var(--space-2)] cmp:compact:m-[var(--space-2)_var(--space-3)] cmp:compact:p-[var(--space-2)_var(--space-3)] cmp:compact:[border:1px_solid_var(--border)] cmp:compact:rounded-[var(--radius-surface)] cmp:compact:[background:var(--card)] cmp:compact:text-[color:var(--muted-foreground)] cmp:compact:text-[length:var(--type-small)]" role="status">
      <Icon name="restart_alt" />
      <p>{t("draft.restoredNotice")}</p>
      <Button variant="ghost" disabled={isBusy} onClick={onDiscard}>
        {t("draft.discard")}
      </Button>
      <Button disabled={isBusy} onClick={onKeep}>
        {t("draft.keep")}
      </Button>
    </div>
  );
}
