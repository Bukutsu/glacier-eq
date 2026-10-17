import { vi, type Mock } from "vitest";
import { invoke, invokeForDevice, emit, sleep } from "@/lib/rpc";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { buildDefaultState } from "@/features/eq/lib/peq";
import { DEV_DUMMY_DEVICE } from "@/features/device/lib/devDevice";
import { OFFLINE_EDITOR_CAPABILITIES } from "@/features/device/lib/dacSpecs";

// Vitest erases generic call signatures from Mock<T>; preserve them only
// at this transport-double boundary, not in production operation contexts.
export function mockInvoke(value: unknown = undefined) {
  return vi.fn<typeof invoke>().mockResolvedValue(value) as Mock<
    typeof invoke
  > &
    typeof invoke;
}
export function mockInvokeForDevice(value: unknown = undefined) {
  return vi.fn<typeof invokeForDevice>().mockResolvedValue(value) as Mock<
    typeof invokeForDevice
  > &
    typeof invokeForDevice;
}

/** Fresh refs and boundary spies for operation tests; never opens hardware. */
export function operationFixture() {
  const peq = buildDefaultState();
  const operationRevisionRef = { current: 0 };
  const connectionGenerationRef = { current: 1 };
  return {
    includeSimulated: false,
    connected: true,
    isBusy: false,
    dirty: false,
    isMobile: false,
    selectedDevice: "/ja11",
    selectedCapabilities: OFFLINE_EDITOR_CAPABILITIES,
    capabilities: OFFLINE_EDITOR_CAPABILITIES,
    devPreviewDeviceRef: { current: DEV_DUMMY_DEVICE },
    connectedRef: { current: true },
    connectedPathRef: { current: "/ja11" as string | null },
    connectedSessionIdRef: { current: 1 as number | null },
    connectionGenerationRef,
    operationRevisionRef,
    manualDisconnectRef: { current: false },
    quietReconnectRef: { current: true },
    readRecoveryRef: {
      current: { silentUsed: false, inFlight: null as number | null },
    },
    expectedRestartUntilRef: { current: 0 },
    restartWaitIdRef: { current: 0 },
    eqOperationInFlightRef: { current: false },
    eqOperationIdRef: { current: 0 },
    peqRef: { current: peq },
    editorCleanPeqRef: { current: peq },
    getAsyncContext: () => ({
      editorRevision: 0,
      connectionRevision: connectionGenerationRef.current,
      operationRevision: operationRevisionRef.current,
    }),
    noteEditorMutation: vi.fn(),
    setConnected: vi.fn(),
    setDevices: vi.fn(),
    setSelectedDevice: vi.fn(),
    setIsReconnecting: vi.fn(),
    setFirmwareVersion: vi.fn(),
    setLastPushedPeq: vi.fn(),
    setIsBusy: vi.fn(),
    setProgress: vi.fn(),
    setRestartPending: vi.fn(),
    setMaintenancePending: vi.fn(),
    setPeq: vi.fn(),
    setDirty: vi.fn(),
    setSelectedPreset: vi.fn(),
    setProfileSearch: vi.fn(),
    setNewProfileName: vi.fn(),
    pushToUndoStack: vi.fn(),
    reportStatus: vi.fn(),
    reportLoss: vi.fn(),
    setStatus: vi.fn(),
    recoverDeviceRead: vi.fn(async (_path: string, _error: unknown) => false),
    handleExpectedDisconnect: vi.fn(async (_restart?: boolean) => {}),
    pullEq: vi.fn(async () => true),
    invoke: mockInvoke(),
    invokeForDevice: mockInvokeForDevice(),
    emit: vi.fn<typeof emit>().mockResolvedValue(undefined),
    sleep: vi.fn<typeof sleep>().mockResolvedValue(undefined),
    confirmDialog: vi.fn<typeof confirmDialog>().mockResolvedValue(true),
  };
}
