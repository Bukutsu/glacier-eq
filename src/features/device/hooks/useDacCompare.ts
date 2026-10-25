import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { DeviceCapabilities, PEQData } from "@/types";
import type { ReportStatus } from "@/features/diagnostics/types";
import { invoke } from "@/lib/rpc";
import { isDevDummyDevice, writeDevDummyPeq } from "../lib/devDevice";
import { createBypassCompare } from "../operations/compareBypass";

export function useDacCompare({
  playing,
  capabilities,
  busy,
  path,
  reportStatus,
}: {
  playing: PEQData;
  capabilities: DeviceCapabilities;
  busy: boolean;
  path: string;
  reportStatus: ReportStatus;
}) {
  const { t } = useTranslation("shell");
  const state = useRef({ playing, capabilities, busy, path });
  state.current = { playing, capabilities, busy, path };
  return useMemo(
    () =>
      createBypassCompare({
        apply: async (next) => {
          const { path } = state.current;
          if (isDevDummyDevice(path)) writeDevDummyPeq(path, next, false);
          else await invoke("live_apply_eq_state", { peq: next });
        },
        getState: () => state.current,
        reportError: (error) =>
          reportStatus({
            level: "Error",
            message: t("compare.failed", { error: String(error) }),
            toastType: "error",
            source: "UI",
          }),
      }),
    [reportStatus, t],
  );
}
