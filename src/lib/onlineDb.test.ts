import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCachedDatabase, openDb } from "./onlineDb";

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
    onversionchange: null as ((event: Event) => void) | null,
  };
}

function fire(handler: ((event: Event) => void) | null) {
  handler?.(new Event("mock"));
}

describe("openDb", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    expect(database.close).toHaveBeenCalledOnce();
  });
});
