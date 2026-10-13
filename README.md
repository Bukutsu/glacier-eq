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

Plug in your DAC and check whether it appears in the app. Some supported devices have not been tested yet.

| Status | Devices |
| --- | --- |
| Tested | EPZ TP35 Pro (TP35Pro), TRN Black Pearl |
| Supported, untested | Moondrop Dawn Pro / Dawn Pro 2 |
| Supported, untested | FiiO JA11, FiiO KA series (KA5, KA13, etc.) |
| Supported, untested | Truthear KEYX |
| Supported, untested | JCally JM20 / JM20 Pro, JCally JM12 |
| Supported, untested | Fosi Audio DS2 |
| Supported, untested | iBasso DC04 Pro |
| Supported, untested | Audiocular Aura |
| Supported, untested | Other Savitech/Walkplay-based DAC dongles |

See the [full device list](https://github.com/Bukutsu/glacier-eq/wiki/Supported-Devices) on the wiki.

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
