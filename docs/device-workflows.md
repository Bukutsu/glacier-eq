# Device workflows

The Rust session is shared by native HID and WebHID/WASM. Protocol packets
belong under `glacier-core/src/device/families/`; the registry is
`glacier-core/src/device/catalog.rs`. Frontend ownership is described in
[Frontend structure](frontend.md).

## Operation safety

A native session holds the device-operation lock across its transaction and
checks the captured path and session ID before using the transport. WebHID
serializes transport commands. Frontend operations also check connection
generation and editor/operation revisions before adopting results.

Reconnect recovery closes, reopens, and reads. It never replays a mutation.
This differs from an in-session protocol retry: Walkplay can rewrite the same
EQ once after a readback mismatch, then roll back if verification still fails.
Neither path is permission to resend a restart-causing Save.

Control and factory-reset confirmations reserve the shared maintenance slot
before opening. Queued work must still match the session and component lifetime.

## JA11 and JA11-protocol devices

JA11 USB audio modes use `2972:0101` and `2972:0102`. Stock JCally JM12 has
a separate catalog entry; a JM12 with JA11 firmware must be identified by the
USB identity it actually exposes.

The protocol encodes the preamp as signed big-endian data and uses 200 ms
report pacing with a 500 ms initial settling period. Persistent writes select
User1, write bands and preamp, Apply, verify RAM, and send Save last. No further
I/O is allowed in that transaction after a restart-causing Save attempt.

The UI waits 2.2 seconds before retiring the old handle after a known restart,
with a 15-second expected-restart window. JA11 background loss/reconnect stays
quiet. Silent-read recovery is limited to one reopen per explicit connection;
concurrent failures share that recovery.

Microphone, USB audio mode, and volume reads are sequential and retry bounded
misses. Unknown values stay disabled. Volume is written on release, with
confirmation for changes larger than ten steps. Mutations are not replayed
after reconnect.

Implementation references include
[devicePEQ](https://github.com/jeromeof/devicePEQ/tree/0617f382e76629792a5933e6933e4b396a756a93),
[ja11-config](https://github.com/Ircama/ja11-config), and
[ja11-web-control](https://github.com/Cyfine/ja11-web-control).
Matching source citations remain beside the protocol and UI implementation.

## Walkplay controls and resets

On the tested EPZ TP35 Pro, reports are paced 16 ms apart. Control writes
stage every register, then send one flash commit and wait 250 ms. A commit
after each register caused subsequent reports to be ignored during flash
settling.

| Setting | Payload |
| --- | --- |
| Reconstruction filter | `01 11 01 MODE` |
| Amplifier mode | `01 1d 01 VALUE` |
| Gain mode | `01 19 01 VALUE` |
| Microphone volume | `01 02 02 80 VALUE` |
| Balance | Two `01 16 04 …` reports |
| Flash commit | `01 01 00` |
| Restore defaults/reload | `01 17 00` |

The report ID is `4b`, separate from the payload. `01 17 00` restores filter,
amplifier mode, and balance and reloads saved EQ; it is not a complete factory
reset by itself. The app's factory-reset workflow first saves flat EQ, sends
restore-defaults, then explicitly sets and verifies the hardware controls.

Control reset defaults are FAST-LL, Class-AB, low gain, microphone 0 dB, and
centred balance. Reset readback must match every field. On failure, control
reset attempts to restore the captured state and verifies it before claiming
restoration. A factory-reset error can leave partial changes; it does not
promise an all-or-nothing restore of EQ and controls.

An unanswered global-preamp request may be resent, but its reply has no nonce.
An additional independent read must agree before that value is trusted.
Contradiction or another resend during confirmation fails closed.

## Hardware evidence and limits

The recent timing/reset work was physically checked on EPZ TP35 Pro
(`3302:43e6`) on Linux and compared with the official WalkPlay web app.
Responses normally arrived in 13–16 ms. Some reports were still dropped
across tested 4–40 ms write gaps; extra delay did not eliminate that loss.

The official app generally does not verify writes, so its apparent success
does not establish that a report landed. Glacier's reset/readback tests also
inject dropped writes and failed restoration.

These observations do not establish the same timing or defaults on every
Walkplay device. Windows runtime behavior and persistence across a physical
power cycle still need separate checks. TP35 microphone readback can differ
by 1 dB for some values even with the official app's write bytes; this remains
unresolved. Test at safe listening levels.
