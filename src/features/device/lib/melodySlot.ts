// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

// Session-only editor policy; changing the destination does not touch the DAC.
// Every write carries its destination explicitly, including after a reconnect.
export interface MelodySaveRequest {
  path: string;
  count: number;
  preamp: string;
}

export interface UserBankSaveRequest extends MelodySaveRequest {
  slots: number[];
  isMelody: boolean;
}

export interface MelodyBankChoice {
  slot: number;
  /** The chooser's action already confirmed overwriting this bank. */
  confirmed: boolean;
}

export type ChooseMelodyBank = (
  request: UserBankSaveRequest,
) => Promise<MelodyBankChoice | null>;
export type ChooseUserBank = ChooseMelodyBank;

const destinations = new Map<string, number>();
export function getUserEqSlot(path: string): number | undefined {
  return destinations.get(path);
}
export function setUserEqSlot(
  path: string,
  slot: number,
  allowedSlots: readonly number[],
): void {
  if (!allowedSlots.includes(slot))
    throw new Error("Invalid user EQ bank for this device");
  destinations.set(path, slot);
}
export function clearUserEqSlot(path: string): void {
  destinations.delete(path);
}
export function userEqSlotArgs(path: string): Record<string, number> {
  return destinations.has(path) ? { fiio_slot: destinations.get(path)! } : {};
}

export function getMelodySlot(path: string): number {
  return getUserEqSlot(path) ?? 160;
}
export function melodySlotArgs(path: string): Record<string, number> {
  return destinations.has(path) ? { melody_slot: getMelodySlot(path) } : {};
}
