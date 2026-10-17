import { useCallback, useEffect, useState } from "react";

import { invoke } from "@/lib/rpc";

import { createSettingsPersistence } from "@/features/settings/lib/settingsPersistence";

import type { AppSettings } from "@/types";

import { useThemeSync } from "@/features/settings/hooks/useThemeSync";
import { readBootTheme } from "@/features/settings/lib/bootTheme";

import type { StatusReporter } from "@/stores/toastStore";

const DEFAULT_SETTINGS: AppSettings = {
  auto_pull_on_connect: true,
  skip_push_verification: false,
  // Material You is the default on Android; everywhere else follows Auto.
  theme: readBootTheme() ?? "tokyo-night",
  snap_to_iso_frequencies: true,
  floating_graph_preview: true,
};

export function useAppSettings(showToast: StatusReporter) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const theme = settings.theme;

  const snapToIso = settings.snap_to_iso_frequencies;

  const [appearanceReady, setAppearanceReady] = useState(false);

  const resolvedTheme = useThemeSync(theme, appearanceReady);

  const [settingsPersistence] = useState(() =>
    createSettingsPersistence({
      defaults: DEFAULT_SETTINGS,
      load: () => invoke<AppSettings>("get_settings"),
      save: (settings) => invoke<void>("save_settings", { settings }),
      onChange: setSettings,
      onError: (operation, error) =>
        showToast(
          operation === "save"
            ? `Could not save settings. Your changes may be lost when you restart: ${error}`
            : `Could not load settings. Changes will not be saved until loading succeeds: ${error}`,
          "error",
        ),
    }),
  );

  const updateSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      void settingsPersistence.update(key, value);
    },
    [settingsPersistence],
  );

  useEffect(() => {
    // Essential appearance only; DAC discovery and network work never hold launch.
    void settingsPersistence.load().finally(() => setAppearanceReady(true));
  }, [settingsPersistence]);
  return { settings, theme, snapToIso, resolvedTheme, updateSetting };
}
