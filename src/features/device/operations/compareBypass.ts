import { normalizePeq } from "@/features/eq/lib/peq";
import type { DeviceCapabilities, PEQData } from "@/types";

interface BypassCompareState {
  /** The EQ the DAC plays now. It is sent back when the hold ends. */
  playing: PEQData;
  capabilities: DeviceCapabilities;
  /** A save, read or other EQ operation owns the device. */
  busy: boolean;
}

export interface BypassCompareContext {
  /** Sends an EQ to the DAC's RAM only; flash is never written. */
  apply: (peq: PEQData) => Promise<unknown>;
  getState: () => BypassCompareState;
  /** Reserve device writes synchronously, then drain any live preview/save. */
  reserve: () => {
    ready: Promise<void>;
    release: () => void;
  } | null;
  reportError: (error: unknown) => void;
}

/**
 * The same EQ with every filter off. The preamp stays, so pressing A/B
 * never raises the level by the headroom the EQ reserved.
 */
function bypassPeq(peq: PEQData): PEQData {
  return {
    ...peq,
    filters: peq.filters.map((filter) => ({ ...filter, enabled: false })),
  };
}

/**
 * Hold-to-compare: start() plays the DAC without its filters, end() puts
 * back what it played before. Writes run in order, so a quick tap cannot
 * leave the DAC bypassed.
 */
export function createBypassCompare(context: BypassCompareContext) {
  const { apply, getState, reserve, reportError } = context;
  let queue: Promise<void> = Promise.resolve();
  let restore: {
    peq: PEQData;
    capabilities: DeviceCapabilities;
    release: () => void;
  } | null = null;

  const send = (
    peq: PEQData,
    capabilities: DeviceCapabilities,
    ready?: Promise<void>,
  ) => {
    queue = queue
      .then(async () => {
        await ready;
        const normalized = normalizePeq(peq, {
          integerPreamp: capabilities.integer_preamp,
          capabilities,
        });
        await apply(normalized);
      })
      .then(
        () => undefined,
        (error: unknown) => reportError(error),
      );
    return queue;
  };

  return {
    start(): Promise<void> {
      const { playing, capabilities, busy } = getState();
      if (restore || busy) return queue;
      const reservation = reserve();
      if (!reservation) return queue;
      restore = { peq: playing, capabilities, release: reservation.release };
      return send(bypassPeq(playing), capabilities, reservation.ready);
    },
    end(): Promise<void> {
      if (!restore) return queue;
      const { peq, capabilities, release } = restore;
      restore = null;
      queue = send(peq, capabilities).finally(release);
      return queue;
    },
  };
}
