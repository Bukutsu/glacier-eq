import type { AppSettings } from "../types";
import { createSerialTaskQueue } from "./serializedWrites";

/** Keep optimistic edits local until the persisted base is known. */
export function createSettingsPersistence(options: {
  defaults: AppSettings;
  load: () => Promise<AppSettings>;
  save: (settings: AppSettings) => Promise<void>;
  onChange: (settings: AppSettings) => void;
  onError: (operation: "load" | "save", error: unknown) => void;
}) {
  let current = options.defaults;
  let edits: Partial<AppSettings> = {};
  let hydrated = false;
  let loading: Promise<void> | null = null;
  const enqueue = createSerialTaskQueue();

  const persist = (snapshot: AppSettings) => enqueue(() => options.save(snapshot))
    .catch((error: unknown) => options.onError("save", error));

  const load = (): Promise<void> => {
    if (hydrated) return Promise.resolve();
    if (loading) return loading;
    loading = Promise.resolve().then(options.load).then(async (stored) => {
      const hasEdits = Object.keys(edits).length > 0;
      current = { ...options.defaults, ...stored, ...edits };
      edits = {};
      hydrated = true;
      options.onChange(current);
      if (hasEdits) await persist(current);
    }).catch((error: unknown) => {
      // Never overwrite unknown stored fields with defaults on a failed read.
      // Keep edits for a later retry (including the next user change).
      options.onError("load", error);
    }).finally(() => {
      loading = null;
    });
    return loading;
  };

  return {
    load,
    update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
      current = { ...current, [key]: value };
      options.onChange(current);
      if (hydrated) return persist(current);
      edits[key] = value;
      return load();
    },
  };
}
