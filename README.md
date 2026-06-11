<!-- Improved compatibility of back to top link: See: https://github.com/othneildrew/Best-README-Template/pull/73 -->
<a id="readme-top"></a>
<!--
*** Glacier EQ — Cross-platform parametric EQ editor for USB DACs.
-->



<!-- PROJECT SHIELDS -->
<!--
*** Reference style links are used below for readability.
*** See the bottom of this document for the declaration of reference variables.
-->
[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]
[![Download][download-shield]][download-url]



<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/Bukutsu/glacier-eq">
    <img src="assets/glacier-eq.svg" alt="Glacier EQ" width="80" height="80">
  </a>

  <h3 align="center">Glacier EQ</h3>

  <p align="center">
    Cross-platform parametric EQ editor for USB DACs. Offline, direct, and built for dense tuning work on desktop and Android.
    <br />
    <a href="https://github.com/Bukutsu/glacier-eq/releases"><strong>Download »</strong></a>
    <br />
    <br />
    <a href="#usage">View Usage</a>
    &middot;
    <a href="https://github.com/Bukutsu/glacier-eq/issues/new?labels=bug&template=bug-report---.md">Report Bug</a>
    &middot;
    <a href="https://github.com/Bukutsu/glacier-eq/issues/new?labels=enhancement&template=feature-request---.md">Request Feature</a>
  </p>
</div>



<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#supported-devices">Supported Devices</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#android-device-testing">Android Device Testing</a></li>
    <li><a href="#development">Development</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>



<!-- ABOUT THE PROJECT -->
## About The Project

Glacier EQ talks to compatible USB DACs over HID, edits 10-band parametric EQ, and verifies writes before they stick. It is the Tauri + React successor to Frost Tune, with the same low-level device focus and a newer cross-platform UI.

**Features**

- Direct USB HID control through the Tauri backend
- 10-band parametric EQ with preamp, filter type, frequency, gain, and Q controls
- Pull current EQ from hardware and push edited state back to the DAC
- Read-back verification with rollback on failed writes
- Local profile save, load, search, import, export, copy, and paste workflows
- AutoEQ text import/export for profile exchange
- Measurement trace overlays from `.csv` or `.txt` files
- Target reference overlays and graph shape/level views
- Android-oriented mobile layout with EQ, Tuning, Profiles, and Settings tabs
- Dev-only dummy DAC for UI review without plugging in hardware
- Offline by design, with no account or cloud dependency

<p align="right">(<a href="#readme-top">back to top</a>)</p>



### Built With

* [![Tauri][Tauri]][Tauri-url]
* [![React][React.js]][React-url]
* [![TypeScript][TypeScript]][TypeScript-url]
* [![Rust][Rust]][Rust-url]
* [![Playwright][Playwright]][Playwright-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- GETTING STARTED -->
## Getting Started

To get a local copy up and running follow these steps.

### Prerequisites

- Node.js and npm
- Rust toolchain
- Platform dependencies required by Tauri v2
- USB/HID access for real-device testing

### Installation

#### From source (any platform)

1. Clone the repo
   ```sh
   git clone https://github.com/Bukutsu/glacier-eq.git
   ```
2. Install NPM packages
   ```sh
   npm install
   ```
3. Run the desktop development server
   ```sh
   npm run tauri dev
   ```

#### Arch Linux (via makepkg)

Build and install directly from the repository with a single command:

```sh
git clone https://github.com/Bukutsu/glacier-eq.git
cd glacier-eq
makepkg -si
```

This compiles a release binary and installs it to `/usr/bin/glacier-eq` along with icons and a desktop entry.

All dependencies are resolved automatically — `makepkg` pulls in Rust, Node.js, WebKitGTK, and the other Tauri v2 dependencies as build-time and runtime deps. (The `base-devel` group must be installed for `makepkg` to work.)

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- USAGE -->
## Usage

1. Plug in a supported DAC.
2. Launch Glacier EQ.
3. Select the DAC and connect.
4. Pull the current hardware state.
5. Edit preamp, bands, filter type, frequency, gain, and Q.
6. Add measurement traces or target overlays when tuning against references.
7. Push changes back to the device.
8. Save, load, import, or export profiles as needed.

In development builds, `Glacier Dummy DAC` appears in the device chooser. It connects without hardware and loads a realistic test EQ state for UI review.

Build the web frontend:

```sh
npm run build
```

Run Playwright smoke tests:

```sh
npm run test
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- SUPPORTED DEVICES -->
## Supported Devices

| Manufacturer | Model | Status | Family / Protocol |
| :--- | :--- | :--- | :--- |
| **EPZ** | TP35 Pro | Tested | Walkplay Family |
| **Moondrop** | Dawn Pro | Untested | Walkplay Family |
| **Truthear** | KEYX | Untested | Walkplay Family |

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- ROADMAP -->
## Roadmap

- [ ] Add additional DAC family support
- [ ] GUI frequency response graph
- [ ] Cross-platform package builds (AppImage, DMG, APK)
- [ ] Command-line interface for headless scripting
- [ ] Multi-device simultaneous support
- [ ] i18n / localization

See the [open issues](https://github.com/Bukutsu/glacier-eq/issues) for a full list of proposed features and known issues.

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- CONTRIBUTING -->
## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement".

Don't forget to give the project a star! Thanks again!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- ANDROID DEVICE TESTING -->
## Android Device Testing

Install the Android toolchain first:

- JDK 17, or Android Studio's bundled JDK
- Android SDK command-line tools, platform-tools, build-tools, and NDK
- `ANDROID_HOME` pointing at the SDK directory, for example `$HOME/Android/Sdk`
- Rust Android targets

Recommended local shell setup:

```sh
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

Check the local machine:

```sh
npm run android:doctor
```

Generate the Android project the first time:

```sh
npm run android:init
```

Run on a real Android device:

```sh
adb devices
npm run android:dev
```

Build an installable debug APK for a typical physical phone:

```sh
npm run android:apk
```

The generated APK is written under `src-tauri/gen/android/app/build/outputs/apk/`.
Use `npm run android:apk:release` only after release signing is configured.

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- DEVELOPMENT -->
## Development

Useful commands:

```sh
npm run dev              # Vite frontend only
npm run tauri dev        # Desktop app development
npm run build            # TypeScript + Vite build
npm run test             # Playwright test suite
npm run android:doctor   # Android toolchain checks
```

Diagnostics are shown only in dev builds by default. The diagnostics log can be copied, cleared, or exported from the dev UI.

Project layout:

```text
glacier-eq/
├── glacier-core/       # Shared Rust library for EQ/device logic
├── src/                # React + TypeScript frontend
├── src-tauri/          # Tauri Rust backend and commands
├── tauri-plugin-hid/   # Local HID plugin used by the backend
├── e2e/                # Playwright smoke tests
└── scripts/            # Local helper scripts
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- LICENSE -->
## License

Distributed under the MIT License. See `LICENSE` for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- CONTACT -->
## Contact

Project Link: [https://github.com/Bukutsu/glacier-eq](https://github.com/Bukutsu/glacier-eq)

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [Best-README-Template](https://github.com/othneildrew/Best-README-Template)
* [Tauri](https://v2.tauri.app/)
* [React](https://react.dev/)
* [hidapi](https://github.com/libusb/hidapi)
* [Playwright](https://playwright.dev/)
* [devicePEQ](https://github.com/jeromeof/devicePEQ) for reverse-engineered DAC protocols
<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->
[contributors-shield]: https://img.shields.io/badge/contributors-1-9ece6a?style=for-the-badge&labelColor=16161e
[contributors-url]: https://github.com/Bukutsu/glacier-eq/graphs/contributors
[forks-shield]: https://img.shields.io/badge/forks-0-7aa2f7?style=for-the-badge&labelColor=16161e
[forks-url]: https://github.com/Bukutsu/glacier-eq/network/members
[stars-shield]: https://img.shields.io/badge/stars-1-7dcfff?style=for-the-badge&labelColor=16161e
[stars-url]: https://github.com/Bukutsu/glacier-eq/stargazers
[issues-shield]: https://img.shields.io/badge/issues-0-e0af68?style=for-the-badge&labelColor=16161e
[issues-url]: https://github.com/Bukutsu/glacier-eq/issues
[license-shield]: https://img.shields.io/badge/license-MIT-c0caf5?style=for-the-badge&labelColor=16161e
[license-url]: https://github.com/Bukutsu/glacier-eq/blob/main/LICENSE
[download-shield]: https://img.shields.io/badge/Download-v0.1.0--beta-7dcfff?style=for-the-badge&labelColor=16161e&logo=github
[download-url]: https://github.com/Bukutsu/glacier-eq/releases
[Tauri]: https://img.shields.io/badge/Tauri-24C8D8?style=for-the-badge&logo=tauri&logoColor=white
[Tauri-url]: https://v2.tauri.app/
[React.js]: https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[React-url]: https://reactjs.org/
[TypeScript]: https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[Rust]: https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white
[Rust-url]: https://www.rust-lang.org/
[Playwright]: https://img.shields.io/badge/Playwright-45ba4b?style=for-the-badge&logo=playwright&logoColor=white
[Playwright-url]: https://playwright.dev/
