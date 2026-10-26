import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { DeviceCapabilities, PEQData } from "@/types";
import type { ReportStatus } from "@/features/diagnostics/types";
import { invoke } from "@/lib/rpc";
import { isDevDummyDevice, writeDevDummyPeq } from "../lib/devDevice";
import { createBypassCompare } from "../operations/compareBypass";
import type { createLiveApplier } from "../operations/liveApply";

interface CompareOptions {
  playing: PEQData;
  capabilities: DeviceCapabilities;
  busy: boolean;
  busyRef: { current: boolean };
  path: string;
  scopeKey: string;
  getScopeKey: () => string;
  live: ReturnType<typeof createLiveApplier>;
  liveActive: boolean;
  reportStatus: ReportStatus;
}

export function useDacCompare(options: CompareOptions) {
  const { t } = useTranslation("shell");
  const state = useRef({ ...options, t });
  state.current = { ...options, t };
  const compare = useMemo(() => {
    const { scopeKey, path, busyRef, live } = options;
    let mounted = true;
    const isCurrent = () => state.current.getScopeKey() === scopeKey;
    const controller = createBypassCompare({
      apply: async (next) => {
        if (!isCurrent()) return;
        if (isDevDummyDevice(path)) writeDevDummyPeq(path, next, false);
        else await invoke("live_apply_eq_state", { peq: next });
      },
      getState: () => state.current,
      reserve: () => {
        if (!mounted || busyRef.current || !isCurrent()) return null;
        busyRef.current = true;
        const suspension = live.suspend();
        return {
          ready: suspension.ready,
          release: () => {
            busyRef.current = false;
            suspension.release(
              mounted && isCurrent() && state.current.liveActive,
            );
          },
        };
      },
      reportError: (error) =>
        state.current.reportStatus({
          level: "Error",
          message: state.current.t("compare.failed", { error: String(error) }),
          toastType: "error",
          source: "UI",
        }),
    });
    return {
      controller,
      mount: () => {
        mounted = true;
        return () => {
          mounted = false;
          void controller.end();
        };
      },
    };
  }, [options.scopeKey, options.live, options.busyRef, options.path]);

  useEffect(compare.mount, [compare]);
  return compare.controller;
}
