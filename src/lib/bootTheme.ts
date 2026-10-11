import { readLocalStorage } from "./safeStorage";
import { themeOptions } from "./theme";
import { isAndroidDevice } from "./platform";

export function readBootTheme(): string | null {
  try {
    const raw = readLocalStorage("glacier-boot-theme");
    if (!raw || raw.length > 2048) return null;
    const cached = JSON.parse(raw);
    return themeOptions(isAndroidDevice()).some(option => option.value === cached.preference)
      ? cached.preference : null;
  } catch {
    return null;
  }
}
