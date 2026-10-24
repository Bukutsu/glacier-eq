import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { isTauri } from "@/lib/platform";
import { invokeForDevice } from "@/lib/rpc";
import {
  isDevDummyDevice,
  readDevDummyPeq,
  writeDevDummyPeq,
} from "@/features/device/lib/devDevice";
import {
  setUserEqSlot,
  clearUserEqSlot,
} from "@/features/device/lib/melodySlot";
import { parseStoredPeqResponse, peqEquals } from "@/features/eq/lib/peq";
import { useLiveApply } from "./useLiveApply";
import type { DeviceState } from "./useDeviceState";
import type { EqEditor } from "@/features/eq/hooks/useEqEditor";
import type { DeviceMaintenanceRunner } from "@/features/device/operations/runDeviceMaintenance";
import type { StatusReporter } from "@/stores/toastStore";
import type { createPushEq } from "@/features/device/operations/pushEq";

export function useMelodyWorkspace({
  device,
  editor,
  push,
  runMaintenance,
  setStatus,
  onSwitchingChange,
  editingBank,
}: {
  device: DeviceState;
  editor: EqEditor;
  push: ReturnType<typeof createPushEq>;
  runMaintenance: DeviceMaintenanceRunner;
  setStatus: StatusReporter;
  onSwitchingChange: (value: boolean) => void;
  editingBank: { current: number | null };
}) {
  const { t } = useTranslation("device");
  const slots = device.selectedDeviceInfo?.user_eq_slots ?? [];
  const melody = device.selectedDeviceInfo?.controls === "melody";
  const available = device.connected && slots.length > 1;
  const experimental =
    available &&
    melody &&
    device.selectedDeviceInfo?.profile_name === "SNOWSKY Melody" &&
    device.supportsRamApply;
  const connectionKey = `${device.connected}:${device.connectedPathRef.current}:${device.connectedSessionIdRef.current}:${device.selectedDeviceInfo?.profile_name ?? ""}`;
  const bankNumber = (slot: number) => slots.indexOf(slot) + 1;
  const editorName = (slot: number) =>
    t("melodyBanks.editorName", { number: bankNumber(slot) });
  const [bank, setBank] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changing = useRef(false);
  const mounted = useRef(true);
  const lastConnection = useRef(connectionKey);
  // Disarm during render too: passive effect cleanup must not leave one frame
  // in which a reconnected DAC inherits the previous bank's edit.
  const currentBank = lastConnection.current === connectionKey ? bank : null;
  const unsaved = device.lastPushedPeq
    ? !peqEquals(editor.peq, device.lastPushedPeq)
    : editor.dirty;
  const active = experimental && enabled && currentBank !== null && !switching;
  const saveCurrent = async () => {
    let saved = false;
    await push({
      quiet: true,
      melodySlot: currentBank ?? undefined,
      onSaved: () => {
        saved = true;
      },
    });
    if (!saved) throw new Error(t("melodyBanks.saveFailed"));
  };
  const live = useLiveApply({
    active,
    peq: editor.peq,
    unsaved,
    lastPushedPeq: device.lastPushedPeq,
    capabilities: device.capabilities,
    busyRef: device.eqOperationInFlightRef,
    scopeKey: `${connectionKey}:${currentBank}`,
    invoke: async <T>(command: string, args?: unknown) => {
      if (currentBank === null || !available)
        throw new Error(t("melodyBanks.chooseFirst"));
      if (isDevDummyDevice(device.selectedDevice)) {
        return writeDevDummyPeq(
          device.selectedDevice,
          (args as { peq: typeof editor.peq }).peq,
          false,
        ) as T;
      }
      return invokeForDevice<T>(device.selectedDevice, command, {
        ...(args as Record<string, unknown>),
        melody_slot: currentBank,
        ...(isTauri()
          ? {
              expected_path: device.selectedDevice,
              expected_session_id: device.connectedSessionIdRef.current,
            }
          : {}),
      });
    },
    save: saveCurrent,
    autoSave: false,
    reportError: (message) => {
      setEnabled(false);
      setError(message);
      setStatus(message, "error");
    },
  });

  useEffect(() => {
    lastConnection.current = connectionKey;
    const path = device.connectedPathRef.current;
    if (path) clearUserEqSlot(path);
    editingBank.current = null;
    setBank(null);
    setEnabled(true);
    setError(null);
    return () => {
      editingBank.current = null;
      live.stop();
    };
  }, [connectionKey]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function changeBank(slot: number | null): Promise<boolean> {
    if (
      !available ||
      (slot !== null && !slots.includes(slot)) ||
      changing.current ||
      device.isBusy ||
      device.eqOperationInFlightRef.current
    )
      return false;
    if (slot === currentBank && !error) return true;
    changing.current = true;
    setSwitching(true);
    onSwitchingChange(true);
    setError(null);
    const generation = device.connectionGenerationRef.current;
    const path = device.selectedDevice;
    const current = () =>
      mounted.current &&
      generation === device.connectionGenerationRef.current &&
      device.connectedPathRef.current === path;
    try {
      if (currentBank !== null && unsaved) {
        const revision = editor.getAsyncContext().editorRevision;
        if (
          !(await confirmDialog({
            title: t("melodyBanks.discardTitle"),
            message: t("melodyBanks.discardMessage", {
              number: bankNumber(currentBank),
            }),
            confirmLabel:
              slot === null
                ? t("melodyBanks.discardAction")
                : t("melodyBanks.discardAndSwitch", {
                    number: bankNumber(slot),
                  }),
            danger: true,
          })) ||
          editor.getAsyncContext().editorRevision !== revision
        )
          return false;
      } else if (currentBank === null && slot !== null && editor.dirty) {
        const revision = editor.getAsyncContext().editorRevision;
        if (
          !(await confirmDialog({
            title: t("pullEq.discardChanges"),
            message: t("pullEq.discardConfirmation"),
            confirmLabel: t("pullEq.discardAndRead"),
          })) ||
          editor.getAsyncContext().editorRevision !== revision
        )
          return false;
      }
      await live.pause();
      if (!current()) return false;
      // Non-bank playback controls also save and drain first, then disarm live.
      editingBank.current = null;
      setBank(null);
      if (slot === null) return true;
      let loaded = false;
      await runMaintenance(async (isCurrent) => {
        if (!current() || !isCurrent()) return;
        device.setLastPushedPeq(null);
        if (melody) {
          await invokeForDevice(path, "melody_control", { path, value: slot });
        } else {
          await invokeForDevice(path, "set_user_eq_bank", { path, slot });
        }
        if (!current() || !isCurrent()) return;
        const raw = isDevDummyDevice(path)
          ? readDevDummyPeq(path)
          : await invokeForDevice(path, "get_eq_state");
        if (!current() || !isCurrent()) return;
        const peq = parseStoredPeqResponse(raw, {
          capabilities: device.capabilities,
          integerPreamp: device.capabilities.integer_preamp,
        });
        editor.pushToUndoStack(editor.peqRef.current);
        editor.setPeq(peq);
        editor.peqRef.current = peq;
        editor.editorCleanPeqRef.current = peq;
        editor.noteEditorMutation();
        editor.setDirty(false);
        editor.setNewProfileName("");
        editor.setProfileSearch("");
        editor.setSelectedPreset(editorName(slot));
        device.setLastPushedPeq(peq);
        setUserEqSlot(path, slot, slots);
        editingBank.current = slot;
        setBank(slot);
        loaded = true;
      });
      if (!loaded && current()) throw new Error(t("melodySave.busy"));
      return loaded;
    } catch (failure) {
      if (current()) {
        setEnabled(false);
        const message = String(failure);
        setError(message);
        setStatus(message, "error");
      }
      return false;
    } finally {
      changing.current = false;
      if (mounted.current) {
        setSwitching(false);
        onSwitchingChange(false);
      }
    }
  }

  async function saveEditorToBank(slot: number): Promise<boolean> {
    if (
      !available ||
      !slots.includes(slot) ||
      changing.current ||
      device.isBusy ||
      device.eqOperationInFlightRef.current
    )
      return false;
    changing.current = true;
    setSwitching(true);
    onSwitchingChange(true);
    setError(null);
    const generation = device.connectionGenerationRef.current;
    const path = device.selectedDevice;
    const current = () =>
      mounted.current &&
      generation === device.connectionGenerationRef.current &&
      device.connectedPathRef.current === path;
    try {
      await live.pause();
      if (!current()) return false;
      let saved = false;
      await push({
        fiioSlot: slot,
        onSaved: () => {
          saved = true;
        },
      });
      if (!saved || !current()) return false;
      const stored = editor.peqRef.current;
      editor.editorCleanPeqRef.current = stored;
      editor.setDirty(false);
      editor.setSelectedPreset(editorName(slot));
      editor.setNewProfileName("");
      setUserEqSlot(path, slot, slots);
      editingBank.current = slot;
      setBank(slot);
      return true;
    } catch (failure) {
      if (current()) {
        const message = String(failure);
        setError(message);
        setStatus(message, "error");
      }
      return false;
    } finally {
      changing.current = false;
      if (mounted.current) {
        setSwitching(false);
        onSwitchingChange(false);
      }
    }
  }

  const invalidate = () => {
    live.stop();
    editingBank.current = null;
    setBank(null);
    device.setLastPushedPeq(null);
  };
  return {
    editorState:
      currentBank !== null
        ? {
            status: unsaved ? t("melodyBanks.unsaved") : t("melodyBanks.saved"),
            unsaved,
            slot: currentBank,
            bankNumber: bankNumber(currentBank),
          }
        : undefined,
    available,
    experimental,
    bank: currentBank,
    enabled,
    active,
    switching,
    error,
    select: (slot: number) => changeBank(slot),
    saveEditorToBank,
    beforeExternalChange: () => changeBank(null),
    pauseLiveForWrite: () => live.pause(),
    invalidate,
    setEnabled: (value: boolean) => {
      setError(null);
      setEnabled(value);
    },
  };
}
export type MelodyWorkspace = ReturnType<typeof useMelodyWorkspace>;
