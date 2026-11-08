import assert from "node:assert/strict";
import { test } from "node:test";

import {
  claimEqOperation,
  releaseEqOperation,
} from "../src/features/device/lib/eqOperationLock.ts";

const lock = () => ({ inFlightRef: { current: false }, idRef: { current: 0 } });

test("claim marks in flight and returns increasing ids", () => {
  const l = lock();
  const a = claimEqOperation(l);
  assert.equal(l.inFlightRef.current, true);
  assert.equal(claimEqOperation(l), a + 1);
});

test("release clears only for the latest claim", () => {
  const l = lock();
  const old = claimEqOperation(l);
  const latest = claimEqOperation(l);
  assert.equal(releaseEqOperation(l, old), false);
  assert.equal(l.inFlightRef.current, true);
  assert.equal(releaseEqOperation(l, latest), true);
  assert.equal(l.inFlightRef.current, false);
});
