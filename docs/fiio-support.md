# FiiO support

This expansion is unreleased. New profiles are source-reviewed and tested with
synthetic transports, not confirmed on physical devices in Glacier. JA11 keeps
its existing Tested status. SNOWSKY Melody is also marked Tested based on the
user's confirmation of the standard persistent EQ workflow on hardware; its
experimental RAM-only live preview still needs separate validation. Reports
from other apps do not make a Glacier profile Tested.

## Coverage

[FiiO Control Web](https://fiiocontrol.fiio.com/) lists **38 models** in the
reviewed bundle, including beta entries. There are 34 HID models and four serial
models. Glacier registers the 34 HID model routes, 30 more than the existing
JA11, KA15, KA17, and Melody profiles. Registration does not promise that every
firmware or USB mode works.

The table lists the expected fixed bank size. A new profile reads command
`0x18` before any EQ mutation and again when reading the destination snapshot.
A different count, missing response, or unsupported filter prevents an EQ write.
The newer/beta models especially need real captures to confirm their bank sizes.

| Model | Bands expected | Default write bank | Identification |
| --- | ---: | --- | --- |
| FiiO JA11 | 5 | User 1 (3) | 2972:0101 / 0102; Tested |
| FiiO KA15 | 10 | User 3 (9), existing behavior | 2972:0104; Untested |
| FiiO KA17 | 10 | User 1 (4) | 2972:0093; Untested |
| SNOWSKY Melody | 10 | User 1–3 (160–162), selectable | 2972:0126; Tested |
| FIIO BTR13 | 10 | User 1 (7) | exact USB product name; Untested |
| FIIO BTR15 | 10 | User 1 (7) | exact USB product name; Untested |
| FIIO BTR17 | 10 | User 1 (160) | 2972:0088; exact USB product name; Untested |
| FIIO BTR19 | 10 | User 1 (160) | exact USB product name; Untested |
| FIIO BTR25 | 10 | User 1 (160) | exact USB product name; Untested |
| FIIO QX13 | 10 | User 1 (160) | 2972:0128; exact USB product name; Untested |
| FIIO QX11 | 10 | User 1 (160) | 2972:0130; PID-gated mode; Untested |
| FIIO FX17 | 10 | User 1 (160) | exact USB product name; Untested |
| FIIO FX25 | 10 | User 1 (160) | exact USB product name; Untested |
| FIIO FP3 | 10 | User 1 (160) | exact USB product name; Untested |
| FIIO LS-TC2 | 5 | User 1 (160) | exact USB product name; Untested |
| JadeAudio JIEZI | 5 | User 1 (160) | exact USB product name; Untested |
| JadeAudio Trustblu | 10 | User 1 (160) | exact USB product name; Untested |
| FIIO K13 R2R | 10 | User 1 (160) | 2972:0120; exact USB product name; Untested |
| FIIO K13 | 10 | User 1 (160) | exact USB product name; Untested |
| FIIO BR15 R2R | 10 | User 1 (160) | exact USB product name; Untested |
| SNOWSKY TINY A | 10 | User 1–3 (160–162), selectable | 2972:0147; exact USB product name; Untested |
| SNOWSKY TINY B | 5 | User 1 (160) | exact USB product name; Untested |
| RETRO NANO | 10 | User 1 (160) | exact USB product name; Untested |
| OAK NANO | 8 | User 1 (160) | 2972:4016; exact USB product name; Untested |
| FIIO FG3 | 10 | User 1 (160) | exact USB product name; Untested |
| FIIO JD1 GAMING | 10 | User 1 (160) | exact USB product name; Untested |
| FIIO KG13 | 10 | User 1 (160) | exact USB product name; Untested |
| JadeAudio JK13 | 10 | User 1 (160) | exact USB product name; Untested |
| FIIO WARMER NANO | 10 | User 1 (160) | exact USB product name; Untested |
| FIIO GAME ENGINE | 10 | User 1 (160) | exact USB product name; Untested |
| SNOWSKY MAGE | 10 | User 1 (160) | exact USB product name; Untested |
| FIIO BT11 | 10 | User 1 (160) | 2972:4032; PID-gated mode; Untested |
| FIIO Air Link | 10 | User 1 (160) | 2972:4033; PID-gated mode; Untested |
| FIIO AIR AMP | 10 | User 1 (160) | exact USB product name; Untested |

The known IDs above use vendor `2972`. New product-name routes are also registered
under vendor `0A12`, as in the reviewed reference catalog. They require the full
USB product name, compared without case and surrounding whitespace. A missing
PID is **not** a vendor-wide match. Unknown FiiO products and ordinary CSR devices
are not enabled.

`FIIO DSP Audio` is the official alias for `FIIO LS-TC2`. Oak Nano also accepts
`FIIO OAK NANO`; BTR17 accepts the reference catalog's `BTR17` descriptor.
QX11 is limited to HiFi PID `0130`, not game PID `4014`. BT11 and Air Link
are limited to the official app's `tengtai` PIDs `4032` and `4033`;
other modes remain unsupported.

Tiny A expects **ten bands**, despite devicePEQ's five-band entry. Contour
reports ten on a physical Tiny A, PID `0147`, firmware 1.10. The mandatory
count check rejects a different firmware layout.

## Selectable User banks

The Profiles view separates fixed **On this DAC** banks from profiles **Saved in
Glacier**. Bank controls are available for these source-reviewed layouts:

| Model | User banks | Protocol IDs |
| --- | ---: | --- |
| BTR13, BTR15, KA15 | 3 | 7, 8, 9 |
| KA17 | 3 | 4, 8, 9 |
| BTR17 | 10 | 160–169 |
| Melody, Tiny A | 3 | 160–162 |

Opening a bank selects it on the DAC and reads its EQ into the editor. Saving
the editor confirms the destination, selects and verifies that bank before the
backup, then saves and checks the result. A failed write restores the same bank
when possible. These are synthetic-test guarantees, not proof of persistence or
bank isolation on physical hardware.

Only Melody and Tiny A expose stored names and rename controls. Other models use
fixed User N labels. QX13 and other models without a confirmed multi-bank path
keep their existing single-destination write behavior; third-party slot counts
alone do not enable a bank picker. No bank is linked to a Glacier profile by name.

Mapping references are credited beside the implementation in
`glacier-core/src/device/families/fiio/models.rs` and `registry.rs`.

## What the new profiles do

- Read EQ, normalize edits for the selected model, save to its User 1 bank, and
  verify the EQ readback. Reset writes a flat EQ through that same path.
- Select and verify the write bank before taking the rollback snapshot.
  Writing User 1 must not back up User 2 and later restore it over User 1.
  Reading EQ alone does not select a preset.
- Read the EQ-enable flag on QX13 and BTR15/19/25. If it is off, ask the user to
  enable EQ in FiiO Control first. Glacier does not enable it silently.
- Send preset selection and SAVE once. A delivery error is not permission to
  replay either command. Short SAVE acknowledgements are drained before the
  immediate bank check.
- Use model-specific command intervals. The K13 R2R gets 300 ms, and the
  BTR15/19/25 preset-switch paths get a conservative 1 s.
- Keep temporary EQ, A/B, and live apply off on the new profiles until hardware
  confirms their volatile-write behavior.

Melody and Tiny A also offer playback presets and stored User-slot names.
Saving EQ opens a named User 1–3 bank picker; selecting a bank does not write
or switch playback until **Save and activate**. Local profiles remain separate
from hardware banks. Device controls keep playback selection, rename, and reset. Changing the playback preset changes the DAC
immediately. Arbitrary preset queries can be stale, so the UI only confirms a
preset after an explicit selection. See [device workflows](device-workflows.md).

### Experimental Melody live editing

Hardware-test builds compiled with `GLACIER_EXPERIMENTAL_MELODY_LIVE=1`
advertise RAM apply for Melody only (not Tiny A or the other unverified
profiles). Normal builds leave it disabled. Unset the variable for releases.

In the test build, live apply defaults on, but remains disarmed until the user
selects and reads a User bank. Preview requests carry that bank explicitly,
select and verify it, then write bands and preamp without SAVE. Changes remain
unsaved until an explicit Save to User N action. Switching banks drains outstanding
previews and asks before discarding unsaved edits; errors pause live editing.
Reconnects require selecting a bank again.

Packet tests verify routing and absence of SAVE in preview traffic. They do
not prove audible preview or persistence on hardware; those are the purpose
of this test build. A/B and generic temporary-profile apply remain unavailable
for Melody during this experiment.

### Filters and limits

Glacier represents peak, low shelf, high shelf, high-pass, and low-pass filters.
FiiO wire IDs are `0, 1, 2, 5, 4` respectively. KA15, KA17, Melody, and the
new models that allow pass filters expose those five types. BTR15, BTR17, FP3,
FX25, LS-TC2, and Oak Nano retain the official app's three-type limit.
Mage has peak, low shelf, high-pass, and low-pass, but no high shelf.

The official app also has band-pass and all-pass types, `3` and `6`.
Glacier cannot represent them. Reading a bank containing them fails rather than
turning them into peak filters and overwriting the original bank. Use a bank
with supported types in FiiO Control before writing.

Band gain stays inside Glacier's storage envelope, with a floor of −18 dB even
when the official app allows −24 dB. Per-model preamp limits are separate.
Melody retains its capture-backed whole-dB preamp. Tiny A's preamp resolution
still needs confirmation in Glacier.

BTR17 uses the current official HID SAVE `0x19`. devicePEQ's older BTR17 config
uses `0x21`; Glacier does not probe alternate SAVE opcodes. Test persistence
after unplugging before relying on a saved profile.

## Not supported

- **K15, K17, K17 R2R, K19:** the official app uses a serial adapter. They are
  not HID variants, and some have 31-band banks. They need a serial transport
  and their own verified session behavior.
- **KA1, KA5, KA13 and unknown FiiO products:** sharing vendor `2972` is not
  evidence of this PEQ protocol. The old KA-series fallback has been removed.
- **Other QX11/BT11/Air Link USB modes**, USB20 aliases, and BLE-only paths.
- Other models' volume, LED, Bluetooth, DAC-filter, balance, firmware update,
  and factory-reset controls. EQ protocol compatibility does not establish
  those commands.

## Hardware checks needed

Start with a read and export a backup in FiiO Control. Use a spare User bank.
Check a mild EQ, all bands, the selected write bank, another unchanged bank,
reset-to-flat, and persistence after unplugging. On Tiny A, also check all
three stored names and the preamp resolution.

Report the exact USB IDs, product name, firmware, platform, and diagnostic log.
Do not mark a profile Tested from a synthetic test or another project's report.

Linux udev and Android attach filters still need vendor-level permission
entries for product-name routes, because Android's filter cannot match a USB
product string. Permission to enumerate a vendor is not permission for Glacier
to drive every device under it; the application checks the model separately.

## Sources

Reviewed 2026-10-23:

- [FiiO Control Web](https://fiiocontrol.fiio.com/), bundle
  [index-7hb30NUo.js](https://fiiocontrol.fiio.com/static/js/index-7hb30NUo.js):
  `mne` transport list, `Ov` report IDs, `M8` filter types, `$R` presets,
  `pv` gain limits, `Ff`/`q8e` adapters, and `KBe` command pacing.
- [devicePEQ model configuration](https://github.com/jeromeof/devicePEQ/blob/0617f382e76629792a5933e6933e4b396a756a93/devicePEQ/usbDeviceConfig.js),
  constraints, HID handler, and KA15/KA17/JA11/QX13/Oak Nano captures at that
  revision. QX13 and Oak Nano capture bytes are exercised by codec tests;
  they are external captures, not Glacier hardware tests.
- [Contour FiiO catalog](https://github.com/Chronosauros/contour/blob/81cd09dbad630c4237355334a9b4a86d2e1a1f63/android/core/src/main/kotlin/io/github/chronosauros/contour/core/native/FiioCatalog.kt),
  protocol findings, and SnowSky name probes at that revision.
- [fiiocontrol-oss BTR17 identity](https://github.com/adithyasource/fiiocontrol-oss/blob/f38994b3bd51bbc898cfceb5d182a403180df33e/src/libs/devices/fiioBTR17.js),
  which records vendor `2972` and product ID 136 (`0088`).
- The supplied Melody diagnostic captures established the exact device ID
  and whole-dB preamp mismatch. The second capture, `sakana2.txt`, also
  shows a 16-bit firmware-owned reply counter crossing `00 ff → 01 00`,
  firmware version `1.2.0` without a reliable CRC/terminator, and an extra
  stale byte after the declared name field. `sakana3.txt` shows that byte can
  be `EE` as well as `00`, so it is skipped and never interpreted. Selected raw replies are retained in
  `glacier-core/tests/fixtures/fiio/melody_sakana{2,3}.rs`. Codec and native/WASM
  session tests cover these layouts and counter rollover. EQ and preset
  replies still require their normal terminator; the firmware exception is
  limited to the read-only version command. The user confirmed the standard
  persistent EQ workflow on hardware, so Melody is marked Tested. Experimental
  RAM-only live preview, persistence after reconnect, and bank isolation still
  need their own explicit checks.

The implementation follows published packet findings. It does not copy the
official app or reference drivers into Glacier.
