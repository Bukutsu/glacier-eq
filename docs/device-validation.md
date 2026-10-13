# Device validation

Only EPZ TP35 Pro and TRN Black Pearl have previously tested Glacier EQ write paths. This audit used pinned reference source and recorded replies; no DAC hardware was available for new testing.

## Model policy

| Model | VID:PID | Protocol report ID | Bands | Writes | Remaining confirmation |
| --- | --- | --- | --- | --- | --- |
| EPZ TP35 Pro | 3302:43E6 | 4B | 10 | Enabled | Keep the existing tested save sequence; microphone encoding is unverified |
| TRN Black Pearl | 3302:43E8 | 4B | 10 | Enabled | Same tested sequence and microphone restriction |
| Audiocular Aura | 3302:43C9 | 4B | 10 | Blocked | References disagree on activation and flash-save framing |
| JCally JM20 Pro | 3302:43C1 | 4B | 8 | Blocked | SchemeNo11 frequency/Q compensation and save behavior |
| Moondrop Dawn Pro 2 | 35D8:011D | 4B | 8 | Blocked | Activation timing, preserving the previous preamp, and restoring it after failed writes |
| FiiO JA11 | 2972:0102 | 02 | 5 | Blocked | Negative preamp interpretation and reconnect after save |
| FiiO KA15 | 2972:0104 | 07 | 10 | Blocked | Preset activation and persistence |
| FiiO KA17 | 2972:0093 | 01 | 10 | Blocked | Writable preset slots and persistence |
| Truthear KEYX | 0D8C:0210 | 4B | 8 | Blocked | Coefficient sample rate and activation/save behavior |

Read-only means every application mutation is rejected before I/O, even unverified push, RAM apply, utility setters, and reset. Reads are reference-backed, not newly hardware-confirmed. Utilities with unverified response layouts return an explicit error. Microphone writes and control reset are blocked for every model because no model-specific microphone encoding capture establishes those writes.

Only tested EPZ/TRN reads use nonce correlation. Other Walkplay models send zero in the reserved nonce field and still fail closed on timeout. This does not relax correlation on tested models.

## Issue #46: original Dawn Pro

The reported original Dawn Pro, `2FC6:F06A`, was incorrectly assigned the Dawn Pro 2 HID PEQ protocol. Independent original-Dawn projects use vendor USB control requests, including `C0 A5`; they do not establish the HID PEQ write contract used here.

Removing this identity prevents sending unverified PEQ and flash commands. The preliminary issue #46 Windows test ZIP is superseded and should not be used to test writes. Windows Moondrop transport now uses control output reports, but that transport change alone does not establish support for the original Dawn Pro.

Standard JM20, disputed JM12, generic FiiO KA devices, Fosi DS2, iBasso DC04 Pro, and vendor-wide Savitech fallbacks are also removed. They need model-specific protocol evidence before registration.

## Corrected protocol contracts

### FiiO

Capture-backed replies start with `BB 0B`, not `CC 0C`. Matching checks the counter, command, payload length, terminator, and requested filter index. Filter read requests end with `index 00 EE`.

Captured USER slots are JA11=3, KA15=9, and KA17=4. Command `18` sets the filter count; `19` saves. KA17 uses report ID 1 rather than KA15's report ID 7. Filter gains use signed big-endian tenths of a dB in the reference path.

Pull initialization sends no preset/count writes. Write preparation is kept in the guarded filter-write path. JA11's negative preamp evidence conflicts across implementations, so writes remain blocked.

### Dawn Pro 2

The corrected builder has eight bands at a 96 kHz DSP rate. It uses explicit payload lengths, custom preset 7, band payload byte 35=7, and the all-band latch after the eighth band. Shelf coefficients match the pinned Studio reference.

Preamp command `23`, EQ save `01`, and offset save `04` are separate operations. Reading does not activate a preset. The current write builder is not a hardware-validated activation/recovery session; the model remains read-only.

### Walkplay

The existing EPZ/TRN two-step commit is unchanged. Other references use a different final flash frame. That disagreement is handled by model write restrictions instead of changing the tested sequence globally.

JM20 Pro is registered separately from standard JM20, with eight bands and no high shelf. KEYX's declared read profile retains the existing 48 kHz setting; conflicting coefficient-rate evidence blocks writes rather than choosing an unverified rate.

### HID transport

Native, CLI, Android, and WebHID connections require both the protocol's Input and Output report IDs and sufficient payload bits before protocol I/O. USB endpoint packet size is not a HID report length. Descriptor parsing sums fields before rounding and handles report IDs and global Push/Pop state.

Windows Moondrop output uses HID SET_REPORT. Other established paths retain their existing framing. Linux elevated sessions validate the sysfs descriptor before and after open; the helper does not return a descriptor from its actual handle. CLI raw diagnostic mode explicitly bypasses model/report safety checks and is not a normal EQ session.

## Pinned evidence

- [devicePEQ](https://github.com/jeromeof/devicePEQ/tree/0617f382e76629792a5933e6933e4b396a756a93): FiiO capture replies, `fiioUsbHidHandler.js`, `walkplayHidHandler.js`, USB model registry, and Walkplay preprocessing schemes.
- [Audiocular Aura](https://github.com/mandy321/Audiocular-Aura/tree/af0bcf7057860307bf81b00746f0cbdb93366514): `src/dsp.ts`, activation, microphone, and Walkplay differences.
- [DawnPro2 Studio](https://github.com/Mexes-GM/dawnpro2-studio/tree/fec08ac5db4835575747849172a7299f6f0d4b7f): protocol, session, coefficients, and tests. The project reports firmware 1.5 validation; that is upstream evidence, not Glacier EQ hardware testing.
- [DawnPro GUI Windows](https://github.com/mohammed-just/DawnPro-GUI-windows/tree/3e6884c837a1428f0c0066361cd57cd3fc11665c): independent Dawn Pro 2 HID implementation, with older framing differences.
- [mdrop](https://github.com/frahz/mdrop/tree/98d4e36e70aea3a3fb3b390c1523ade1e3da9bc0): original Dawn vendor-control requests.
- [KEYX Android bridge](https://github.com/Halil156/WebHidBridge-Android-Truthear-Keyx/tree/12cdf27a53b8ac5fd90699c198f1d0cf9c22422e): conflicting KEYX coefficient-rate evidence.
- [FiiO Control Desktop](https://github.com/Rama-X2/fiio-control-desktop/tree/dda37647824752fa2f856b1ea9d18a0215f00b5b): model-specific FiiO behavior and conflicting JA11 preamp evidence.

FiiO fixtures under `glacier-core/tests/fixtures/fiio/` are transcribed reference captures. Dawn Pro 2 `.bin` fixtures are generated from the pinned Studio source, not USB captures. The Walkplay fixture records the unchanged local tested sequence.

## Before enabling another model

1. Record its exact VID/PID, firmware, HID interfaces, and raw report descriptors.
2. Capture a read session with the official or known working tool. Verify every band, signed gain, preamp, command counter, and utility layout.
3. With headphones disconnected, capture RAM writes, activation, flash save, and reconnect. Read back immediately and after power cycling.
4. Test failure midway through writing, timeout, unplugging, and restoring the previous preamp/EQ. For Dawn Pro 2, verify mute/protection timing without changing the previous preamp permanently.
5. Capture microphone writes at several signed values separately. Do not infer encoding from a slider range.
6. Add captures and model-specific regression tests, then remove only that model's corresponding write restriction.

Offline tests and successful cross-builds do not replace these checks.
