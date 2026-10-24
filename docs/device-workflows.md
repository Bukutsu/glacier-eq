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

JA11 is listed as tested, on JA11 firmware, from community tester reports. Stock
JM12 firmware and other variants are not covered by those reports.

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

## Other FiiO models

See [FiiO support](fiio-support.md) for the model-specific HID routes, write
banks, expected band counts, serial-only models, and evidence limits. New HID
profiles select their write bank before the rollback snapshot. Unknown FiiO
products no longer fall through to the generic KA protocol.

## SNOWSKY Melody and Tiny A

The Melody (`2972:0126`) uses FiiO HID report ID 7 with ten bands. Its
profile remains **Untested** in Glacier: the supplied diagnostic capture
establishes USB identity, EQ reads and accepted request framing, but not a
successful persistent write with this implementation.

Sources:

- [FiiO Control Web](https://fiiocontrol.fiio.com/), bundle
  `static/js/index-7hb30NUo.js`, plus the supplied Melody capture.
- [Contour's Melody protocol findings](https://github.com/Chronosauros/contour/blob/81cd09dbad630c4237355334a9b4a86d2e1a1f63/research/protocol/PROTOCOL.md#L216-L248)
  and [name-field captures](https://github.com/Chronosauros/contour/blob/81cd09dbad630c4237355334a9b4a86d2e1a1f63/research/snowsky-names-types-2026-10-14/FINDINGS.md).
  Contour reports testing on the owner's Melody and Tiny A; these are external
  findings, not Glacier hardware validation. The implementation here is
  independently written from those protocol findings.
- [snowsky-peq-loader's reset-to-flat](https://github.com/uvish/snowsky-peq-loader/blob/06869427f7fb706c25944cfcf89d9275c993e616/fiiopeq.py#L250-L259).

### Playback and write destination are separate

Factory presets are 0–6 (Jazz, Pop, Rock, Dance, R&B, Classic, Hip-hop);
USER1–3 are 160–162, and EQ off is 240. The Device controls can select any of
these for playback. A selection is sent once and verified immediately; it
does not edit or save bands, or overwrite the editor.

Profiles keeps the three User banks under **On this DAC**, separate from
profiles under **Saved in Glacier**. Selecting a User bank activates it and
loads its EQ into the editor. Edits can preview on the DAC, but Melody never
saves them to flash automatically. The editor shows **Save to User N** when
there are changes; switching away asks before discarding them. Saving a profile
in Glacier creates a separate local copy.

Profiles saved in Glacier appear below the three fixed DAC banks and are local
files. Loading one changes the editor and may preview it on the active bank;
it does not write it to flash. Use **Save to User N** to keep the EQ on the DAC.
A local profile's **Save to DAC** action writes that profile to the active bank,
or asks which bank to use if none is open. The header's **Write to DAC** remains
a shortcut for saving the current editor, and **Read from DAC** reads the
playing EQ.

Device controls now handle playback presets and resetting the explicitly
selected User bank. Bank selection and renaming live in the Profiles list.
Writes and resets select the destination before taking the backup. On failure,
rollback restores that destination's backup, not the previously playing slot.
Native and WebHID requests carry `melody_slot` explicitly; other devices
reject this argument.

Every write contains ten bands; normalization supplies neutral bands for a
shorter profile. Glacier does not send a band-count write. SAVE (`0x19`) uses
the destination id and is not retried on transport failure. Its short
acknowledgement is drained before checking the preset, then normal EQ
verification follows. Skip-verification still checks the selected slot but
does not verify the saved bands.

### Stale preset replies

Contour reports that `0x16` replies become stale after band or preamp traffic,
even when the returned byte happens to be a valid preset id. Glacier only
uses the query immediately after selection or SAVE. An unsolicited
`melody_control` read returns null without USB traffic. The UI initially says
**Choose a preset** rather than guessing, and clears its confirmed selection
after other EQ operations. Switching playback invalidates the app's stored
EQ comparison without discarding editor changes.

Names can be refreshed without changing playback. Glacier does not scan
inactive slots in the background: reading their EQ requires selecting them,
which would change the sound.

### USER names and reset

Command `0x30` reads and renames USER slots:

- Read payload: the slot id `a0`–`a2`, not an index 0–2.
- Reply payload: slot id plus eight name bytes, NUL padded.
- Write payload: slot id plus 1–8 ASCII letters or digits, uppercased,
  without padding. A single write is followed by a slot-correlated readback.

Reset writes ten flat bands with zero preamp through the normal verified
EQ operation, after confirmation naming the destination. Other slots and
their names are left alone. It does not send the unconfirmed `0x1b` reset
opcode or a factory-reset command.

### Limits and remaining uncertainty

The official web app allows -24 to +12 dB for bands and preamp; Contour
configures -12 to +12 dB. That disagreement is unresolved. Glacier retains
the official preamp envelope, with bands stopping at -18 dB (the profile
storage floor); this is not a claim that the lower values were measured on
hardware. Preamp snaps to whole dB because the supplied capture reads a
-9.9 dB write back as -9.0 dB. Existing Q tolerance covers Contour's reported
3.00 → 3.01 readback.

Firmware version uses `0x0b`, joining reply bytes with dots. The official app
sends sequence numbers and CRC-8; the capture shows the Melody accepts
Glacier's zero placeholders. LED, balance, DAC-filter and factory-reset
commands remain unavailable without Melody-specific evidence.

## Walkplay controls and resets

On the tested EPZ TP35 Pro, reports are paced 16 ms apart. Control writes
stage every register, then send one flash commit and wait 250 ms. A commit
after each register caused subsequent reports to be ignored during flash
settling.

| Setting                 | Payload                  |
| ----------------------- | ------------------------ |
| Reconstruction filter   | `01 11 01 MODE`          |
| Amplifier mode          | `01 1d 01 VALUE`         |
| Gain mode               | `01 19 01 VALUE`         |
| Microphone volume       | `01 02 02 80 VALUE`      |
| Balance                 | Two `01 16 04 …` reports |
| Flash commit            | `01 01 00`               |
| Restore defaults/reload | `01 17 00`               |

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

## Walkplay gain range

Generic Walkplay profiles use −16 to +16 dB for band gain and overall gain
to give AutoEQ more room. This is an editing policy, not a firmware limit.
The official [EPZ app](https://peq.epzsz.com/#/epz/index) uses ±12 dB. Its EQ bundle
(`js/chunk-296c5a20.62e239e4.js`) sets `gainRange: [-12, 12]` for both the
band sliders and the overall-gain slider.

On the connected EPZ TP35 Pro (`3302:43e6`), RAM writes of −12 and +12 dB
were independently read back for both preamp and one peak band. The other
bands stayed unchanged. Output was muted during the test; the original EQ
and mute state were restored, and a separate read matched the EQ backup.
No flash save was sent.

A wider RAM-only probe bypassed the app's capability clamp. Preamp readback
matched −128, −64, −32, −24, −16, −13, +13, +16, +24, +32, +64 and +127 dB.
A peak band at 1 kHz, Q 0.75 read back −128, −64, −32, −24, −16, −13, +13,
+16, +24 and +32 dB, with the raw coefficient bytes matching the writes.
The encoder rejected +64 and +127 dB at that frequency and Q because the
coefficients exceeded the DSP's ±2.0 fixed-point range. Those rejected filters
were not sent. The original EQ was restored and read back after the probe.

Thus ±12 dB is the official app's editing range, not a demonstrated firmware
limit. Register and coefficient readback do not measure the analog output:
these tests cannot establish the DSP's effective gain range, clipping,
saturation or signal quality. The ±16 dB editing range keeps coefficient
representability checks: some frequency, Q and gain combinations still cannot
be encoded. The KEYX retains its separate −20 to 0 dB preamp and ±12 dB band
limits. Other Walkplay devices were not tested.

## Walkplay live apply

Temporary apply is the first commit step alone: `01 0a 04 00 00 ff ff`. It
loads the written bands without the flash save (`01 01 00`). The vendor's web
tools send it on every edit and send the flash save only on Save; devicePEQ's
capture of peq.szwalkplay.com (an EPZ TP13, scheme 11) shows the same pattern.
devicePEQ drives vendor IDs `0661`, `0666`, `0d8c` and `3302` with one
handler, so every Walkplay catalog entry on those IDs has temporary apply. Fosi
and iBasso (`262a`) appear in neither source and stay off.

With Live apply on, the app writes all bands, the preamp and the temp apply
about 100 ms after an edit, without a backup read, verification or rollback,
then saves once edits have paused for 3 seconds. A failed live write leaves the
stored EQ untouched. Only the EPZ TP35 Pro was checked on hardware; whether the
temporary EQ is dropped by a physical power cycle was not tested here.

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
