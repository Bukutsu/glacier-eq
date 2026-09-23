import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCachedDatabase,
  deleteDatabase,
  isUnrecoverableDbError,
  openDb,
  subscribeToDatabaseDownload,
} from "./onlineDb";

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
    fire(deleteRequest.onsuccess);

    await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(2);

    const database = mockDatabase();
    secondRequest.result = database as unknown as IDBDatabase;
    fire(secondRequest.onsuccess);

    await expect(openAttempt).resolves.toBe(database);
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
