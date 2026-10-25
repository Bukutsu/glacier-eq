import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { isBalanceNavigation, MODAL_HISTORY_KEY } from "@/lib/modalHistory";
import { parseWorkspacePath, workspacePath, type MobileTab } from "@/lib/tabs";

export const mobileBarTab = (tab: MobileTab): MobileTab =>
  tab === "device" ? "settings" : tab;

export function useWorkspaceNavigation(
  isMobile: boolean,
  onLeaveModalStack: () => void,
) {
  const location = useLocation();
  const navigate = useNavigate();
  const route = parseWorkspacePath(location.pathname);
  const scrollRef = useRef<HTMLElement | null>(null);
  const paths = useRef<Partial<Record<MobileTab, string>>>({});
  const positions = useRef<Record<MobileTab, number>>({
    eq: 0,
    tuning: 0,
    profiles: 0,
    device: 0,
    settings: 0,
  });

  useEffect(() => {
    if (!isMobile) return;
    const frame = window.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: positions.current[route.tab],
        behavior: "auto",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [route.tab, isMobile]);

  const leaveModalStack = useEffectEvent(() => {
    onLeaveModalStack();
    positions.current[route.tab] = scrollRef.current?.scrollTop ?? 0;
  });

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      // Modal.tsx balances its own history entries. Only a Back outside that
      // stack closes route-level overlays and cancels pending reconnects.
      if (isBalanceNavigation(event)) return;
      const state: unknown = event.state;
      if (
        typeof state === "object" &&
        state !== null &&
        MODAL_HISTORY_KEY in state
      )
        return;
      leaveModalStack();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const selectTab = useCallback(
    (id: MobileTab) => {
      const currentTab = isMobile ? mobileBarTab(route.tab) : route.tab;
      const scroll = scrollRef.current;
      if (currentTab === id) {
        scroll?.scrollTo({
          top: 0,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
        });
        positions.current[route.tab] = 0;
        return;
      }
      positions.current[route.tab] = scroll?.scrollTop ?? 0;
      paths.current[currentTab] = location.pathname;
      navigate(paths.current[id] ?? workspacePath(id));
    },
    [navigate, location.pathname, route.tab, isMobile],
  );

  return { ...route, scrollRef, selectTab };
}
