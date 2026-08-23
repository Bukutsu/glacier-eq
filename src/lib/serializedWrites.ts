export type SerialTaskQueue = <T>(task: () => Promise<T>) => Promise<T>;

export function createSerialTaskQueue(): SerialTaskQueue {
  let tail = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export function setField<T extends object, K extends keyof T>(
  state: T,
  field: K,
  value: T[K],
): T {
  return { ...state, [field]: value };
}

export function revertFieldIfCurrent<T extends object, K extends keyof T>(
  current: T,
  confirmed: T,
  field: K,
  failedRevision: number,
  currentRevision: number,
): T {
  return failedRevision === currentRevision
    ? setField(current, field, confirmed[field])
    : current;
}
