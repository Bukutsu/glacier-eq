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
      className="debug-eq-banner leg:flex leg:flex-[0_0_auto] leg:items-center leg:gap-[12px] leg:p-[12px_20px] leg:[border-bottom:2px_solid_var(--warning-border)] leg:[background:var(--popover)] leg:text-[color:var(--warning-foreground)] leg:[box-shadow:inset_4px_0_var(--warning-foreground)] leg:max-[600px]:flex-wrap leg:max-[600px]:p-[10px_14px]"
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
