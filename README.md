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

You can save profiles in the app to switch between EQ setups.

If you have trouble connecting on Linux, see the [setup and troubleshooting guide](https://github.com/Bukutsu/glacier-eq/wiki/Troubleshooting).

## Supported devices

Device matching requires an exact USB vendor/product ID and a compatible HID report descriptor.

| Status | Devices |
| --- | --- |
| Tested EQ reads and writes | EPZ TP35 Pro (TP35Pro), TRN Black Pearl |
| Read-only, reference-backed reads | Moondrop Dawn Pro 2, FiiO JA11, KA15, KA17 |
| Read-only, model-specific behavior unresolved | Audiocular Aura, JCally JM20 Pro, Truthear KEYX |

Read-only models reject EQ, utility, reset, and flash writes, including when verification is disabled. Microphone writes and control reset are blocked on all current models until their microphone encoding is verified.

The original Dawn Pro is not the Dawn Pro 2 and is not supported. Shared vendor IDs do not establish support for other FiiO, JCally, Fosi, iBasso, or Savitech/Walkplay devices.

See [device validation](docs/device-validation.md) for exact IDs, evidence, unresolved commands, and the hardware test plan.

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

## Help and support

- [Wiki](https://github.com/Bukutsu/glacier-eq/wiki): device list, install options, command line tools, and building from source.
- [Releases](https://github.com/Bukutsu/glacier-eq/releases): downloads.
- [Issues](https://github.com/Bukutsu/glacier-eq/issues): bugs and requests.

If Glacier EQ is useful to you, give it a star or support it on [GitHub Sponsors](https://github.com/sponsors/Bukutsu) or [Ko-fi](https://ko-fi.com/bukutsu) :3.

## License

Glacier EQ is licensed under GPL-3.0-only. See [LICENSE](LICENSE).
