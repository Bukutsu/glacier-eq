import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCachedDatabase,
  deleteDatabase,
  fetchManifest,
  isUnrecoverableDbError,
  loadDeviceCurvePoints,
  openDb,
  subscribeToDatabaseDownload,
} from "./onlineDb";
import { useToastStore } from "../stores/toastStore";

class MockOpenRequest {
  error: DOMException | null = null;
  result: IDBDatabase | undefined;
  onblocked: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onsuccess: ((event: Event) => void) | null = null;
  onupgradeneeded: ((event: Event) => void) | null = null;
}

class MockTransaction {
  error: DOMException | null = null;
  onabort: ((event: Event) => void) | null = null;
  oncomplete: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly clearRequest = {
    onsuccess: null as ((event: Event) => void) | null,
  };
  readonly store = {
    clear: vi.fn(() => this.clearRequest),
  };

  objectStore() {
    return this.store;
  }
}

function mockDatabase() {
  return {
    close: vi.fn(),
    closed: false,
    onversionchange: null as ((event: Event) => void) | null,
    onclose: null as ((event: Event) => void) | null,
  };
}

function fire(handler: ((event: Event) => void) | null) {
  handler?.(new Event("mock"));
}

beforeEach(() => {
  vi.restoreAllMocks();
  useToastStore.setState({ toasts: [], status: "Ready" });
  // Release any shared handle or pending attempt left by the previous test:
  // the connection is module-scoped, so without this every test would keep
  // operating on the previous test's database.
  vi.stubGlobal("indexedDB", {
    deleteDatabase: vi.fn(() => ({
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
    })),
  });
  void deleteDatabase();
});

describe("openDb", () => {
  it("reuses one shared handle for every caller without closing it between uses", async () => {
    const request = new MockOpenRequest();
    const open = vi.fn(() => request);
    vi.stubGlobal("indexedDB", { open });

    const opening = openDb();
    const database = mockDatabase();
    request.result = database as unknown as IDBDatabase;
    fire(request.onsuccess);

    const first = await opening;
    // The second caller joins the already-open connection instead of opening
    // (and later closing) a second handle that would race the first user.
    const second = await openDb();
    expect(second).toBe(first);
    expect(open).toHaveBeenCalledTimes(1);
    expect(database.close).not.toHaveBeenCalled();

    // Version change is the sanctioned close path — it also releases the
    // shared handle so the next openDb() reconnects.
    fire(database.onversionchange);
    expect(database.close).toHaveBeenCalledOnce();

    const secondRequest = new MockOpenRequest();
    open.mockReturnValue(secondRequest);
    const reopening = openDb();
    const freshDatabase = mockDatabase();
    secondRequest.result = freshDatabase as unknown as IDBDatabase;
    fire(secondRequest.onsuccess);
    await expect(reopening).resolves.toBe(freshDatabase);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("reconnects after the browser drops the shared handle abnormally", async () => {
    const request = new MockOpenRequest();
    const open = vi.fn(() => request);
    vi.stubGlobal("indexedDB", { open });

    const opening = openDb();
    const database = mockDatabase();
    request.result = database as unknown as IDBDatabase;
    fire(request.onsuccess);
    await opening;

    // onclose fires when the browser retires the connection without a
    // version change; the dead handle must not be handed out again.
    fire(database.onclose);

    const secondRequest = new MockOpenRequest();
    open.mockReturnValue(secondRequest);
    const reopening = openDb();
    const freshDatabase = mockDatabase();
    secondRequest.result = freshDatabase as unknown as IDBDatabase;
    fire(secondRequest.onsuccess);
    await expect(reopening).resolves.toBe(freshDatabase);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("closes an open that lands after deleteDatabase instead of publishing it", async () => {
    const request = new MockOpenRequest();
    const open = vi.fn(() => request);
    vi.stubGlobal("indexedDB", {
      open,
      deleteDatabase: vi.fn(() => ({
        onsuccess: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onblocked: null as ((event: Event) => void) | null,
      })),
    });

    const opening = openDb();
    // The delete arrives while the open request is still in flight: the
    // connection that lands belongs to the deleted database.
    void deleteDatabase();
    const database = mockDatabase();
    request.result = database as unknown as IDBDatabase;
    fire(request.onsuccess);

    await expect(opening).rejects.toThrow("deleted while opening");
    expect(database.close).toHaveBeenCalledOnce();

    // The next open starts clean against the post-delete database.
    const secondRequest = new MockOpenRequest();
    open.mockReturnValue(secondRequest);
    const reopening = openDb();
    const freshDatabase = mockDatabase();
    secondRequest.result = freshDatabase as unknown as IDBDatabase;
    fire(secondRequest.onsuccess);
    await expect(reopening).resolves.toBe(freshDatabase);
  });

  it("shares a blocked attempt until late success closes its unusable database", async () => {
    const firstRequest = new MockOpenRequest();
    const secondRequest = new MockOpenRequest();
    const open = vi.fn()
      .mockReturnValueOnce(firstRequest)
      .mockReturnValueOnce(secondRequest);
    vi.stubGlobal("indexedDB", { open });

    const first = openDb();
    const joined = openDb();
    expect(joined).toBe(first);
    expect(open).toHaveBeenCalledTimes(1);

    fire(firstRequest.onblocked);
    await expect(first).rejects.toThrow("Database locked");
    await expect(joined).rejects.toThrow("Database locked");

    const retryWhileBlocked = openDb();
    expect(retryWhileBlocked).toBe(first);
    await expect(retryWhileBlocked).rejects.toThrow("Database locked");
    expect(open).toHaveBeenCalledTimes(1);

    const lateDatabase = mockDatabase();
    firstRequest.result = lateDatabase as unknown as IDBDatabase;
    fire(firstRequest.onsuccess);
    expect(lateDatabase.close).toHaveBeenCalledOnce();

    const retry = openDb();
    expect(open).toHaveBeenCalledTimes(2);
    const database = mockDatabase();
    secondRequest.result = database as unknown as IDBDatabase;
    fire(secondRequest.onsuccess);
    await expect(retry).resolves.toBe(database);

    fire(database.onversionchange);
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("allows a new attempt after a blocked request ends with an error", async () => {
    const firstRequest = new MockOpenRequest();
    const secondRequest = new MockOpenRequest();
    const open = vi.fn()
      .mockReturnValueOnce(firstRequest)
      .mockReturnValueOnce(secondRequest);
    vi.stubGlobal("indexedDB", { open });

    const first = openDb();
    fire(firstRequest.onblocked);
    await expect(first).rejects.toThrow("Database locked");

    firstRequest.error = new DOMException("late failure");
    fire(firstRequest.onerror);

    const retry = openDb();
    expect(open).toHaveBeenCalledTimes(2);
    const database = mockDatabase();
    secondRequest.result = database as unknown as IDBDatabase;
    fire(secondRequest.onsuccess);
    await expect(retry).resolves.toBe(database);
  });

  it("automatically recovers from unrecoverable IDB establishment error by deleting and reopening", async () => {
    const firstRequest = new MockOpenRequest();
    const secondRequest = new MockOpenRequest();
    const open = vi.fn()
      .mockReturnValueOnce(firstRequest)
      .mockReturnValueOnce(secondRequest);
    const deleteRequest = {
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
    };
    const deleteDb = vi.fn(() => deleteRequest);
    vi.stubGlobal("indexedDB", { open, deleteDatabase: deleteDb });

    const openAttempt = openDb();
    firstRequest.error = new DOMException("Unable to establish IDB database file", "UnknownError");
    fire(firstRequest.onerror);

    await Promise.resolve();
    expect(deleteDb).toHaveBeenCalledOnce();
    // Deleting the database discards the downloaded curve cache — the
    // reset must reach the user, not only the console.
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toContain("curve cache");
    expect(toasts[0].message).toContain("reset");
    fire(deleteRequest.onsuccess);

    await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(2);

    const database = mockDatabase();
    secondRequest.result = database as unknown as IDBDatabase;
    fire(secondRequest.onsuccess);

    await expect(openAttempt).resolves.toBe(database);
  });

  it("holds the shared slot through recovery so a concurrent open cannot race the delete", async () => {
    const firstRequest = new MockOpenRequest();
    const secondRequest = new MockOpenRequest();
    const open = vi.fn()
      .mockReturnValueOnce(firstRequest)
      .mockReturnValueOnce(secondRequest);
    // Gate the delete so the recovery window between the failed open and
    // the reopen stays open for inspection.
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const deleteRequest = {
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
    };
    const deleteDb = vi.fn(() => {
      void deleteGate.then(() => fire(deleteRequest.onsuccess));
      return deleteRequest;
    });
    vi.stubGlobal("indexedDB", { open, deleteDatabase: deleteDb });

    const firstAttempt = openDb();
    firstRequest.error = new DOMException(
      "Unable to establish IDB database file",
      "UnknownError",
    );
    fire(firstRequest.onerror);
    await Promise.resolve();
    expect(deleteDb).toHaveBeenCalledOnce();

    // Recovery is mid-flight (delete still pending). The old code released
    // pendingOpen at the inner onerror, so this call started a SECOND
    // IndexedDB.open racing the delete — the probe P2 asked for.
    const concurrent = openDb();
    expect(concurrent).toBe(firstAttempt);
    expect(open).toHaveBeenCalledTimes(1);

    releaseDelete();
    await deleteGate;
    await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(2);

    const database = mockDatabase();
    secondRequest.result = database as unknown as IDBDatabase;
    fire(secondRequest.onsuccess);

    await expect(firstAttempt).resolves.toBe(database);
    await expect(concurrent).resolves.toBe(database);
  });

  it("does not delete database on normal or non-unrecoverable errors", async () => {
    const request = new MockOpenRequest();
    const open = vi.fn().mockReturnValue(request);
    const deleteDb = vi.fn();
    vi.stubGlobal("indexedDB", { open, deleteDatabase: deleteDb });

    const openAttempt = openDb();
    request.error = new DOMException("The operation was insecure", "SecurityError");
    fire(request.onerror);

    await expect(openAttempt).rejects.toThrow("The operation was insecure");
    expect(deleteDb).not.toHaveBeenCalled();
  });
});

describe("deleteDatabase", () => {
  it("rejects when the delete is blocked instead of reporting a wipe that did not happen", async () => {
    const deleteRequest = {
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
    };
    vi.stubGlobal("indexedDB", { deleteDatabase: vi.fn(() => deleteRequest) });

    const attempt = deleteDatabase();
    // Another window still holds the database open: the data survives, so
    // callers must not flip to "not downloaded"/"cleared".
    fire(deleteRequest.onblocked);
    await expect(attempt).rejects.toThrow("Database locked by another window");

    // A late success (blocker closed afterwards) must not resurrect the
    // settled promise into a success the caller already treated as failure.
    let lateSettled = false;
    void attempt.then(
      () => { lateSettled = true; },
      () => { lateSettled = true; },
    );
    fire(deleteRequest.onsuccess);
    await Promise.resolve();
    expect(lateSettled).toBe(true);
    await expect(attempt).rejects.toThrow("Database locked by another window");
  });

  it("resolves on success and rejects on delete error", async () => {
    const successRequest = {
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
    };
    vi.stubGlobal("indexedDB", { deleteDatabase: vi.fn(() => successRequest) });
    const success = deleteDatabase();
    fire(successRequest.onsuccess);
    await expect(success).resolves.toBeUndefined();

    const errorRequest = {
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
    };
    vi.stubGlobal("indexedDB", { deleteDatabase: vi.fn(() => errorRequest) });
    const failure = deleteDatabase();
    // Simulate a request that carries a DOMException error.
    const holder = errorRequest as { onerror: ((e: Event) => void) | null; error?: DOMException };
    holder.error = new DOMException("denied", "InvalidStateError");
    fire(holder.onerror);
    await expect(failure).rejects.toThrow("denied");
  });
});

describe("isUnrecoverableDbError", () => {
  it("identifies unrecoverable database file and version errors", () => {
    expect(
      isUnrecoverableDbError(new DOMException("Unable to establish IDB database file", "UnknownError")),
    ).toBe(true);
    expect(isUnrecoverableDbError(new DOMException("Version mismatch", "VersionError"))).toBe(true);
    expect(isUnrecoverableDbError(new Error("Unable to open database file on disk"))).toBe(true);
    expect(isUnrecoverableDbError(new Error("Database corrupt"))).toBe(true);
    expect(isUnrecoverableDbError(new Error("Stored database name does not match requested name"))).toBe(true);

    expect(isUnrecoverableDbError(null)).toBe(false);
    expect(isUnrecoverableDbError(new DOMException("Permission denied", "SecurityError"))).toBe(false);
    expect(isUnrecoverableDbError(new Error("Database locked by another window"))).toBe(false);
    expect(isUnrecoverableDbError(new Error("network failure"))).toBe(false);
  });
});

describe("download subscriptions", () => {
  it("removes one caller's listener without cancelling the shared download", async () => {
    const request = new MockOpenRequest();
    vi.stubGlobal("indexedDB", { open: vi.fn(() => request) });
    const fetchMock = vi.fn().mockRejectedValue(new Error("network failure"));
    vi.stubGlobal("fetch", fetchMock);
    const firstProgress = vi.fn();
    const removedProgress = vi.fn();

    const first = subscribeToDatabaseDownload(firstProgress);
    const joined = subscribeToDatabaseDownload(removedProgress);
    expect(joined.result).toBe(first.result);
    joined.unsubscribe();

    const database = mockDatabase();
    request.result = database as unknown as IDBDatabase;
    fire(request.onsuccess);

    await expect(first.result).rejects.toThrow("network failure");
    await expect(joined.result).rejects.toThrow("network failure");
    expect(firstProgress).toHaveBeenCalledWith(0.05);
    expect(removedProgress).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    // The shared handle outlives the download — closing here would kill the
    // connection under any concurrent reader.
    expect(database.close).not.toHaveBeenCalled();
    first.unsubscribe();
  });
});

describe("clearCachedDatabase", () => {
  it("waits for transaction completion and rejects a late abort", async () => {
    const request = new MockOpenRequest();
    vi.stubGlobal("indexedDB", { open: vi.fn(() => request) });
    const transaction = new MockTransaction();
    const database = {
      close: vi.fn(),
      onversionchange: null,
      transaction: vi.fn(() => transaction),
    };

    const clearing = clearCachedDatabase();
    request.result = database as unknown as IDBDatabase;
    fire(request.onsuccess);
    await Promise.resolve();

    let settled = false;
    void clearing.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    fire(transaction.clearRequest.onsuccess);
    await Promise.resolve();
    expect(settled).toBe(false);

    fire(transaction.onabort);
    await expect(clearing).rejects.toThrow("Transaction aborted");
    // Clearing uses the shared handle; it stays open for everyone else.
    expect(database.close).not.toHaveBeenCalled();
  });

  it("deletes and recovers when opening fails with an unrecoverable establishment error", async () => {
    const request = new MockOpenRequest();
    const open = vi.fn().mockReturnValue(request);
    const deleteRequest = {
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
    };
    const deleteDb = vi.fn(() => deleteRequest);
    vi.stubGlobal("indexedDB", { open, deleteDatabase: deleteDb });

    const clearing = clearCachedDatabase();
    request.error = new DOMException("Unable to establish IDB database file", "UnknownError");
    fire(request.onerror);

    await Promise.resolve();
    expect(deleteDb).toHaveBeenCalledOnce();
    fire(deleteRequest.onsuccess);

    // Let the recovery path re-arm the open request before its success
    // lands — the second requestOpenDb() owns the resolving handlers now.
    await Promise.resolve();

    // The reopen after the reset succeeds and clearing proceeds on the
    // recovered shared connection without ever closing it.
    const transaction = new MockTransaction();
    const database = {
      close: vi.fn(),
      closed: false,
      onversionchange: null,
      transaction: vi.fn(() => transaction),
    };
    request.result = database as unknown as IDBDatabase;
    fire(request.onsuccess);
    await Promise.resolve();
    await Promise.resolve();

    fire(transaction.oncomplete);
    await expect(clearing).resolves.toBeUndefined();
    expect(database.close).not.toHaveBeenCalled();
  });
});

describe("download cache safety (generation swap)", () => {
  const manifestFixture = {
    iems: {
      "source::Example One": { price: 99 },
      "source::Example Two": { price: null },
    },
  };
  const curvesFixture = {
    meta: { frequencies: [20, 1000, 20000] },
    curves: {
      "source::Example One": { d: [1, 2, 3] },
      "source::Example Two": { d: [-1, 0, 1] },
    },
  };

  // Minimal in-memory store: transactions apply their writes and complete on
  // a microtask (after the caller has synchronously assigned its handlers),
  // matching IDB's promise-friendly event ordering. A transaction stays alive
  // while requests are in flight and completes only once none remain — the
  // model that lets code chain validation requests inside onsuccess handlers
  // (the publish fence) behave as it does in a browser. `abortWritesFor` makes
  // the transaction that writes that key abort instead — the quota case.
  class MemoryStore {
    records = new Map<string, unknown>();
    clearCalls = 0;
    abortWritesFor: string | null = null;
    // Test seam: fired right after a get() succeeds — lets a test simulate
    // another window committing between this store's reads.
    afterGet: ((key: string) => void) | null = null;

    transaction() {
      const store = this;
      const pending: Array<() => void> = [];
      let abortWith: Error | null = null;
      let outstanding = 0;
      let settled = false;

      const request = <T>(value: T, key?: string) => {
        outstanding += 1;
        const req = {
          result: value,
          error: null,
          onsuccess: null as ((event: Event) => void) | null,
          onerror: null as ((event: Event) => void) | null,
        };
        queueMicrotask(() => {
          outstanding -= 1;
          req.onsuccess?.(new Event("mock"));
          if (key !== undefined) store.afterGet?.(key);
        });
        return req;
      };

      const settle = (): void => {
        queueMicrotask(() => {
          if (settled) return;
          if (outstanding > 0) {
            settle();
            return;
          }
          settled = true;
          if (abortWith) {
            tx.error = abortWith;
            tx.onabort?.(new Event("mock"));
            return;
          }
          for (const apply of pending) apply();
          tx.oncomplete?.(new Event("mock"));
        });
      };

      const tx = {
        error: null as Error | null,
        oncomplete: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onabort: null as ((event: Event) => void) | null,
        abort: () => {
          abortWith ??= new Error("The operation was aborted.");
        },
        objectStore: () => ({
          put: (value: unknown, key?: string) => {
            if (typeof key !== "string") throw new Error("fixture requires explicit keys");
            if (store.abortWritesFor === key) {
              abortWith = new DOMException("Quota exceeded", "QuotaExceededError");
            }
            pending.push(() => store.records.set(key, value));
            return { onsuccess: null, onerror: null };
          },
          delete: (key: string) => {
            // Same seam as put: a transaction that writes the poisoned key
            // aborts entirely — used by the sweep-failure test.
            if (store.abortWritesFor === key) {
              abortWith = new DOMException("Quota exceeded", "QuotaExceededError");
            }
            pending.push(() => store.records.delete(key));
            return { onsuccess: null, onerror: null };
          },
          get: (key: string) => request(store.records.get(key), key),
          getAllKeys: () => request([...store.records.keys()]),
          clear: () => {
            store.clearCalls += 1;
            pending.push(() => store.records.clear());
            return { onsuccess: null, onerror: null };
          },
        }),
      };
      settle();
      return tx;
    }
  }

  function jsonResponse(value: unknown) {
    const json = JSON.stringify(value);
    return {
      ok: true,
      status: 200,
      statusText: "",
      headers: new Headers({ "content-length": String(json.length) }),
      body: null,
      text: async () => json,
    };
  }

  function stubFetch(behavior: "ok" | "curves-fail") {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("manifest.json")) return jsonResponse(manifestFixture);
      if (behavior === "ok") return jsonResponse(curvesFixture);
      throw new Error("network failure");
    }));
  }

  function startDownload(
    store: MemoryStore,
    onProgress: (percent: number) => void = vi.fn(),
  ): Promise<number> {
    const openRequest = new MockOpenRequest();
    vi.stubGlobal("indexedDB", { open: vi.fn(() => openRequest) });
    const subscription = subscribeToDatabaseDownload(onProgress);
    const database = {
      close: vi.fn(),
      closed: false,
      onversionchange: null,
      onclose: null,
      transaction: vi.fn(() => store.transaction()),
    };
    openRequest.result = database as unknown as IDBDatabase;
    fire(openRequest.onsuccess);
    return subscription.result;
  }

  function seedLiveGenerationOne(store: MemoryStore) {
    store.records.set("meta:gen", 1);
    store.records.set("gen:1:complete", true);
    store.records.set("gen:1:manifest", { iems: {} });
    store.records.set("gen:1:frequencies", [20, 1000, 20000]);
    store.records.set("gen:1:source::Old Device", [9, 9, 9]);
  }

  // Wire the shared handle to this store's database so reader functions
  // (which call openDb() themselves) operate on the fixture.
  async function connectStore(store: MemoryStore): Promise<void> {
    const openRequest = new MockOpenRequest();
    vi.stubGlobal("indexedDB", { open: vi.fn(() => openRequest) });
    const opening = openDb();
    const database = {
      close: vi.fn(),
      closed: false,
      onversionchange: null,
      onclose: null,
      transaction: vi.fn(() => store.transaction()),
    };
    openRequest.result = database as unknown as IDBDatabase;
    fire(openRequest.onsuccess);
    await opening;
  }

  // Simulate another window finishing its download (publish gen N+1) and
  // sweeping the generation the reader just pointed at.
  function strandAfterPointerRead(store: MemoryStore) {
    let fired = false;
    store.afterGet = (key) => {
      if (key !== "meta:gen" || fired) return;
      fired = true;
      store.records.set("meta:gen", 2);
      store.records.set("gen:2:complete", true);
      store.records.set("gen:2:manifest", { iems: {} });
      store.records.set("gen:2:frequencies", [20, 1000, 20000]);
      for (const existing of [...store.records.keys()]) {
        if (existing.startsWith("gen:1:")) store.records.delete(existing);
      }
    };
  }

  it("leaves the live cache untouched when a fetch fails before any write", async () => {
    const store = new MemoryStore();
    seedLiveGenerationOne(store);
    const before = structuredClone(store.records);
    stubFetch("curves-fail");

    await expect(startDownload(store)).rejects.toThrow("network failure");

    expect(store.records).toEqual(before);
    expect(store.clearCalls).toBe(0);
  });

  it("keeps the previous cache when a chunk transaction hits quota mid-download", async () => {
    const store = new MemoryStore();
    seedLiveGenerationOne(store);
    stubFetch("ok");
    // Abort the curve chunk: the manifest and frequencies of the NEW
    // generation have already been written at this point.
    store.abortWritesFor = "gen:2:source::Example One";

    await expect(startDownload(store)).rejects.toThrow(/Quota exceeded/);

    // No publish flip: readers still see the complete first generation, and
    // the old code's clear-before-rewrite would have destroyed it here.
    expect(store.records.get("meta:gen")).toBe(1);
    expect(store.records.get("gen:1:complete")).toBe(true);
    expect(store.records.get("gen:1:manifest")).toEqual({ iems: {} });
    expect(store.records.get("gen:1:source::Old Device")).toEqual([9, 9, 9]);
    expect(store.clearCalls).toBe(0);
  });

  it("publishes a completed download atomically and sweeps superseded keys", async () => {
    const store = new MemoryStore();
    // Legacy-layout cache from a pre-generation app version.
    store.records.set("meta:complete", true);
    store.records.set("meta:manifest", { iems: {} });
    store.records.set("meta:frequencies", [100]);
    store.records.set("source::Legacy Device", [5, 5, 5]);
    stubFetch("ok");

    await expect(startDownload(store)).resolves.toEqual({
      entries: 2,
      sweepFailed: false,
    });

    // Published state: meta:gen and the completeness flag land together.
    expect(store.records.get("meta:gen")).toBe(1);
    expect(store.records.get("gen:1:complete")).toBe(true);
    expect(store.records.get("gen:1:frequencies")).toEqual([20, 1000, 20000]);
    expect(store.records.get("gen:1:source::Example One")).toEqual([1, 2, 3]);
    expect(store.records.get("gen:1:source::Example Two")).toEqual([-1, 0, 1]);

    // The legacy generation was swept after the publish, never before.
    expect(store.records.has("meta:complete")).toBe(false);
    expect(store.records.has("meta:manifest")).toBe(false);
    expect(store.records.has("meta:frequencies")).toBe(false);
    expect(store.records.has("source::Legacy Device")).toBe(false);
    expect(store.clearCalls).toBe(0);
  });

  it("refuses to publish a generation another window cleared during the download", async () => {
    const store = new MemoryStore();
    seedLiveGenerationOne(store);
    stubFetch("ok");
    // After the first chunk lands (progress 0.85), another window clears the
    // whole store before this window reaches its publish transaction.
    let cleared = false;
    const download = startDownload(store, (percent) => {
      if (percent >= 0.85 && !cleared) {
        cleared = true;
        void clearCachedDatabase();
      }
    });

    await expect(download).rejects.toThrow(/cleared during the download/);

    // No torn "complete": without the fence the old publish wrote
    // meta:gen + complete over the wiped store, leaving a generation no
    // reader can use while isDatabaseDownloaded() answered true.
    expect(store.records.has("meta:gen")).toBe(false);
    expect(store.records.has("gen:2:complete")).toBe(false);
    expect(store.records.has("gen:2:manifest")).toBe(false);
    expect(store.clearCalls).toBe(1);
  });

  it("does not rewind the pointer when another window published a newer generation mid-download", async () => {
    const store = new MemoryStore();
    seedLiveGenerationOne(store);
    stubFetch("ok");
    // Another window finishes ITS download (generation 9 goes live) while
    // this window — based on generation 1 — is still writing chunks.
    let advanced = false;
    const download = startDownload(store, (percent) => {
      if (percent >= 0.85 && !advanced) {
        advanced = true;
        store.records.set("meta:gen", 9);
        store.records.set("gen:9:complete", true);
        store.records.set("gen:9:manifest", { iems: {} });
        store.records.set("gen:9:frequencies", [20, 1000, 20000]);
        store.records.set("gen:9:source::Ahead Window", [7, 7, 7]);
      }
    });

    await expect(download).rejects.toThrow(/updated by another window/);

    // The newer generation stays authoritative; our older flip never commits.
    expect(store.records.get("meta:gen")).toBe(9);
    expect(store.records.get("gen:9:complete")).toBe(true);
    expect(store.records.get("gen:9:source::Ahead Window")).toEqual([7, 7, 7]);
    expect(store.records.has("gen:2:complete")).toBe(false);
    expect(store.clearCalls).toBe(0);
  });

  it("spares a newer in-flight generation from another window when sweeping", async () => {
    const store = new MemoryStore();
    seedLiveGenerationOne(store);
    // A window ahead of this one is mid-download writing generation 7.
    store.records.set("gen:7:manifest", { iems: {} });
    store.records.set("gen:7:source::Ahead Window", [7, 7, 7]);
    stubFetch("ok");

    await expect(startDownload(store)).resolves.toEqual({
      entries: 2,
      sweepFailed: false,
    });

    expect(store.records.get("meta:gen")).toBe(2);
    expect(store.records.get("gen:2:complete")).toBe(true);
    // The higher generation is NOT superseded by our older publish — the old
    // filter deleted every non-live key, eating the other window's chunks and
    // publishing holes for it.
    expect(store.records.get("gen:7:manifest")).toEqual({ iems: {} });
    expect(store.records.get("gen:7:source::Ahead Window")).toEqual([7, 7, 7]);
    // Superseded and legacy keys are still swept.
    expect(store.records.has("gen:1:complete")).toBe(false);
    expect(store.records.has("gen:1:manifest")).toBe(false);
    expect(store.records.has("gen:1:source::Old Device")).toBe(false);
  });

  it("reports a failed sweep on the resolved result instead of unqualified success", async () => {
    const store = new MemoryStore();
    seedLiveGenerationOne(store);
    stubFetch("ok");
    // The sweep's delete transaction aborts (quota, private-mode eviction).
    store.abortWritesFor = "gen:1:manifest";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // The download still resolves — the cache IS published and readable —
    // but the result carries the cleanup failure so the caller can say so.
    await expect(startDownload(store)).resolves.toEqual({
      entries: 2,
      sweepFailed: true,
    });

    expect(store.records.get("meta:gen")).toBe(2);
    expect(store.records.get("gen:2:complete")).toBe(true);
    // The aborted sweep discarded every pending delete: superseded keys
    // remain until a later download retries — which the caller now knows.
    expect(store.records.get("gen:1:manifest")).toEqual({ iems: {} });
    expect(store.records.has("gen:1:complete")).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to sweep superseded online database records:",
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("fetches the manifest from the same snapshot as the pointer, even when another window publishes mid-read", async () => {
    const store = new MemoryStore();
    seedLiveGenerationOne(store);
    store.records.set("gen:1:manifest", manifestFixture);
    await connectStore(store);
    // Fires right after the reader observes meta:gen: generation 1 is swept
    // and generation 2 published before the reader would fetch its records —
    // exactly the split-transaction strand.
    strandAfterPointerRead(store);

    // Single transaction: records resolve from the pointer's own snapshot
    // instead of throwing "Search manifest not cached" against a store where
    // the swept generation's keys are gone.
    await expect(fetchManifest()).resolves.toEqual([
      { id: "source::Example One", brand: "Example", name: "One", price: 99, source: "source" },
      { id: "source::Example Two", brand: "Example", name: "Two", price: null, source: "source" },
    ]);
  });

  it("loads curve points from the same snapshot as the pointer, even when another window publishes mid-read", async () => {
    const store = new MemoryStore();
    seedLiveGenerationOne(store);
    store.records.set("gen:1:source::Example One", [1, 2, 3]);
    await connectStore(store);
    strandAfterPointerRead(store);

    // The split-transaction version read the pointer in tx1, then looked for
    // gen:1 keys in tx2 — post-sweep — and rejected with "Curve not found"
    // while a complete cache sat right there.
    const points = await loadDeviceCurvePoints("source::Example One");
    expect(points).toHaveLength(3);
    expect(points.map((point) => point.freq)).toEqual([20, 1000, 20000]);
    // normalizeMeasurementPoints re-references to 1000 Hz: [1, 2, 3] dB
    // becomes [-1, 0, 1]. The assertion that discriminates is that the load
    // RESOLVED at all — the split-transaction version rejected with
    // "Curve not found" here.
    expect(points.map((point) => point.db)).toEqual([-1, 0, 1]);
  });
});
