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

export type ScheduledTask = (isCurrent: () => boolean) => Promise<void>;

export interface CoalescingTaskScheduler<K> {
  enqueue: (
    key: K,
    task: ScheduledTask,
    options?: { supersedePending?: boolean },
  ) => void;
  invalidate: () => void;
  pendingCount: () => number;
  whenIdle: () => Promise<void>;
}

export function createCoalescingTaskScheduler<K>(): CoalescingTaskScheduler<K> {
  type Entry = { key: K; task: ScheduledTask; generation: number };

  let generation = 0;
  let running = false;
  const pending = new Map<K, Entry>();
  const order: K[] = [];
  const idleWaiters: Array<() => void> = [];

  const settleIdle = () => {
    if (running || order.length > 0) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  };

  const drain = () => {
    if (running) return;
    const key = order.shift();
    if (key === undefined) {
      settleIdle();
      return;
    }
    const entry = pending.get(key);
    pending.delete(key);
    if (!entry || entry.generation !== generation) {
      drain();
      return;
    }

    running = true;
    const taskGeneration = entry.generation;
    void Promise.resolve()
      .then(() => entry.task(() => taskGeneration === generation))
      .catch(() => undefined)
      .finally(() => {
        running = false;
        drain();
      });
  };

  return {
    enqueue(key, task, options) {
      if (options?.supersedePending) {
        pending.clear();
        order.splice(0);
      } else if (pending.has(key)) {
        const oldPosition = order.indexOf(key);
        if (oldPosition >= 0) order.splice(oldPosition, 1);
      }
      pending.set(key, { key, task, generation });
      order.push(key);
      drain();
    },
    invalidate() {
      generation += 1;
      pending.clear();
      order.splice(0);
      settleIdle();
    },
    pendingCount() {
      return order.length;
    },
    whenIdle() {
      if (!running && order.length === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}

export function mergeFieldsAtUnchangedRevisions<T extends object>(
  current: T,
  incoming: T,
  revisionsAtStart: Partial<Record<keyof T, number>>,
  currentRevisions: Partial<Record<keyof T, number>>,
): T {
  let merged = current;
  for (const field of Object.keys(incoming) as Array<keyof T>) {
    if ((revisionsAtStart[field] ?? 0) === (currentRevisions[field] ?? 0)) {
      merged = setField(merged, field, incoming[field]);
    }
  }
  return merged;
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
