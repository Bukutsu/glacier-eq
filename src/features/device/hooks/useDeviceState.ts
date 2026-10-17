import { useCallback, useMemo, useRef, useState } from "react";

import {
  DEV_DUMMY_DEVICE,
  isDevDummyDevice,
} from "@/features/device/lib/devDevice";

import type {
  DeviceCapabilities,
  DeviceInfo,
  PEQData,
  OperationProgress,
} from "@/types";

import { OFFLINE_EDITOR_CAPABILITIES } from "@/features/device/lib/dacSpecs";

import { isJa11Device } from "@/features/device/lib/deviceOperations";

export function useDeviceState() {
  const reconnectEffectGenerationRef = useRef(0);

  const manualDisconnectRef = useRef(false);

  /** Short window for a restart-causing save or JA11 control write. */
  const expectedRestartUntilRef = useRef(0);

  // True while a JA11 is the connected device: its drops are recovered quietly.
  const quietReconnectRef = useRef(false);

  const readRecoveryRef = useRef({
    silentUsed: false,
    inFlight: null as number | null,
  });

  const ambiguousReconnectRef = useRef(false);

  const pullEqRef = useRef<
    (
      afterConnect?: boolean,
      targetPath?: string,
      targetCapabilities?: DeviceCapabilities,
    ) => Promise<boolean>
  >(async () => false);

  const lastConnectedNameRef = useRef<string>("");

  const [devices, setDevices] = useState<DeviceInfo[]>([]);

  const devPreviewDeviceRef = useRef(DEV_DUMMY_DEVICE);

  const [selectedDevice, setSelectedDevice] = useState("");

  const selectedDeviceRef = useRef(selectedDevice);

  selectedDeviceRef.current = selectedDevice;

  const [connected, setConnectedState] = useState(false);

  const connectedRef = useRef(false);

  const connectedPathRef = useRef<string | null>(null);

  const connectedSessionIdRef = useRef<number | null>(null);

  const connectingPathRef = useRef<string | null>(null);

  const connectingSessionIdRef = useRef<number | null>(null);

  const connectionGenerationRef = useRef(0);

  const operationRevisionRef = useRef(0);

  const handledDisconnectGenerationRef = useRef<number | null>(null);

  const setConnected = useCallback(
    (nextConnected: boolean, path: string | null = null) => {
      const nextPath = nextConnected ? path : null;
      if (
        connectedRef.current !== nextConnected ||
        connectedPathRef.current !== nextPath
      ) {
        connectionGenerationRef.current += 1;
      }
      connectedRef.current = nextConnected;
      connectedPathRef.current = nextPath;
      if (!nextConnected) connectedSessionIdRef.current = null;
      setConnectedState(nextConnected);
    },
    [],
  );

  const [isReconnecting, setIsReconnecting] = useState(false);

  const [connectedDeviceName, setConnectedDeviceName] = useState("");

  const [firmwareVersion, setFirmwareVersion] = useState<string | null>(null);

  const [operationBusy, setIsBusy] = useState(false);

  const [restartPending, setRestartPending] = useState(false);

  const restartWaitIdRef = useRef(0);

  const [maintenancePending, setMaintenancePending] = useState(false);

  const isBusy = operationBusy || restartPending || maintenancePending;

  const [progress, setProgress] = useState<OperationProgress | null>(null);

  const eqOperationInFlightRef = useRef(false);

  const eqOperationIdRef = useRef(0);

  const connectOperationIdRef = useRef(0);

  const [lastPushedPeq, setLastPushedPeq] = useState<PEQData | null>(null);

  const selectedDeviceInfo = useMemo(
    () => devices.find((device) => device.path === selectedDevice),
    [devices, selectedDevice],
  );

  // Latch the device kind while connected; the device may vanish from the list
  // once it drops, but the reconnect that follows must stay quiet.
  if (connected)
    quietReconnectRef.current =
      !isDevDummyDevice(selectedDevice) && isJa11Device(selectedDeviceInfo);

  const showReconnectOverlay = isReconnecting && !quietReconnectRef.current;

  const selectedCapabilities =
    selectedDeviceInfo ?? OFFLINE_EDITOR_CAPABILITIES;

  const capabilities = connected
    ? selectedCapabilities
    : OFFLINE_EDITOR_CAPABILITIES;

  const hardwareEq = selectedDeviceInfo?.hardware_eq !== false;

  const maxFilterBands = capabilities.num_bands;

  const supportsRamApply = hardwareEq && capabilities.supports_ram_apply;
  return {
    reconnectEffectGenerationRef,
    manualDisconnectRef,
    expectedRestartUntilRef,
    quietReconnectRef,
    readRecoveryRef,
    ambiguousReconnectRef,
    pullEqRef,
    lastConnectedNameRef,
    devices,
    setDevices,
    devPreviewDeviceRef,
    selectedDevice,
    setSelectedDevice,
    selectedDeviceRef,
    connected,
    setConnectedState,
    connectedRef,
    connectedPathRef,
    connectedSessionIdRef,
    connectingPathRef,
    connectingSessionIdRef,
    connectionGenerationRef,
    operationRevisionRef,
    handledDisconnectGenerationRef,
    setConnected,
    isReconnecting,
    setIsReconnecting,
    connectedDeviceName,
    setConnectedDeviceName,
    firmwareVersion,
    setFirmwareVersion,
    operationBusy,
    setIsBusy,
    restartPending,
    setRestartPending,
    restartWaitIdRef,
    maintenancePending,
    setMaintenancePending,
    isBusy,
    progress,
    setProgress,
    eqOperationInFlightRef,
    eqOperationIdRef,
    connectOperationIdRef,
    lastPushedPeq,
    setLastPushedPeq,
    selectedDeviceInfo,
    showReconnectOverlay,
    selectedCapabilities,
    capabilities,
    hardwareEq,
    maxFilterBands,
    supportsRamApply,
  };
}

export type DeviceState = ReturnType<typeof useDeviceState>;
