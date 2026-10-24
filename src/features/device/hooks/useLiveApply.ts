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
  scopeKey?: string;
  invoke?: typeof invoke;
  reportError: (message: string) => void;
}

export function useLiveApply(options: UseLiveApplyOptions) {
  const { active, peq, unsaved, lastPushedPeq } = options;
  const latest = useRef(options);
  latest.current = options;

  const applier = useMemo(
    () =>
      createLiveApplier({
        invoke: (command, args) =>
          (latest.current.invoke ?? invoke)(command, args),
        getState: () => ({
          ...latest.current,
          autoSave: latest.current.autoSave ?? true,
          busy:
            latest.current.busyRef.current ||
            latest.current.scopeKey !== options.scopeKey,
        }),
        save: () => latest.current.save(),
        reportError: (message) => latest.current.reportError(message),
      }),
    [options.scopeKey],
  );

  useEffect(() => () => applier.stop(), [applier]);

  useEffect(() => {
    if (!active) {
      applier.stop();
      return;
    }
    applier.schedule();
    return applier.cancel;
  }, [applier, active, peq, unsaved]);

  useEffect(() => applier.markSynced(), [applier, lastPushedPeq]);
  return applier;
}
