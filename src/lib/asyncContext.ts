export interface AsyncContext {
  editorRevision: number;
  connectionRevision: number;
}

export interface DeviceDisconnectedPayload {
  path: string;
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asyncContextEquals(a: AsyncContext, b: AsyncContext): boolean {
  return a.editorRevision === b.editorRevision &&
    a.connectionRevision === b.connectionRevision;
}

export function parseDeviceDisconnectedPayload(
  value: unknown,
  expectedPath: string | null,
): DeviceDisconnectedPayload | null {
  if (isRecord(value)) {
    const { path, name } = value;
    if (
      typeof path !== "string" ||
      path.length === 0 ||
      typeof name !== "string"
    ) {
      return null;
    }
    return { path, name: name || path };
  }

  // Older emitters sent only a string. It is safe to accept that payload only
  // when it identifies the active path. A display name cannot identify a
  // connection and may arrive after another device has connected.
  if (typeof value === "string" && expectedPath !== null && value === expectedPath) {
    return { path: value, name: value };
  }

  return null;
}
