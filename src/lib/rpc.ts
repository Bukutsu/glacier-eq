// Runtime-selected application interface.
// Vite and TypeScript map this module to the desktop or web adapter per build.
export * from "@glacier-eq/backend";

import { invoke as invokeBackend } from "@glacier-eq/backend";
import {
  isDevDummyPath,
  invokeDevDummy,
} from "@/features/device/lib/devDevice";

// Bind hardware-screen actions to their displayed device. A virtual path must
// never fall through to a physical HID backend, even for unsupported commands.
export async function invokeForDevice<T = unknown>(
  path: string | undefined,
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (path && isDevDummyPath(path))
    return invokeDevDummy<T>(path, command, args);
  return invokeBackend<T>(command, args);
}
