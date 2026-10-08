<h1>
  <img src="public/glacier-eq.svg" alt="" width="32" height="32" style="vertical-align: middle;">
  Glacier EQ
</h1>

<div>
  <a href="https://github.com/Bukutsu/glacier-eq/releases/latest"><img src="https://img.shields.io/github/v/release/Bukutsu/glacier-eq?style=flat&logo=github" alt="Latest release"></a>
  <a href="https://github.com/Bukutsu/glacier-eq/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-GPLv3-blue.svg" alt="License"></a>
</div>

Glacier EQ lets you adjust the parametric EQ on your USB DAC dongle and save it on the DAC, so you can keep the same sound when you plug it into another device.

It supports EPZ TP35 Pro, TRN Black Pearl, Moondrop Dawn Pro, FiiO KA/JA11, Truthear KEYX, JCally, iBasso, Fosi Audio, and more. Works offline, no account needed.

[try it in your browser](https://bukutsu.github.io/glacier-eq/) (Chrome or Edge) · [download for desktop and Android](https://github.com/Bukutsu/glacier-eq/releases)

<img src="assets/screenshot-main.png" alt="Glacier EQ showing EQ sliders and sound curve" width="900">

## will it work with my DAC?

plug in your DAC and check if it shows up in the app. check the list below, some supported devices haven't been tested yet.

**tested:**
- EPZ TP35 Pro (TP35Pro)
- TRN Black Pearl

**supported, untested:**
- Moondrop Dawn Pro / Dawn Pro 2
- FiiO JA11
- FiiO KA series (KA5, KA13, etc.)
- Truthear KEYX
- JCally JM20 / JM20 Pro
- JCally JM12
- Fosi Audio DS2
- iBasso DC04 Pro
- Audiocular Aura
- Other Savitech/Walkplay-based DAC dongles

[full device list on the wiki](https://github.com/Bukutsu/glacier-eq/wiki/Supported-Devices)

## how to use it

1. plug in your DAC and open Glacier EQ.
2. pick your DAC, hit **Connect**, then **Pull** to read its EQ.
3. adjust the sliders till it sounds right, then hit **Push** to save it on the DAC.

You can also save profiles in the app, so you can switch back to an EQ you liked.

## trouble connecting?

on Linux, check the [setup and troubleshooting guide](https://github.com/Bukutsu/glacier-eq/wiki/Troubleshooting).

## development

see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, verification, and commands to develop the web, desktop, and Android apps.

### hardware CLI

use the workspace CLI to inspect a connected DAC or send raw HID reports to test the protocol:

```sh
cargo run -p glacier-core --bin glacier-eq-cli -- hardware list
cargo run -p glacier-core --bin glacier-eq-cli -- hardware raw \
  --device 3302:43e6 --report-id 4b --data 80 0c 00 --read-ms 250 --yes
```

Raw writes need `--yes`. Use `--read-ms 0` if you don't want to read a response. Pass the report ID separately from the data. The data accepts hexadecimal bytes separated by spaces, commas, or colons, or compact hexadecimal bytes.

## support

if Glacier EQ is useful to you, give it a star or support it on [GitHub Sponsors](https://github.com/sponsors/Bukutsu) or [Ko-fi](https://ko-fi.com/bukutsu) :3

## more info

- [Wiki](https://github.com/Bukutsu/glacier-eq/wiki) for the device list, install options, command line tools, and building from source
- [Releases](https://github.com/Bukutsu/glacier-eq/releases) for downloads
- [Issues](https://github.com/Bukutsu/glacier-eq/issues) for bugs and requests

Glacier EQ is licensed under GPL-3.0-only. See [LICENSE](LICENSE).
