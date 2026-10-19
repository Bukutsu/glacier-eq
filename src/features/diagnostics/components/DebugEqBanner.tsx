import { useTranslation } from "react-i18next";
import { useDebugStore } from "@/features/diagnostics/stores/debugStore";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export function DebugEqBanner() {
  const { t } = useTranslation("editor");
  const enabled = useDebugStore((s) => s.autoDiscardEq);
  const disable = useDebugStore((s) => s.setAutoDiscardEq);
  if (!enabled) return null;
  return (
    <aside
      className="debug-eq-banner"
      role="status"
      aria-label={t("debug.warning")}
    >
      <Icon name="error" />
      <div>
        <strong>{t("debug.title")}</strong>
        <p>{t("debug.description")}</p>
      </div>
      <Button type="button" variant="default" onClick={() => disable(false)}>
        {t("debug.disable")}
      </Button>
    </aside>
  );
}
