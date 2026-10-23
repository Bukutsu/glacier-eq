// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

// Session-only editor policy; changing the destination does not touch the DAC.
// Every write carries its destination explicitly, including after a reconnect.
const destinations = new Map<string, number>();
export function getMelodySlot(path: string): number {
  return destinations.get(path) ?? 160;
}
export function setMelodySlot(path: string, slot: number): void {
  if (![160, 161, 162].includes(slot))
    throw new Error("Invalid Melody USER slot");
  destinations.set(path, slot);
}
export function melodySlotArgs(path: string): Record<string, number> {
  return destinations.has(path) ? { melody_slot: getMelodySlot(path) } : {};
}
