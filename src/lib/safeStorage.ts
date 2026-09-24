function storage(): Storage | null {
  try {
    if (typeof window !== "undefined" && "localStorage" in window) {
      return window.localStorage;
    }
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readLocalStorage(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch (error) {
    console.warn(`Unable to read local storage key ${key}`, error);
    return null;
  }
}

export function tryWriteLocalStorage(
  key: string,
  value: string,
): { ok: boolean; error?: unknown } {
  try {
    const store = storage();
    if (!store) return { ok: false, error: new Error("localStorage is unavailable") };
    store.setItem(key, value);
    return { ok: true };
  } catch (error) {
    console.warn(`Unable to write local storage key ${key}`, error);
    return { ok: false, error };
  }
}

export function writeLocalStorage(key: string, value: string): boolean {
  return tryWriteLocalStorage(key, value).ok;
}
