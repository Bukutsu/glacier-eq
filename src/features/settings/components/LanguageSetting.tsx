import { useTranslation } from "react-i18next";
import type { StatusReporter } from "@/stores/toastStore";
import { SelectRow } from "@/components/ui/SettingsPrimitives";
import { getLanguagePreference, setLanguagePreference } from "@/lib/i18n";
import { languageOptions, SYSTEM_LANGUAGE } from "@/lib/locale";

export function LanguageSetting({
  setStatus,
}: {
  setStatus?: StatusReporter;
}) {
  const { t } = useTranslation("settings");
  return (
    <SelectRow
      id="language-select"
      title={t("language.title")}
      desc={t("language.description")}
      value={getLanguagePreference()}
      options={[
        { value: SYSTEM_LANGUAGE, label: t("language.system") },
        ...languageOptions,
      ]}
      onChange={async (value) => {
        if (!(await setLanguagePreference(value)))
          setStatus?.(t("language.saveFailed"), "error");
      }}
    />
  );
}
