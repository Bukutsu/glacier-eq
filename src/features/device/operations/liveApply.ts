import { i18n } from "@/lib/i18n";
import type { invoke } from "@/lib/rpc";
import { isDisconnectionError } from "@/lib/errors";
import { normalizePeq } from "@/features/eq/lib/peq";
import type { DeviceCapabilities, PEQData } from "@/types";

// The official WalkPlay web app also waits 100 ms after an edit before it
// sends the EQ, so a burst of edits becomes one write.
export const LIVE_APPLY_DELAY_MS = 100;
// Saving writes the DAC's flash, so it waits for the edits to stop instead of
// following every change.
export const LIVE_SAVE_DELAY_MS = 3000;
// How soon to look again when a save or read has the device.
export const LIVE_BUSY_RETRY_MS = 250;

export interface LiveApplyState {
  peq: PEQData;
  /** The editor EQ differs from the EQ stored on the DAC. */
  unsaved: boolean;
  /** A save, read or other EQ operation owns the device right now. */
  busy: boolean;
  capabilities: DeviceCapabilities;
}

export interface LiveApplyContext {
  invoke: typeof invoke;
  getState: () => LiveApplyState;
  /** Saves the editor EQ to the DAC. Reports its own failures. */
  save: () => Promise<void>;
  reportError: (message: string) => void;
}

/**
 * Sends the editor's EQ to the DAC's RAM shortly after each edit, then saves
 * it once the edits stop.
 */
export function createLiveApplier(context: LiveApplyContext) {
  const { invoke, getState, save, reportError } = context;
  let applyTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  // The DAC's RAM holds an EQ other than the stored one, so a return to the
  // stored EQ must be sent too.
  let diverged = false;

  function scheduleApply(delay: number) {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => void flush(), delay);
  }

  function scheduleSave(delay: number) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveNow(), delay);
  }

  async function flush() {
    applyTimer = undefined;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const state = getState();
        if (state.busy) {
          // Dropping the edit would leave the DAC on an older EQ.
          scheduleApply(LIVE_BUSY_RETRY_MS);
          return;
        }
        if (!state.unsaved && !diverged) return;
        const peq = normalizePeq(state.peq, {
          integerPreamp: state.capabilities.integer_preamp,
          capabilities: state.capabilities,
        });
        await invoke("live_apply_eq_state", { peq });
        diverged = state.unsaved;
        if (diverged) scheduleSave(LIVE_SAVE_DELAY_MS);
      } while (again);
    } catch (error) {
      // A lost device is reported by the connection monitor.
      if (!isDisconnectionError(error)) {
        reportError(
          i18n.t("device:liveApply.liveApplyFailed", { error: error }),
        );
      }
    } finally {
      running = false;
    }
  }

  async function saveNow() {
    saveTimer = undefined;
    if (running || getState().busy) {
      scheduleSave(LIVE_BUSY_RETRY_MS);
      return;
    }
    if (!getState().unsaved) return;
    // The save reports its own failure. Without a new edit nothing retries,
    // so a failing DAC is not written to in a loop.
    await save();
  }

  return {
    schedule() {
      // A new edit pushes the save back.
      clearTimeout(saveTimer);
      saveTimer = undefined;
      scheduleApply(LIVE_APPLY_DELAY_MS);
    },
    cancel() {
      clearTimeout(applyTimer);
      applyTimer = undefined;
    },
    /** Live apply was switched off or the device went away. */
    stop() {
      clearTimeout(applyTimer);
      clearTimeout(saveTimer);
      applyTimer = saveTimer = undefined;
      diverged = false;
    },
    /** The DAC's RAM matches the stored EQ again (after a save or a read). */
    markSynced() {
      diverged = false;
    },
  };
}
