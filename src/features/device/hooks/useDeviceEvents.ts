import { useEffect } from "react";
import { invoke, listen } from "@/lib/rpc";

import { isDevDummyDevice } from "@/features/device/lib/devDevice";

import { isTauri } from "@/lib/platform";

import {
  isHandledDeviceDisconnected,
  parseDeviceConnectingPayload,
  parseDeviceDisconnectedPayload,
} from "@/lib/asyncContext";
import type { OperationProgress } from "@/types";

import { markDeviceLost } from "@/features/device/lib/deviceOperations";
import type { DeviceState } from "./useDeviceState";

import type { DeviceSessionOptions } from "./deviceSessionTypes";

export function useDeviceEvents(
  device: DeviceState,
  options: DeviceSessionOptions,
) {
  const {
    reconnectEffectGenerationRef,
    manualDisconnectRef,
    expectedRestartUntilRef,
    connectedRef,
    connectedPathRef,
    connectedSessionIdRef,
    connectingPathRef,
    connectingSessionIdRef,
    connectionGenerationRef,
    handledDisconnectGenerationRef,
    setConnected,
    setIsReconnecting,
    setFirmwareVersion,
    setIsBusy,
    setProgress,
    connectOperationIdRef,
    setLastPushedPeq,
  } = device;
  const { isAndroid, reportStatus, reportLoss } = options;
  useEffect(() => {
    let active = true;
    const unlistenFns: (() => void)[] = [];

    const addListener = <T>(
      event: string,
      callback: (event: { payload: T }) => void,
    ) => {
      listen<T>(event, callback)
        .then((fn) => {
          if (active) unlistenFns.push(fn);
          else
            try {
              fn();
            } catch {}
        })
        .catch((error) => {
          if (active) console.error(`Failed to listen for ${event}:`, error);
        });
    };

    addListener<OperationProgress>("operation-progress", (event) => {
      if (event.payload.message.includes("(restart expected)")) {
        expectedRestartUntilRef.current = Date.now() + 15_000;
      }
      setProgress(event.payload);
    });

    const handleDeviceConnecting = (event: { payload: unknown }) => {
      const payload = parseDeviceConnectingPayload(
        event.payload,
        connectingPathRef.current,
      );
      if (payload && connectingPathRef.current === payload.path) {
        connectingSessionIdRef.current = payload.sessionId;
      }
    };

    const handleDeviceDisconnected = (event: { payload: unknown }) => {
      const activePath = connectedPathRef.current;
      const payload = parseDeviceDisconnectedPayload(event.payload, activePath);
      const connectionGeneration = connectionGenerationRef.current;
      const pendingSessionId = connectingSessionIdRef.current;
      const isPendingConnection =
        !connectedRef.current &&
        payload !== null &&
        connectingPathRef.current === payload.path &&
        (pendingSessionId === null || payload.sessionId === pendingSessionId);
      if (isPendingConnection) {
        // Android can fail its reader before connect_device resolves. Fence
        // that pending attempt instead of dropping the event merely because
        // the connected flag has not flipped yet.
        connectingPathRef.current = null;
        connectingSessionIdRef.current = null;
        connectOperationIdRef.current += 1;
        reconnectEffectGenerationRef.current += 1;
        handledDisconnectGenerationRef.current = connectionGeneration;
        invoke("disconnect_device", {
          expectedPath: payload.path,
          expectedSessionId: payload.sessionId,
        }).catch(() => {});
        markDeviceLost(
          {
            setConnected,
            setIsReconnecting,
            setLastPushedPeq,
            setFirmwareVersion,
            reportStatus: reportLoss,
          },
          `Lost connection while connecting to device: ${payload.name}`,
        );
        setIsBusy(false);
        return;
      }
      if (
        isHandledDeviceDisconnected({
          payload,
          activePath,
          connected: connectedRef.current,
          manualDisconnect: manualDisconnectRef.current,
          devDummy: isDevDummyDevice(activePath ?? ""),
          alreadyHandled:
            handledDisconnectGenerationRef.current === connectionGeneration,
          activeSessionId: connectedSessionIdRef.current,
        })
      ) {
        return;
      }
      if (!payload) return;
      handledDisconnectGenerationRef.current = connectionGeneration;
      invoke("disconnect_device", {
        expectedPath: payload.path,
        expectedSessionId: payload.sessionId,
      }).catch(() => {});
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
          : `Lost connection to device (unplugged): ${payload.name}`,
        "Device",
        expected ? "Info" : "Error",
      );
    };

    addListener<unknown>("device-connecting", handleDeviceConnecting);
    addListener<unknown>("device-disconnected", handleDeviceDisconnected);

    if (isTauri() && isAndroid) {
      import("@tauri-apps/api/core")
        .then(({ addPluginListener }) =>
          addPluginListener<unknown>("hid", "device-disconnected", (payload) =>
            handleDeviceDisconnected({ payload }),
          ),
        )
        .then((listener) => {
          const unlisten = () => {
            listener.unregister().catch(() => {});
          };
          if (active) unlistenFns.push(unlisten);
          else unlisten();
        })
        .catch((error) =>
          console.error("Failed to listen for Android HID disconnects:", error),
        );
    }

    return () => {
      active = false;
      unlistenFns.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
    };
  }, [isAndroid, reportStatus, setConnected]);
}
