import { useEffect, useMemo, useRef } from "react";

import { invoke } from "@/lib/rpc";
import {
  createLiveApplier,
  type LiveApplyState,
} from "@/features/device/operations/liveApply";
import type { PEQData } from "@/types";

interface UseLiveApplyOptions extends Omit<LiveApplyState, "busy"> {
  /** True while a save, read or other EQ operation owns the device. */
  busyRef: { readonly current: boolean };
  /** Opted in, and the connected DAC can take temporary EQ writes. */
  active: boolean;
  /** Changes whenever the DAC's stored EQ is written or read. */
  lastPushedPeq: PEQData | null;
  save: () => Promise<void>;
  reportError: (message: string) => void;
}

export function useLiveApply(options: UseLiveApplyOptions) {
  const { active, peq, unsaved, lastPushedPeq } = options;
  const latest = useRef(options);
  latest.current = options;

  const applier = useMemo(
    () =>
      createLiveApplier({
        invoke,
        getState: () => ({
          ...latest.current,
          busy: latest.current.busyRef.current,
        }),
        save: () => latest.current.save(),
        reportError: (message) => latest.current.reportError(message),
      }),
    [],
  );

  useEffect(() => {
    if (!active) {
      applier.stop();
      return;
    }
    applier.schedule();
    return applier.cancel;
  }, [applier, active, peq, unsaved]);

  useEffect(() => applier.markSynced(), [applier, lastPushedPeq]);
}
