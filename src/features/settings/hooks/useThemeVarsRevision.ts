import { useEffect, useState } from "react";
import { THEME_VARS_CHANGED_EVENT } from "@/features/settings/lib/materialYou";

/** Subscribe to CSS variable updates performed outside React. */
export function useThemeVarsRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const handleChange = () => setRevision((value) => value + 1);
    window.addEventListener(THEME_VARS_CHANGED_EVENT, handleChange);
    return () =>
      window.removeEventListener(THEME_VARS_CHANGED_EVENT, handleChange);
  }, []);
  return revision;
}
