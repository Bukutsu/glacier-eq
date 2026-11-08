import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INITIAL_CONNECTION,
  connectedPath,
  connectedSessionId,
  isConnected,
  transition,
  type Connection,
  type ConnectionEvent,
} from "../src/features/device/lib/connectionMachine.ts";

const run = (events: ConnectionEvent[], from: Connection = INITIAL_CONNECTION) =>
  events.reduce(transition, from);

test("linkUp sets path and session atomically and bumps generation", () => {
  const s = run([{ type: "linkUp", path: "a", sessionId: 7 }]);
  assert.equal(isConnected(s), true);
  assert.equal(connectedPath(s), "a");
  assert.equal(connectedSessionId(s), 7);
  assert.equal(s.generation, 1);
});

test("linkUp on the same path keeps generation; a new path bumps it", () => {
  const up = run([{ type: "linkUp", path: "a", sessionId: 1 }]);
  const same = transition(up, { type: "linkUp", path: "a", sessionId: 2 });
  assert.equal(same.generation, up.generation);
  assert.equal(connectedSessionId(same), 2);
  const moved = transition(up, { type: "linkUp", path: "b", sessionId: 3 });
  assert.equal(moved.generation, up.generation + 1);
});

test("linkDown clears path and session; no-op when already down", () => {
  const up = run([{ type: "linkUp", path: "a", sessionId: 1 }]);
  const down = transition(up, { type: "linkDown" });
  assert.equal(connectedPath(down), null);
  assert.equal(connectedSessionId(down), null);
  assert.equal(down.generation, up.generation + 1);
  assert.equal(transition(down, { type: "linkDown" }), down);
});

test("pending connect is matched by path", () => {
  const begun = run([{ type: "connectBegin", path: "a" }]);
  assert.deepEqual(begun.pending, { path: "a", sessionId: null });
  assert.equal(
    transition(begun, { type: "connectSession", path: "b", sessionId: 9 }),
    begun,
  );
  const withSession = transition(begun, {
    type: "connectSession",
    path: "a",
    sessionId: 9,
  });
  assert.equal(withSession.pending?.sessionId, 9);
  assert.equal(transition(withSession, { type: "connectEnd", path: "b" }), withSession);
  assert.equal(transition(withSession, { type: "connectEnd", path: "a" }).pending, null);
});

test("pending can overlap an up link and does not touch it", () => {
  const s = run([
    { type: "linkUp", path: "a", sessionId: 1 },
    { type: "connectBegin", path: "b" },
  ]);
  assert.equal(connectedPath(s), "a");
  assert.equal(s.pending?.path, "b");
  assert.equal(transition(s, { type: "connectAbort" }).pending, null);
  assert.equal(transition(INITIAL_CONNECTION, { type: "connectAbort" }), INITIAL_CONNECTION);
});

test("intent: reconnecting only from idle, cleared only by itself", () => {
  const r = run([{ type: "reconnecting", value: true }]);
  assert.equal(r.intent, "reconnecting");
  assert.equal(transition(r, { type: "manualDisconnect", value: false }), r);
  assert.equal(transition(r, { type: "ambiguous", value: false }), r);
  assert.equal(transition(r, { type: "reconnecting", value: false }).intent, "idle");
});

test("intent: manual beats ambiguous and reconnecting", () => {
  const m = run([{ type: "manualDisconnect", value: true }]);
  assert.equal(transition(m, { type: "reconnecting", value: true }), m);
  assert.equal(transition(m, { type: "ambiguous", value: true }), m);
  // Closing the device chooser must not cancel a manual disconnect.
  assert.equal(transition(m, { type: "ambiguous", value: false }), m);
  assert.equal(transition(m, { type: "manualDisconnect", value: false }).intent, "idle");
});

test("intent: ambiguous overrides reconnecting; manual overrides both", () => {
  const r = run([
    { type: "reconnecting", value: true },
    { type: "ambiguous", value: true },
  ]);
  assert.equal(r.intent, "ambiguous");
  assert.equal(
    transition(r, { type: "manualDisconnect", value: true }).intent,
    "manual",
  );
  assert.equal(transition(r, { type: "ambiguous", value: false }).intent, "idle");
});
