/**
 * One EQ operation (pull, push, apply, reset, maintenance) at a time.
 *
 *   idle --claim--> inFlight(id) --release(id)--> idle
 *
 * A newer claim supersedes an older one: the older operation's release(id) is
 * then a no-op and returns false, so it cannot clear its successor's state.
 */
export interface EqOperationLock {
  inFlightRef: { current: boolean };
  idRef: { current: number };
}

/** Take the lock and return this operation's id. */
export function claimEqOperation(lock: EqOperationLock): number {
  lock.inFlightRef.current = true;
  return ++lock.idRef.current;
}

/** Release if `id` is still the latest claim. Returns whether it released. */
export function releaseEqOperation(
  lock: EqOperationLock,
  id: number,
): boolean {
  if (lock.idRef.current !== id) return false;
  lock.inFlightRef.current = false;
  return true;
}

/** Whether `id` is still the latest claim (nothing superseded it). */
export const isCurrentEqOperation = (
  lock: EqOperationLock,
  id: number,
): boolean => lock.idRef.current === id;
