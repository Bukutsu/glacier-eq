import { useEffect, useState } from "react";
import { MOBILE_QUERY } from "../lib/tabs";

/** Tracks the canonical mobile layout query (see MOBILE_QUERY). */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(MOBILE_QUERY).matches
        : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(MOBILE_QUERY);
    const listener = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  return isMobile;
}
