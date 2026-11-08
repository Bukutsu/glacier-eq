import { useCallback, useMemo, useRef, useState } from "react";

import {
  INITIAL_CONNECTION,
  connectedPath,
  connectedSessionId,
  isConnected,
  transition,
  type Connection,
  type ConnectionEvent,
} from "@/features/device/lib/connectionMachine";

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

/** Live read-only view of one connection field; writes go through dispatch. */
interface ReadonlyRef<T> {
  readonly current: T;
}

const view = <T,>(
  ref: { readonly current: Connection },
  read: (state: Connection) => T,
): ReadonlyRef<T> => ({
  get current() {
    return read(ref.current);
  },
});

/**
 * Single owner of connection state (see connectionMachine.ts). The machine
 * lives in a ref so handlers read the latest value synchronously; React state
 * mirrors only the fields that render.
 */
function useConnection() {
  const stateRef = useRef<Connection>(INITIAL_CONNECTION);
  const [rendered, setRendered] = useState({
    connected: false,
    reconnecting: false,
  });
  const dispatch = useCallback((event: ConnectionEvent) => {
    const next = transition(stateRef.current, event);
    if (next === stateRef.current) return;
    stateRef.current = next;
    const connected = isConnected(next);
    const reconnecting = next.intent === "reconnecting";
    setRendered((prev) =>
      prev.connected === connected && prev.reconnecting === reconnecting
        ? prev
        : { connected, reconnecting },
    );
  }, []);
  const [views] = useState(() => ({
    connectedRef: view(stateRef, isConnected),
    connectedPathRef: view(stateRef, connectedPath),
    connectedSessionIdRef: view(stateRef, connectedSessionId),
    connectingPathRef: view(stateRef, (s) => s.pending?.path ?? null),
    connectingSessionIdRef: view(stateRef, (s) => s.pending?.sessionId ?? null),
    connectionGenerationRef: view(stateRef, (s) => s.generation),
    manualDisconnectRef: view(stateRef, (s) => s.intent === "manual"),
    ambiguousReconnectRef: view(stateRef, (s) => s.intent === "ambiguous"),
  }));
  return { dispatch, rendered, views };
}

export function useDeviceState() {
  const reconnectEffectGenerationRef = useRef(0);

  /** Short window for a restart-causing save or JA11 control write. */
  const expectedRestartUntilRef = useRef(0);

  // True while a JA11 is the connected device: its drops are recovered quietly.
  const quietReconnectRef = useRef(false);

  const readRecoveryRef = useRef({
    silentUsed: false,
    inFlight: null as number | null,
  });

  const pullEqRef = useRef<
    (
      afterConnect?: boolean,
      targetPath?: string,
      targetCapabilities?: DeviceCapabilities,
      keepEdits?: boolean,
    ) => Promise<boolean>
  >(async () => false);

  const lastConnectedNameRef = useRef<string>("");

  const [devices, setDevices] = useState<DeviceInfo[]>([]);

  const devPreviewDeviceRef = useRef(DEV_DUMMY_DEVICE);

  const [selectedDevice, setSelectedDevice] = useState("");

  const selectedDeviceRef = useRef(selectedDevice);

  selectedDeviceRef.current = selectedDevice;

  const { dispatch: dispatchConnection, rendered, views } = useConnection();
  const { connected, reconnecting: isReconnecting } = rendered;
  const {
    connectedRef,
    connectedPathRef,
    connectedSessionIdRef,
    connectingPathRef,
    connectingSessionIdRef,
    connectionGenerationRef,
    manualDisconnectRef,
    ambiguousReconnectRef,
  } = views;

  const operationRevisionRef = useRef(0);

  const handledDisconnectGenerationRef = useRef<number | null>(null);

  const linkDown = useCallback(
    () => dispatchConnection({ type: "linkDown" }),
    [dispatchConnection],
  );

  const setIsReconnecting = useCallback(
    (value: boolean) => dispatchConnection({ type: "reconnecting", value }),
    [dispatchConnection],
  );

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

  const [eqLock] = useState(() => ({
    inFlightRef: eqOperationInFlightRef,
    idRef: eqOperationIdRef,
  }));

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

  // Latch the last connected DAC so an unplug that is waiting to reconnect
  // keeps the editor on that DAC's limits instead of flipping to offline ones.
  const lastDeviceInfoRef = useRef<DeviceInfo | undefined>(undefined);
  if (connected && selectedDeviceInfo)
    lastDeviceInfoRef.current = selectedDeviceInfo;

  const reconnecting = isReconnecting && !connected;

  const selectedCapabilities =
    selectedDeviceInfo ?? OFFLINE_EDITOR_CAPABILITIES;

  const capabilities = connected
    ? selectedCapabilities
    : reconnecting && lastDeviceInfoRef.current
      ? lastDeviceInfoRef.current
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
    dispatchConnection,
    connectedRef,
    connectedPathRef,
    connectedSessionIdRef,
    connectingPathRef,
    connectingSessionIdRef,
    connectionGenerationRef,
    operationRevisionRef,
    handledDisconnectGenerationRef,
    linkDown,
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
    eqLock,
    connectOperationIdRef,
    lastPushedPeq,
    setLastPushedPeq,
    selectedDeviceInfo,
    reconnecting,
    selectedCapabilities,
    capabilities,
    hardwareEq,
    maxFilterBands,
    supportsRamApply,
  };
}

export type DeviceState = ReturnType<typeof useDeviceState>;
