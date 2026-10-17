import { useEffect } from "react";
import { invoke } from "@/lib/rpc";

import { isDevDummyDevice } from "@/features/device/lib/devDevice";
import {
  normalizePeq,
  normalizePeqForDevice,
  peqEquals,
} from "@/features/eq/lib/peq";
import { isTauri } from "@/lib/platform";

import type { DeviceInfo } from "@/types";

import { chooseReconnectDevice } from "@/features/device/lib/reconnectDevice";
import { markDeviceLost } from "@/features/device/lib/deviceOperations";
import type { DeviceState } from "./useDeviceState";
import type { EqEditor } from "@/features/eq/hooks/useEqEditor";

import type { DeviceSessionOptions } from "./deviceSessionTypes";

export function useDevicePolling(
  device: DeviceState,
  editor: EqEditor,
  loadFirmwareVersion: (path: string, generation: number) => Promise<void>,
  options: DeviceSessionOptions,
) {
  const {
    reconnectEffectGenerationRef,
    manualDisconnectRef,
    expectedRestartUntilRef,
    ambiguousReconnectRef,
    pullEqRef,
    lastConnectedNameRef,
    setDevices,
    devPreviewDeviceRef,
    selectedDevice,
    setSelectedDevice,
    selectedDeviceRef,
    connected,
    connectedRef,
    connectedPathRef,
    connectedSessionIdRef,
    connectingPathRef,
    connectingSessionIdRef,
    connectionGenerationRef,
    setConnected,
    setIsReconnecting,
    connectedDeviceName,
    setConnectedDeviceName,
    setFirmwareVersion,
    isBusy,
    setLastPushedPeq,
  } = device;
  const {
    setPeq,
    setDirty,
    peqRef,
    editorCleanPeqRef,
    noteEditorMutation,
    pushToUndoStack,
  } = editor;
  const { isAndroid, settings, reportStatus, reportLoss, setShowDeviceModal } =
    options;
  useEffect(() => {
    if (
      !isTauri() ||
      isAndroid ||
      !connected ||
      !selectedDevice ||
      isDevDummyDevice(selectedDevice) ||
      isBusy
    )
      return;

    let active = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const schedulePoll = () => {
      if (!active) return;
      timerId = setTimeout(runPoll, 1500);
    };
    const runPoll = async () => {
      try {
        const scannedDevices = await invoke<DeviceInfo[]>("list_devices");
        if (!active) return;
        if (scannedDevices.some((device) => device.path === selectedDevice)) {
          schedulePoll();
          return;
        }
        try {
          await invoke("disconnect_device", {
            expectedPath: selectedDevice,
            expectedSessionId: connectedSessionIdRef.current,
          });
        } catch (error) {
          if (!active) return;
          console.error("Failed to close disconnected device:", error);
        }
        if (!active) return;
        const expected = Date.now() < expectedRestartUntilRef.current;
        markDeviceLost(
          {
            setConnected,
            setIsReconnecting,
            setLastPushedPeq,
            setFirmwareVersion,
            reportStatus: reportLoss,
          },
          expected
            ? "DAC is restarting; waiting to reconnect"
            : "Lost connection to device",
          "Device",
          expected ? "Info" : "Error",
        );
      } catch {
        schedulePoll();
      }
    };

    schedulePoll();
    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [connected, isAndroid, selectedDevice, isBusy, reportStatus]);

  useEffect(() => {
    const generation = ++reconnectEffectGenerationRef.current;
    if (
      connected ||
      manualDisconnectRef.current ||
      ambiguousReconnectRef.current ||
      isDevDummyDevice(selectedDevice) ||
      isBusy
    )
      return;

    let active = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const isCurrent = () =>
      active && reconnectEffectGenerationRef.current === generation;

    const schedulePoll = (delayMs: number) => {
      if (!isCurrent()) return;
      if (timerId) clearTimeout(timerId);
      if (document.visibilityState === "hidden") return;
      timerId = setTimeout(runPoll, delayMs);
    };

    // Guards against overlap: visibilitychange fires runPoll directly while
    // a scheduled poll may still be in flight.
    let polling = false;
    const runPoll = async () => {
      if (
        !isCurrent() ||
        ambiguousReconnectRef.current ||
        polling ||
        document.visibilityState === "hidden"
      )
        return;
      polling = true;
      try {
        const realDevices = await invoke<DeviceInfo[]>("list_devices");
        if (!isCurrent()) return;
        const deviceList = import.meta.env.DEV
          ? [...realDevices, devPreviewDeviceRef.current]
          : realDevices;
        setDevices(deviceList);

        const targetName = connectedDeviceName || lastConnectedNameRef.current;
        const targetPath = selectedDevice;
        const exactPathMatch = targetPath
          ? realDevices.find((device) => device.path === targetPath)
          : undefined;
        const nameMatches = targetName
          ? realDevices.filter(
              (device) =>
                device.profile_name === targetName ||
                device.product_string === targetName,
            )
          : [];
        const found = chooseReconnectDevice(
          realDevices,
          targetPath,
          targetName,
        );
        if (!exactPathMatch && nameMatches.length > 1) {
          ambiguousReconnectRef.current = true;
          setIsReconnecting(false);
          setShowDeviceModal(true);
          reportStatus({
            level: "Warn",
            message:
              "Multiple matching DACs found; choose the device to reconnect.",
            toastType: "info",
            source: "Device",
            statusText: "Choose a matching DAC to reconnect",
          });
          return;
        }

        if (found && isCurrent()) {
          const devName = found.profile_name || found.product_string || "DAC";
          reportStatus({
            level: "Info",
            message: `Device found: ${devName}. Reconnecting…`,
            toastType: null,
            source: "Device",
            statusText: "Device found. Reconnecting…",
          });
          let openedSessionId: number | null = null;
          connectingPathRef.current = found.path;
          connectingSessionIdRef.current = null;
          try {
            openedSessionId = await invoke<number | null>("connect_device", {
              path: found.path,
            });
            if (!isCurrent()) {
              await invoke("disconnect_device", {
                expectedPath: found.path,
                expectedSessionId: openedSessionId,
              }).catch(() => {});
              return;
            }
            connectedSessionIdRef.current = openedSessionId;

            selectedDeviceRef.current = found.path;
            setSelectedDevice(found.path);
            setConnected(true, found.path);
            if (connectingPathRef.current === found.path) {
              connectingPathRef.current = null;
              connectingSessionIdRef.current = null;
            }
            setConnectedDeviceName(devName);
            lastConnectedNameRef.current = devName;
            setLastPushedPeq(null);
            const connectionGeneration = connectionGenerationRef.current;
            if (settings.auto_pull_on_connect && found.hardware_eq) {
              const pulled = await pullEqRef.current(true, found.path, found);
              if (!pulled && !connectedRef.current) {
                if (openedSessionId !== null) {
                  await invoke("disconnect_device", {
                    expectedPath: found.path,
                    expectedSessionId: openedSessionId,
                  }).catch(() => {});
                }
                return;
              }
              // The read error is already reported; "Connected" after it
              // would read as success.
              if (!pulled) {
                setIsReconnecting(false);
                return;
              }
            } else {
              const constrained = normalizePeq(peqRef.current, {
                integerPreamp: found.integer_preamp,
                capabilities: found,
              });
              if (!peqEquals(constrained, peqRef.current)) {
                pushToUndoStack(peqRef.current);
                setPeq(constrained);
                noteEditorMutation();
                // Retarget the clean baseline with the editor, not just the
                // editor: normalizePeq pads to this DAC's band count but never
                // truncates, and peqEquals calls a length mismatch unequal, so
                // a baseline left in the previous DAC's shape would pin the
                // unsaved-changes flag on for the rest of the session.
                editorCleanPeqRef.current = normalizePeqForDevice(
                  editorCleanPeqRef.current,
                  found,
                );
                setDirty(!peqEquals(constrained, editorCleanPeqRef.current));
                reportStatus({
                  level: "Info",
                  message: "Editor adjusted to DAC limits",
                  toastType: "info",
                  source: "Device",
                });
              }
            }
            await loadFirmwareVersion(found.path, connectionGeneration);
            if (
              connectionGenerationRef.current !== connectionGeneration ||
              connectedPathRef.current !== found.path
            )
              return;
            setIsReconnecting(false);
            reportStatus({
              level: "Info",
              message: `Connected to ${devName}`,
              source: "Device",
              statusText: "Ready",
            });
            return;
          } catch (err) {
            if (openedSessionId !== null) {
              try {
                await invoke("disconnect_device", {
                  expectedPath: found.path,
                  expectedSessionId: openedSessionId,
                }).catch(() => {});
              } catch {}
            }
            if (connectingPathRef.current === found.path) {
              connectingPathRef.current = null;
              connectingSessionIdRef.current = null;
            }
            if (!isCurrent()) return;
            reportStatus({
              level: "Warn",
              message: `Reconnect attempt failed: ${err}. Retrying...`,
              toastType: null,
              source: "Device",
              statusText: "Reconnecting…",
            });
          }
        }
      } catch (error) {
        if (isCurrent()) console.error("Auto-reconnect poll error:", error);
      } finally {
        polling = false;
      }

      schedulePoll(1200);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && isCurrent()) {
        runPoll();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    schedulePoll(600);

    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [
    connected,
    connectedDeviceName,
    selectedDevice,
    isBusy,
    loadFirmwareVersion,
    pushToUndoStack,
    noteEditorMutation,
    reportStatus,
    setConnected,
    settings.auto_pull_on_connect,
  ]);
}
