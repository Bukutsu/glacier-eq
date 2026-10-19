// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";
import { i18n } from "@/lib/i18n";
import { isTauri } from "@/lib/platform";
import { invoke } from "@/lib/rpc";
import { useToastStore } from "@/stores/toastStore";

/** Mirrors `UpdateSupport.reason` in src-tauri/src/updater.rs. */
export type UpdateUnsupportedReason = "systemPackage" | "unpackaged" | "mobile";

interface UpdateSupport {
  supported: boolean;
  reason: UpdateUnsupportedReason | null;
}

/** One plain value describes the whole flow; the card renders from it alone. */
export type UpdateState =
  | { phase: "unknown" }
  | { phase: "unsupported"; reason: UpdateUnsupportedReason }
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "upToDate" }
  | { phase: "available"; version: string; notes: string | null }
  | {
      phase: "downloading";
      version: string;
      received: number;
      total: number | null;
    }
  | { phase: "ready"; version: string }
  | { phase: "restarting"; version: string }
  | { phase: "error"; message: string };

interface AppUpdateStore {
  state: UpdateState;
  /** Resolves support once; unsupported builds never reach the network. */
  detect: () => Promise<void>;
  /** Launch check: quiet when current or offline, a toast when newer. */
  checkOnLaunch: () => Promise<void>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  /** Installs the downloaded update and relaunches. */
  install: () => Promise<void>;
}

// The plugin's Update is a native resource handle, not serializable state.
let pending: Update | null = null;
let detecting: Promise<void> | null = null;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const useAppUpdate = create<AppUpdateStore>()((set, get) => {
  const fail = (error: unknown) =>
    set({ state: { phase: "error", message: errorMessage(error) } });

  return {
    state: { phase: "unknown" },

    detect: () => {
      detecting ??= (async () => {
        if (!isTauri()) {
          // Web has no installer; the card is not rendered, but keep the
          // state honest for anything that reads it.
          set({ state: { phase: "unsupported", reason: "unpackaged" } });
          return;
        }
        try {
          const support = await invoke<UpdateSupport>("get_update_support");
          set({
            state: support.supported
              ? { phase: "idle" }
              : {
                  phase: "unsupported",
                  reason: support.reason ?? "unpackaged",
                },
          });
        } catch (error) {
          detecting = null;
          fail(error);
        }
      })();
      return detecting;
    },

    checkOnLaunch: async () => {
      await get().detect();
      if (get().state.phase !== "idle") return;
      await get().check();
      const { state } = get();
      if (state.phase === "available") {
        useToastStore.getState().addToast(
          i18n.t("settings:updates.availableToast", {
            version: state.version,
          }),
          "info",
        );
      }
    },

    check: async () => {
      await get().detect();
      const { phase } = get().state;
      // Idle, settled, or failed states may re-check; work in flight and a
      // downloaded update may not be disturbed.
      if (
        phase === "unknown" ||
        phase === "unsupported" ||
        phase === "checking" ||
        phase === "downloading" ||
        phase === "ready" ||
        phase === "restarting"
      )
        return;
      set({ state: { phase: "checking" } });
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        // Release the previous handle; a re-check returns a fresh one.
        void pending?.close().catch(() => {});
        pending = update;
        set({
          state: update
            ? {
                phase: "available",
                version: update.version,
                notes: update.body?.trim() || null,
              }
            : { phase: "upToDate" },
        });
      } catch (error) {
        fail(error);
      }
    },

    download: async () => {
      const update = pending;
      const { state } = get();
      if (!update || state.phase !== "available") return;
      const version = state.version;
      let received = 0;
      let total: number | null = null;
      set({ state: { phase: "downloading", version, received, total } });
      try {
        await update.download((event) => {
          if (event.event === "Started")
            total = event.data.contentLength ?? null;
          else if (event.event === "Progress")
            received += event.data.chunkLength;
          set({ state: { phase: "downloading", version, received, total } });
        });
        set({ state: { phase: "ready", version } });
      } catch (error) {
        fail(error);
      }
    },

    install: async () => {
      const update = pending;
      const { state } = get();
      if (!update || state.phase !== "ready") return;
      set({ state: { phase: "restarting", version: state.version } });
      try {
        // Windows installers end the process here instead of returning.
        await update.install();
        await invoke("restart_app");
      } catch (error) {
        fail(error);
      }
    },
  };
});
