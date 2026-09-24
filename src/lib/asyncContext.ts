export interface AsyncContext {
  editorRevision: number;
  connectionRevision: number;
  operationRevision: number;
}

export interface DeviceDisconnectedPayload {
  path: string;
  name: string;
  sessionId?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asyncContextEquals(a: AsyncContext, b: AsyncContext): boolean {
  return a.editorRevision === b.editorRevision &&
    a.connectionRevision === b.connectionRevision &&
    a.operationRevision === b.operationRevision;
}

export function parseDeviceDisconnectedPayload(
  value: unknown,
  expectedPath: string | null,
): DeviceDisconnectedPayload | null {
  if (isRecord(value)) {
    const { path, name, session_id: sessionId } = value;
    if (
      typeof path !== "string" ||
      path.length === 0 ||
      typeof name !== "string" ||
      (sessionId !== undefined && (typeof sessionId !== "number" || !Number.isSafeInteger(sessionId)))
    ) {
      return null;
    }
    return {
      path,
      name: name || path,
      ...(typeof sessionId === "number" ? { sessionId } : {}),
    };
  }

  // Older emitters sent only a string. It is safe to accept that payload only
  // when it identifies the active path. A display name cannot identify a
  // connection and may arrive after another device has connected.
  if (typeof value === "string" && expectedPath !== null && value === expectedPath) {
    return { path: value, name: value };
  }

  return null;
}

export function isHandledDeviceDisconnected(options: {
  payload: DeviceDisconnectedPayload | null;
  activePath: string | null;
  connected: boolean;
  manualDisconnect: boolean;
  devDummy: boolean;
  alreadyHandled: boolean;
  activeSessionId?: number | null;
}): boolean {
  const { payload, activePath, connected, manualDisconnect, devDummy, alreadyHandled, activeSessionId } = options;
  return (
    payload === null ||
    payload.path !== activePath ||
    (payload.sessionId !== undefined
      && activeSessionId !== null
      && activeSessionId !== undefined
      && payload.sessionId !== activeSessionId) ||
    manualDisconnect ||
    devDummy ||
    alreadyHandled ||
    !connected
  );
}
