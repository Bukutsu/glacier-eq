import { i18n } from "@/lib/i18n";
import { useDeviceEvents } from "./useDeviceEvents";
import { useDevicePolling } from "./useDevicePolling";
import type { DeviceSessionOptions } from "./deviceSessionTypes";
import { useMemo, useRef } from "react";
import { createConnectPrimary } from "../operations/connectPrimary";
import { createScanDevices } from "@/features/device/operations/scanDevices";
import { createReadRecovery } from "@/features/device/operations/recoverDeviceRead";
import { createPullEq } from "@/features/device/operations/pullEq";
import { createExpectedRestart } from "@/features/device/operations/handleExpectedDisconnect";
import { createResetDeviceEq } from "@/features/device/operations/resetDeviceEq";
import { createDeviceMaintenanceRunner } from "@/features/device/operations/runDeviceMaintenance";
import { createPushEq } from "@/features/device/operations/pushEq";
import { createApplyProfileToRam } from "@/features/device/operations/applyProfileToRam";
import { useCallback, useEffect } from "react";

import {
  invoke,
  invokeForDevice,
  emit,
  sleep,
  requestWebHidDevice,
} from "@/lib/rpc";

import { confirmDialog } from "@/components/ui/ConfirmDialog";

import {
  readDevDummyPeq,
  reconnectDevDummyDevice,
  isDevDummyDevice,
} from "@/features/device/lib/devDevice";
import {
  normalizePeq,
  normalizePeqForDevice,
  peqEquals,
} from "@/features/eq/lib/peq";
import { isTauri } from "@/lib/platform";
import { isDisconnectionError } from "@/lib/errors";
import { asyncContextEquals, isDisconnectSuperseded } from "@/lib/asyncContext";

import type { DeviceInfo } from "@/types";

import type { DeviceState } from "./useDeviceState";
import type { EqEditor } from "@/features/eq/hooks/useEqEditor";

export function useDeviceSession(
  device: DeviceState,
  editor: EqEditor,
  options: DeviceSessionOptions,
) {
  const { settings, isMobile, reportStatus, reportLoss, setStatus } = options;
  const {
    setIsBusy,
    devPreviewDeviceRef,
    setDevices,
    connectedPathRef,
    connectedRef,
    setSelectedDevice,
    expectedRestartUntilRef,
    setProgress,
    connectingPathRef,
    connectingSessionIdRef,
    connectionGenerationRef,
    connectOperationIdRef,
    reconnectEffectGenerationRef,
    setConnected,
    setIsReconnecting,
    setLastPushedPeq,
    setFirmwareVersion,
    connected,
    manualDisconnectRef,
    connectedSessionIdRef,
    selectedDevice,
    isBusy,
    ambiguousReconnectRef,
    lastConnectedNameRef,
    selectedDeviceRef,
    setConnectedDeviceName,
    pullEqRef,
    capabilities,
    quietReconnectRef,
    readRecoveryRef,
    selectedCapabilities,
    eqOperationInFlightRef,
    operationRevisionRef,
    eqOperationIdRef,
    devices,
    selectedDeviceInfo,
    restartWaitIdRef,
    setRestartPending,
    setMaintenancePending,
  } = device;
  const {
    peqRef,
    pushToUndoStack,
    setPeq,
    noteEditorMutation,
    editorCleanPeqRef,
    setDirty,
    getAsyncContext,
    dirty,
    setSelectedPreset,
    setProfileSearch,
    setNewProfileName,
  } = editor;
  const scanDevices = useMemo(
    () =>
      createScanDevices({
        includeSimulated: import.meta.env.DEV,
        setDevices,
        devPreviewDeviceRef,
        setSelectedDevice,
        connectedRef,
        connectedPathRef,
        setIsBusy,
        reportStatus,
        setStatus,
        invoke,
      }),
    [],
  );

  useDeviceEvents(device, options);

  useEffect(() => {
    // Discover devices quietly; offline editing does not depend on a scan.
    void scanDevices(false);
  }, [scanDevices]);

  // Desktop HID does not emit a detach event, so detect the device disappearing.

  const loadFirmwareVersion = useCallback(
    async (targetPath: string, expectedConnectionGeneration: number) => {
      const isCurrentConnection = () =>
        connectionGenerationRef.current === expectedConnectionGeneration &&
        connectedPathRef.current === targetPath;
      if (isDevDummyDevice(targetPath)) {
        if (isCurrentConnection()) setFirmwareVersion("DEV");
        return;
      }
      try {
        const version = await invoke<string | null>("get_firmware_version");
        if (isCurrentConnection()) setFirmwareVersion(version);
      } catch (error) {
        if (!isCurrentConnection()) return;
        setFirmwareVersion(null);
        reportStatus({
          level: "Warn",
          message: i18n.t("device:useDeviceSession.firmwareReadFailed", {
            error: String(error),
          }),
          toastType: "info",
          source: "Device",
        });
        console.error("Failed to read firmware version:", error);
      }
    },
    [reportStatus],
  );

  // Poll for reconnection / hotplug when disconnected (paused when app is in background, busy, or after explicit manual disconnect)
  useDevicePolling(device, editor, loadFirmwareVersion, options);

  // Close stale handles even if the same USB path has reappeared.
  // One silent-read reopen per explicit connection; never replay mutations.
  const recoverDeviceRead = useMemo(
    () =>
      createReadRecovery({
        manualDisconnectRef,
        quietReconnectRef,
        readRecoveryRef,
        connectedRef,
        connectedPathRef,
        connectedSessionIdRef,
        connectionGenerationRef,
        setConnected,
        setIsReconnecting,
        setFirmwareVersion,
        setLastPushedPeq,
        reportStatus,
        reportLoss,
        invoke,
      }),
    [reportStatus, reportLoss, setConnected],
  );

  const pullEq = useMemo(
    () =>
      createPullEq({
        manualDisconnectRef,
        selectedDevice,
        connected,
        connectedPathRef,
        connectedSessionIdRef,
        connectionGenerationRef,
        operationRevisionRef,
        setConnected,
        setIsReconnecting,
        setFirmwareVersion,
        setIsBusy,
        setProgress,
        eqOperationInFlightRef,
        eqOperationIdRef,
        setLastPushedPeq,
        selectedCapabilities,
        capabilities,
        setPeq,
        dirty,
        setDirty,
        peqRef,
        editorCleanPeqRef,
        noteEditorMutation,
        pushToUndoStack,
        setSelectedPreset,
        setProfileSearch,
        setNewProfileName,
        getAsyncContext,
        reportStatus,
        reportLoss,
        setStatus,
        recoverDeviceRead,
        invoke,
        sleep,
        emit,
        confirmDialog,
      }),
    [
      connected,
      dirty,
      pushToUndoStack,
      selectedDevice,
      selectedCapabilities,
      reportStatus,
      setStatus,
      getAsyncContext,
      noteEditorMutation,
      recoverDeviceRead,
    ],
  );

  useEffect(() => {
    pullEqRef.current = pullEq;
  }, [pullEq]);

  const connectDevice = useCallback(
    async (targetPath?: string, targetInfo?: DeviceInfo): Promise<boolean> => {
      // A manual connect supersedes an in-flight automatic reconnect immediately,
      // before React's effect cleanup or another native open can run.
      reconnectEffectGenerationRef.current += 1;
      manualDisconnectRef.current = false;
      readRecoveryRef.current.silentUsed = false;
      ambiguousReconnectRef.current = false;
      const pathToConnect = targetPath || selectedDevice;
      if (!pathToConnect) return false;
      connectingPathRef.current = pathToConnect;
      connectingSessionIdRef.current = null;
      operationRevisionRef.current += 1;
      const operationId = ++connectOperationIdRef.current;
      const isCurrentConnect = () =>
        operationId === connectOperationIdRef.current;
      let openedSessionId: number | null = null;
      const resolvedTarget =
        targetInfo ?? devices.find((device) => device.path === pathToConnect);
      const targetCapabilities = resolvedTarget ?? selectedCapabilities;
      setIsBusy(true);
      try {
        if (isDevDummyDevice(pathToConnect)) {
          const oldPath = connectedPathRef.current;
          const replacingEdits =
            dirty &&
            (!oldPath ||
              !isDevDummyDevice(oldPath) ||
              devices.find((device) => device.path === oldPath)?.hardware_eq ===
                false ||
              !peqEquals(peqRef.current, readDevDummyPeq(oldPath)));
          const context = getAsyncContext();
          if (
            replacingEdits &&
            !(await confirmDialog({
              title: i18n.t("device:useDeviceSession.switchDacPreview"),
              message: i18n.t(
                "device:useDeviceSession.switchPreviewConfirmation",
              ),
              confirmLabel: i18n.t("device:useDeviceSession.switchPreview"),
            }))
          )
            return false;
          if (
            !isCurrentConnect() ||
            !asyncContextEquals(context, getAsyncContext())
          )
            return false;
          // Switching to a preview releases the real session first. Subsequent
          // controls are path-scoped simulations, never requests to this handle.
          if (
            connectedPathRef.current &&
            !isDevDummyDevice(connectedPathRef.current)
          ) {
            await invoke("disconnect_device", {
              expectedPath: connectedPathRef.current,
              expectedSessionId: connectedSessionIdRef.current,
            });
          }
          if (!isCurrentConnect()) return false;
          if (resolvedTarget) {
            devPreviewDeviceRef.current = resolvedTarget;
            setDevices((current) => [
              ...current.filter((device) => !isDevDummyDevice(device.path)),
              resolvedTarget,
            ]);
          }
          reconnectDevDummyDevice(pathToConnect);
          connectedSessionIdRef.current = null;
          selectedDeviceRef.current = pathToConnect;
          setSelectedDevice(pathToConnect);
          setConnected(true, pathToConnect);
          setLastPushedPeq(null);
          const previewName =
            resolvedTarget?.profile_name ?? "Glacier Dummy DAC";
          setConnectedDeviceName(previewName);
          lastConnectedNameRef.current = previewName;
          reportStatus({
            level: "Info",
            message: i18n.t("device:useDeviceSession.connectedToSimulatedDac"),
            source: "UI",
            statusText: i18n.t(
              "device:useDeviceSession.connectedToSimulatedDac",
            ),
          });
          if (resolvedTarget?.hardware_eq !== false)
            await pullEq(true, pathToConnect, targetCapabilities);
          if (!isCurrentConnect()) return false;
          await loadFirmwareVersion(
            pathToConnect,
            connectionGenerationRef.current,
          );
          return true;
        }

        openedSessionId = await invoke<number | null>("connect_device", {
          path: pathToConnect,
        });
        if (!isCurrentConnect()) {
          if (openedSessionId !== null) {
            await invoke("disconnect_device", {
              expectedPath: pathToConnect,
              expectedSessionId: openedSessionId,
            }).catch(() => {});
          }
          return false;
        }
        connectedSessionIdRef.current = openedSessionId;
        selectedDeviceRef.current = pathToConnect;
        setSelectedDevice(pathToConnect);
        setConnected(true, pathToConnect);
        setLastPushedPeq(null);

        let devName = "";
        const devInfo = resolvedTarget ?? selectedDeviceInfo;
        if (devInfo) {
          devName = devInfo.profile_name ?? devInfo.product_string ?? "";
          setConnectedDeviceName(devName);
          lastConnectedNameRef.current = devName;
        }

        reportStatus({
          level: "Info",
          message: i18n.t("device:useDeviceSession.connectedToDevice", {
            devName: devName,
          }),
          source: "UI",
          statusText: i18n.t("device:useDeviceSession.ready"),
        });

        if (settings.auto_pull_on_connect && devInfo?.hardware_eq !== false) {
          const pulled = await pullEq(true, pathToConnect, targetCapabilities);
          if (!pulled && !connectedRef.current) {
            // A failed auto-pull can mark the UI disconnected while the backend
            // still owns an open HID handle. Close that exact session before
            // returning so a retry cannot inherit a half-initialized device.
            if (openedSessionId !== null) {
              await invoke("disconnect_device", {
                expectedPath: pathToConnect,
                expectedSessionId: openedSessionId,
              }).catch(() => {});
            }
            setConnected(false);
            setConnectedDeviceName("");
            setFirmwareVersion(null);
            return false;
          }
        } else {
          const constrained = normalizePeq(peqRef.current, {
            integerPreamp: targetCapabilities.integer_preamp,
            capabilities: targetCapabilities,
          });
          if (!peqEquals(constrained, peqRef.current)) {
            pushToUndoStack(peqRef.current);
            setPeq(constrained);
            noteEditorMutation();
            // Retarget the clean baseline with the editor, not just the editor:
            // normalizePeq pads to this DAC's band count but never truncates, and
            // peqEquals calls a length mismatch unequal, so a baseline left in the
            // previous DAC's shape would pin the unsaved-changes flag on for the
            // rest of the session.
            editorCleanPeqRef.current = normalizePeqForDevice(
              editorCleanPeqRef.current,
              targetCapabilities,
            );
            setDirty(!peqEquals(constrained, editorCleanPeqRef.current));
            reportStatus({
              level: "Info",
              message: i18n.t(
                "device:useDeviceSession.editorAdjustedToDacLimits",
              ),
              toastType: "info",
              source: "Device",
            });
          }
        }
        await loadFirmwareVersion(
          pathToConnect,
          connectionGenerationRef.current,
        );
        if (!isCurrentConnect()) {
          if (openedSessionId !== null) {
            await invoke("disconnect_device", {
              expectedPath: pathToConnect,
              expectedSessionId: openedSessionId,
            }).catch(() => {});
          }
          return false;
        }
        return true;
      } catch (error) {
        if (!isCurrentConnect()) {
          if (openedSessionId !== null) {
            await invoke("disconnect_device", {
              expectedPath: pathToConnect,
              expectedSessionId: openedSessionId,
            }).catch(() => {});
          }
          return false;
        }
        setConnected(false);
        setLastPushedPeq(null);
        if (!manualDisconnectRef.current && isDisconnectionError(error)) {
          reportStatus({
            level: "Error",
            message: i18n.t(
              "device:useDeviceSession.couldNotConnectDisconnected",
              {
                error: error,
              },
            ),
            toastType: "error",
            source: "UI",
            statusText: i18n.t("device:useDeviceSession.deviceDisconnected"),
          });
        } else {
          const errorMsg = String(error);
          if (errorMsg.includes("NotAllowedError") && !isTauri()) {
            reportStatus({
              level: "Error",
              message: i18n.t("device:useDeviceSession.permissionDenied"),
              toastType: "error",
              source: "UI",
            });
          } else {
            reportStatus({
              level: "Error",
              message: i18n.t("device:useDeviceSession.couldNotConnect", {
                error: error,
              }),
              toastType: "error",
              source: "UI",
            });
          }
        }
        return false;
      } finally {
        if (connectingPathRef.current === pathToConnect) {
          connectingPathRef.current = null;
          connectingSessionIdRef.current = null;
        }
        if (isCurrentConnect()) setIsBusy(false);
      }
    },
    [
      devices,
      selectedDevice,
      pullEq,
      selectedDeviceInfo,
      selectedCapabilities,
      pushToUndoStack,
      loadFirmwareVersion,
      reportStatus,
      settings.auto_pull_on_connect,
      noteEditorMutation,
      dirty,
      getAsyncContext,
    ],
  );

  // Keep the command stable across renders so repeated taps cannot start a
  // second scan while React is updating the busy state.
  const primaryContextRef = useRef({ isBusy, connectDevice });
  primaryContextRef.current = { isBusy, connectDevice };
  const connectPrimary = useMemo(
    () =>
      createConnectPrimary({
        canStart: () =>
          !primaryContextRef.current.isBusy &&
          !connectedRef.current &&
          !connectingPathRef.current &&
          !eqOperationInFlightRef.current,
        setBusy: setIsBusy,
        pauseReconnect: () => {
          reconnectEffectGenerationRef.current += 1;
          ambiguousReconnectRef.current = true;
        },
        authorize: async () => {
          if (!isTauri()) await requestWebHidDevice();
        },
        scan: () => scanDevices(false),
        connect: (path, target) =>
          primaryContextRef.current.connectDevice(path, target),
        showChooser: () => options.setShowDeviceModal(true),
        reportError: (error) =>
          reportStatus({
            level: "Error",
            message: i18n.t("device:deviceChooser.authorizationFailed", {
              err: String(error),
            }),
            toastType: "error",
            source: "Device",
          }),
      }),
    [scanDevices, reportStatus, options.setShowDeviceModal],
  );

  // A JA11 setting write may make the DAC drop off USB briefly. Treat the next
  // 15 s of loss as expected, like a save restart.
  const handleExpectedDisconnect = useMemo(
    () =>
      createExpectedRestart({
        manualDisconnectRef,
        expectedRestartUntilRef,
        connectedPathRef,
        connectedSessionIdRef,
        connectionGenerationRef,
        setConnected,
        setIsReconnecting,
        setFirmwareVersion,
        setRestartPending,
        restartWaitIdRef,
        setLastPushedPeq,
        reportStatus,
        reportLoss,
        invoke,
        sleep,
      }),
    [reportStatus, reportLoss, setConnected],
  );

  const runDeviceMaintenance = useMemo(
    () =>
      createDeviceMaintenanceRunner({
        connectedRef,
        connectedPathRef,
        connectedSessionIdRef,
        connectionGenerationRef,
        eqOperationInFlightRef,
        eqOperationIdRef,
        setMaintenancePending,
        isBusy,
      }),
    [isBusy],
  );

  const resetDeviceEq = useMemo(
    () =>
      createResetDeviceEq({
        connectedRef,
        connectedPathRef,
        connectedSessionIdRef,
        connectionGenerationRef,
        setMaintenancePending,
        isBusy,
        setProgress,
        eqOperationInFlightRef,
        eqOperationIdRef,
        setStatus,
        recoverDeviceRead,
        handleExpectedDisconnect,
        pullEq,
        invokeForDevice,
        confirmDialog,
      }),
    [isBusy, setStatus, pullEq, handleExpectedDisconnect, recoverDeviceRead],
  );

  const handlePreviewChange = useCallback(
    async (device: DeviceInfo) => {
      const currentPath = connectedPathRef.current;
      if (
        isBusy ||
        eqOperationInFlightRef.current ||
        !currentPath ||
        !isDevDummyDevice(currentPath) ||
        !isDevDummyDevice(device.path)
      )
        return;
      await connectDevice(device.path, device);
    },
    [isBusy, connectDevice],
  );

  const handleUdevInstalled = useCallback(async (): Promise<string | null> => {
    manualDisconnectRef.current = false;
    try {
      const realDevices = await invoke<DeviceInfo[]>("list_devices");
      const list = import.meta.env.DEV
        ? [...realDevices, devPreviewDeviceRef.current]
        : realDevices;
      setDevices(list);
      const target = list.find((d) => !isDevDummyDevice(d.path)) ?? list[0];
      if (target) {
        const ok = await connectDevice(target.path, target);
        if (ok) {
          selectedDeviceRef.current = target.path;
          setSelectedDevice(target.path);
          const devName = target.profile_name || target.product_string || "DAC";
          setConnectedDeviceName(devName);
          lastConnectedNameRef.current = devName;
          return devName;
        }
      }
    } catch (e) {
      // The caller (SettingsView) turns a null return into "Permissions
      // installed. Plug in your DAC and it will connect automatically." — so
      // swallowing this made a failed auto-connect read as a success, with no
      // toast and, because useToastStore alone records nothing, no diagnostic
      // anywhere for the user to report.
      const detail = e instanceof Error ? e.message : String(e);
      reportStatus({
        level: "Error",
        message: i18n.t("device:useDeviceSession.udevAutoConnectFailed", {
          error: detail,
        }),
        toastType: "error",
        source: "Device",
      });
    }
    return null;
  }, [connectDevice, reportStatus]);

  const pushEq = useMemo(
    () =>
      createPushEq({
        manualDisconnectRef,
        expectedRestartUntilRef,
        selectedDevice,
        connected,
        connectedPathRef,
        connectedSessionIdRef,
        connectionGenerationRef,
        operationRevisionRef,
        setConnected,
        setIsReconnecting,
        setFirmwareVersion,
        setIsBusy,
        setProgress,
        eqOperationInFlightRef,
        eqOperationIdRef,
        setLastPushedPeq,
        selectedCapabilities,
        capabilities,
        setPeq,
        peqRef,
        noteEditorMutation,
        pushToUndoStack,
        getAsyncContext,
        reportStatus,
        reportLoss,
        setStatus,
        isMobile,
        recoverDeviceRead,
        handleExpectedDisconnect,
        invoke,
        sleep,
        confirmDialog,
      }),
    [
      connected,
      selectedDevice,
      selectedCapabilities,
      reportStatus,
      setStatus,
      getAsyncContext,
      noteEditorMutation,
      pushToUndoStack,
      isMobile,
      handleExpectedDisconnect,
      recoverDeviceRead,
    ],
  );

  const applyProfileToRam = useMemo(
    () =>
      createApplyProfileToRam({
        manualDisconnectRef,
        selectedDevice,
        connectedPathRef,
        connectedSessionIdRef,
        connectionGenerationRef,
        operationRevisionRef,
        setConnected,
        setIsReconnecting,
        setFirmwareVersion,
        setIsBusy,
        setProgress,
        eqOperationInFlightRef,
        eqOperationIdRef,
        setLastPushedPeq,
        capabilities,
        setPeq,
        dirty,
        setDirty,
        peqRef,
        editorCleanPeqRef,
        noteEditorMutation,
        pushToUndoStack,
        setSelectedPreset,
        setProfileSearch,
        setNewProfileName,
        getAsyncContext,
        reportStatus,
        reportLoss,
        recoverDeviceRead,
        invoke,
        sleep,
        confirmDialog,
      }),
    [
      dirty,
      pushToUndoStack,
      selectedDevice,
      capabilities,
      reportStatus,
      noteEditorMutation,
      getAsyncContext,
      recoverDeviceRead,
    ],
  );

  const disconnectDevice = useCallback(async () => {
    if (eqOperationInFlightRef.current) return;
    operationRevisionRef.current += 1;
    setIsBusy(true);
    manualDisconnectRef.current = true;
    lastConnectedNameRef.current = "";
    try {
      if (!isDevDummyDevice(selectedDevice)) {
        await invoke("disconnect_device", {
          expectedPath: connectedPathRef.current,
          expectedSessionId: connectedSessionIdRef.current,
        });
      }
      setConnected(false);
      setIsReconnecting(false);
      setConnectedDeviceName("");
      setLastPushedPeq(null);
      setFirmwareVersion(null);
      reportStatus({
        level: "Info",
        message: i18n.t("device:useDeviceSession.disconnectedFromDevice"),
        toastType: null,
        source: "UI",
        statusText: i18n.t("device:useDeviceSession.disconnected"),
      });
    } catch (error) {
      // The backend releases local state even when closing the transport
      // fails, so the UI must not keep showing a live connection.
      setConnected(false);
      setIsReconnecting(false);
      setConnectedDeviceName("");
      setLastPushedPeq(null);
      setFirmwareVersion(null);
      // A superseded disconnect means this process already moved on to a
      // different connection. That is a clean outcome for the user, not the
      // "releasing the device failed" error.
      if (isDisconnectSuperseded(error)) {
        reportStatus({
          level: "Info",
          message: i18n.t("device:useDeviceSession.disconnectedFromDevice"),
          toastType: null,
          source: "UI",
          statusText: i18n.t("device:useDeviceSession.disconnected"),
        });
      } else {
        reportStatus({
          level: "Error",
          message: i18n.t("device:useDeviceSession.disconnectReleaseFailed", {
            error: error,
          }),
          toastType: "error",
          source: "UI",
          statusText: i18n.t("device:useDeviceSession.disconnected"),
        });
      }
    } finally {
      setIsBusy(false);
    }
  }, [selectedDevice, reportStatus]);
  return {
    connectPrimary,
    scanDevices,
    loadFirmwareVersion,
    recoverDeviceRead,
    pullEq,
    connectDevice,
    handleExpectedDisconnect,
    resetDeviceEq,
    runDeviceMaintenance,
    handlePreviewChange,
    handleUdevInstalled,
    pushEq,
    applyProfileToRam,
    disconnectDevice,
  };
}
