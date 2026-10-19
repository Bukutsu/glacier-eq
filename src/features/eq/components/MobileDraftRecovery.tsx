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
