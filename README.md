# Glacier EQ

<img src="public/glacier-eq.svg" alt="" width="64" height="64">

[![Latest release](https://img.shields.io/github/v/release/Bukutsu/glacier-eq?style=flat&logo=github)](https://github.com/Bukutsu/glacier-eq/releases/latest)
[![License](https://img.shields.io/badge/license-GPLv3-blue.svg)](https://github.com/Bukutsu/glacier-eq/blob/main/LICENSE)

Glacier EQ reads and edits the parametric EQ stored on supported USB DAC dongles. Read the current settings, make changes, then write them back to the DAC. The settings stay on the DAC when you use it with another device.

The app works offline and needs no account.

[Open the web app](https://bukutsu.github.io/glacier-eq/) (Chrome or Edge) · [Download for desktop and Android](https://github.com/Bukutsu/glacier-eq/releases)

<img src="assets/screenshot-main.png" alt="Glacier EQ showing EQ sliders and sound curve" width="900">

## Get started

1. Plug in your DAC and open Glacier EQ.
2. Click **Connect DAC** and select your device.
3. Use **Read from DAC** to load its EQ, adjust the filters, then use **Write to DAC** to save your changes. On mobile, the save button is called **Save to DAC**.

### Profiles and recovery

Loading a profile changes the editor, not the DAC. Use **Write to DAC**
(**Save to DAC** on mobile) to save the editor's EQ to the device.
Compatible DACs also offer a temporary apply action without saving to flash.

On Walkplay DACs, turn on **Live apply** in Settings > General to hear edits
as you make them. Each edit goes to the DAC about a tenth of a second later,
and the app saves to the DAC once you pause, so the Write button is hidden
while it is on. It is off by default.

**Default EQ** is a read-only, flat built-in profile. Load it as a starting
point or to prepare a flat EQ to send to the DAC. You can edit the loaded EQ,
but save those changes under a new profile name. The filled profile row marks
what is in the editor; the lock and Read-only badge identify the built-in.

The app keeps unfinished editor changes for recovery after an unexpected
close. Restoring a draft changes only the offline editor. Reading an EQ from
the DAC without editing it does not create an unfinished draft.

### Tuning

Add a headphone measurement and a target curve in **Tuning** to generate EQ.
AutoEQ searches filter layouts for one to five bands. Low-band devices show a
fit warning because a few filters cannot reproduce every detail of a target;
generation remains available. Review the resulting curve before writing it.

### Device controls and diagnostics

Available controls depend on the DAC. JA11 controls include microphone,
USB audio mode, and hardware volume; Walkplay controls include reconstruction
filter, amplifier mode, gain, balance, and microphone volume. The original
Moondrop Dawn Pro has sound controls but no hardware EQ. The app explains
this limitation and omits EQ Read/Write actions; editing and exporting EQ for
a system equalizer remain available.

JA11 saves can briefly restart the DAC. The app waits before reopening it.
Background JA11 read recovery is quiet and bounded; reconnecting never replays
a failed write. Keep listening levels low when changing gain or resetting a DAC.

For release checks and hardware testing gaps, see
[Release readiness](docs/release-readiness.md). See
[Device workflows](docs/device-workflows.md) for protocol behavior and its
hardware-validation limits.

If you have trouble connecting on Linux, see the [setup and troubleshooting guide](https://github.com/Bukutsu/glacier-eq/wiki/Troubleshooting).

## Supported devices

Find your brand below. Plug in your DAC and check that it appears in the app.

| Brand | Model | Status |
| --- | --- | --- |
| Audiocular | Aura | Untested |
| EPZ | TP35 Pro (TP35Pro) | **Tested** |
| FiiO | JA11 | **Tested** |
| | KA series (KA5, KA13, etc.) | Untested |
| Fosi Audio | DS2 | Untested |
| iBasso | DC04 Pro | Untested |
| JCally | JM12 | Untested |
| | JM20 / JM20 Pro | Untested |
| Moondrop | Dawn Pro | **Tested**, sound controls only (no hardware EQ) |
| | Dawn Pro 2 | Untested |
| TRN | Black Pearl | **Tested** |
| Truthear | KEYX | Untested |

**Untested** means the app supports the device, but nobody has confirmed it on real hardware yet. It may work. If you try one, please [tell us how it went](https://github.com/Bukutsu/glacier-eq/issues).

Not listed? Other Savitech/Walkplay-based DAC dongles may also work. Plug yours in and see.

See the [full device list](https://github.com/Bukutsu/glacier-eq/wiki/Supported-Devices) on the wiki.

Recent Walkplay transfer timing and control-reset changes were checked on a
physical EPZ TP35 Pro on Linux. That does not verify other Walkplay devices or
Windows runtime behavior. JA11 was tested by community testers on JA11
firmware; that does not establish coverage of every original JA11 or stock
JM12 firmware variant.

Live apply is on for every Walkplay DAC above except Fosi and iBasso. It uses
the same temporary-apply packet the vendor's web tools send, and was checked
on a physical EPZ TP35 Pro only.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, verification, and commands for developing the web, desktop, and Android apps.

### Hardware CLI

Use the workspace CLI to inspect a connected DAC or send raw HID reports for protocol testing:

```sh
cargo run -p glacier-core --bin glacier-eq-cli -- hardware list
cargo run -p glacier-core --bin glacier-eq-cli -- hardware raw \
  --device 3302:43e6 --report-id 4b --data 80 0c 00 --read-ms 250 --yes
```

- Raw writes require `--yes`.
- Use `--read-ms 0` to skip reading a response.
- Pass the report ID separately from the data.
- Data accepts hexadecimal bytes separated by spaces, commas, or colons, or compact hexadecimal bytes.

To capture a normal read with timestamped HID TX/RX reports:

```sh
GLACIER_TRACE=1 cargo run -p glacier-core --bin glacier-eq-cli -- \
  hardware pull --device 3302:43e6 > eq.txt 2> hid-trace.log
```

EQ output goes to stdout; the trace goes to stderr. The trace timestamps are
elapsed milliseconds from the first traced report. Unset `GLACIER_TRACE` to
disable it; setting it to `0` still enables tracing. Review logs before sharing.
Run `cargo run -p glacier-core --bin glacier-eq-cli -- --help` for the full
command list, including control reads and resets.

## Help and support

- [Wiki](https://github.com/Bukutsu/glacier-eq/wiki): device list, install options, command line tools, and building from source.
- [Releases](https://github.com/Bukutsu/glacier-eq/releases): downloads.
- [Issues](https://github.com/Bukutsu/glacier-eq/issues): bugs and requests.

If Glacier EQ is useful to you, give it a star or support it on [GitHub Sponsors](https://github.com/sponsors/Bukutsu) or [Ko-fi](https://ko-fi.com/bukutsu) :3.

## License

Glacier EQ is licensed under GPL-3.0-only. See [LICENSE](LICENSE).
