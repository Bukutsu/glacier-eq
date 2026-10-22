import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ToggleRow } from "@/components/ui/SettingsPrimitives";
import { invoke } from "@/lib/rpc";

/**
 * Android only. Android stores this choice itself (an app component switched
 * on or off), so it is not part of AppSettings.
 */
export function OpenOnAttachSetting({
  setStatus,
}: {
  setStatus?: (message: string) => void;
}) {
  const { t } = useTranslation("settings");
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    invoke<boolean>("get_open_on_attach")
      .then((value) => {
        if (active) setEnabled(value === true);
      })
      .catch((error) => {
        if (active)
          setStatus?.(
            t("general.openOnAttachFailed", { error: String(error) }),
          );
      });
    return () => {
      active = false;
    };
  }, [setStatus, t]);

  const change = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    try {
      await invoke("set_open_on_attach", { enabled: next });
    } catch (error) {
      setEnabled(previous);
      setStatus?.(t("general.openOnAttachFailed", { error: String(error) }));
    }
  };

  return (
    <ToggleRow
      title={t("general.openOnAttach")}
      desc={t("general.openOnAttachDescription")}
      checked={enabled === true}
      disabled={enabled === null}
      onChange={(next) => void change(next)}
    />
  );
}
