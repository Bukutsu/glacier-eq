/**
 * Device connection state machine. Pure: no React, no I/O, no imports, so it
 * runs under `node --test` (see tests/connectionMachine.test.ts).
 *
 * State is three independent axes, each explicit:
 *
 *   link     down | up(path, sessionId)   the open device session
 *   pending  null | (path, sessionId?)    a connect attempt in flight; it can
 *                                         overlap an up link (switching DACs)
 *   intent   idle | reconnecting | manual | ambiguous
 *                                         why a down link is (not) being retried.
 *                                         One value, so they cannot conflict.
 *                                         Priority: manual > ambiguous >
 *                                         reconnecting > idle
 *
 * Events and what they change:
 *
 *   connectBegin(path)         pending = (path, null)
 *   connectSession(path, id)   pending.sessionId = id, only if pending.path matches
 *   connectEnd(path)           pending = null, only if pending.path matches
 *   connectAbort               pending = null
 *   linkUp(path, sessionId)    link = up; generation++ if link or path changed
 *   linkDown                   link = down; generation++ if it was up
 *   reconnecting(true|false)   set only from idle | clear only from reconnecting
 *   ambiguous(true|false)      set unless manual | clear only from ambiguous
 *   manualDisconnect(true|false) set always | clear only from manual
 *
 * Setting never downgrades a higher-priority intent and clearing only clears
 * its own, so e.g. closing the device chooser cannot cancel a manual
 * disconnect and re-enable automatic reconnect.
 *
 * `generation` fences async work: capture it before an await and compare after
 * to learn whether the connection changed underneath you.
 */

export type Link =
  | { readonly kind: "down" }
  | {
      readonly kind: "up";
      readonly path: string;
      readonly sessionId: number | null;
    };

export interface PendingConnect {
  readonly path: string;
  readonly sessionId: number | null;
}

export type Intent = "idle" | "reconnecting" | "manual" | "ambiguous";

export interface Connection {
  readonly link: Link;
  readonly pending: PendingConnect | null;
  readonly intent: Intent;
  readonly generation: number;
}

export type ConnectionEvent =
  | { type: "connectBegin"; path: string }
  | { type: "connectSession"; path: string; sessionId: number | null }
  | { type: "connectEnd"; path: string }
  | { type: "connectAbort" }
  | { type: "linkUp"; path: string; sessionId: number | null }
  | { type: "linkDown" }
  | { type: "reconnecting"; value: boolean }
  | { type: "manualDisconnect"; value: boolean }
  | { type: "ambiguous"; value: boolean };

export const INITIAL_CONNECTION: Connection = {
  link: { kind: "down" },
  pending: null,
  intent: "idle",
  generation: 0,
};

const clear = (current: Intent, own: Intent): Intent =>
  current === own ? "idle" : current;

const withIntent = (state: Connection, intent: Intent): Connection =>
  state.intent === intent ? state : { ...state, intent };

/** Returns the same object when the event changes nothing. */
export function transition(
  state: Connection,
  event: ConnectionEvent,
): Connection {
  switch (event.type) {
    case "connectBegin":
      return { ...state, pending: { path: event.path, sessionId: null } };
    case "connectSession":
      if (state.pending?.path !== event.path) return state;
      return {
        ...state,
        pending: { path: event.path, sessionId: event.sessionId },
      };
    case "connectEnd":
      return state.pending?.path === event.path
        ? { ...state, pending: null }
        : state;
    case "connectAbort":
      return state.pending ? { ...state, pending: null } : state;
    case "linkUp": {
      const moved =
        state.link.kind !== "up" || state.link.path !== event.path;
      return {
        ...state,
        link: { kind: "up", path: event.path, sessionId: event.sessionId },
        generation: state.generation + (moved ? 1 : 0),
      };
    }
    case "linkDown":
      return state.link.kind === "down"
        ? state
        : { ...state, link: { kind: "down" }, generation: state.generation + 1 };
    case "reconnecting":
      return withIntent(
        state,
        event.value
          ? state.intent === "idle"
            ? "reconnecting"
            : state.intent
          : clear(state.intent, "reconnecting"),
      );
    case "ambiguous":
      return withIntent(
        state,
        event.value
          ? state.intent === "manual"
            ? "manual"
            : "ambiguous"
          : clear(state.intent, "ambiguous"),
      );
    case "manualDisconnect":
      return withIntent(
        state,
        event.value ? "manual" : clear(state.intent, "manual"),
      );
  }
}

export const isConnected = (s: Connection): boolean => s.link.kind === "up";
export const connectedPath = (s: Connection): string | null =>
  s.link.kind === "up" ? s.link.path : null;
export const connectedSessionId = (s: Connection): number | null =>
  s.link.kind === "up" ? s.link.sessionId : null;
