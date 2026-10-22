# Changelog

## [Unreleased]

### Added

- In-app updates (Settings > About > Software updates). Glacier EQ checks the latest GitHub release once at launch, shows a toast when a newer one exists, and downloads it with a progress bar; you choose when to restart. Downloads are verified against Glacier EQ's update signing key before they install. Works on the AppImage, Windows installer (NSIS and MSI), and macOS builds. Distro `.deb`/`.rpm` packages, the Windows portable zip, Arch/PKGBUILD and development builds, and Android show the card greyed out with the reason; the web app does not show it.
- Opt-in live apply for Walkplay DACs (Settings > General): each EQ edit goes to the DAC's RAM about 100 ms after you make it, and is saved once you pause, so the Write to DAC button is hidden. This is the same temp-apply the official EPZ web app uses to audition an EQ. The vendor's own web tools use the same packets across Walkplay schemes. Confirmed on hardware on the EPZ TP35 Pro only; the Fosi / iBasso entry is left off because nothing confirms it uses this protocol.
- `glacier-eq-cli hardware live FILE...` applies one or more EQ files to the DAC's RAM in order, without a backup read or a flash save.
- Android, opt-in (Settings > General > **Open when a DAC is plugged in**, off by default): plugging in a supported DAC offers to open Glacier EQ, which then has permission for that DAC and connects. Ticking **Always** in Android's prompt skips the prompt next time. An approved attachment also resumes connection after a manual disconnect when the app is already running; it never switches away from an active DAC. The device list comes from the catalog (`glacier-eq-cli android-usb-filter`).
- A/B button in the graph toolbar on DACs that take temporary EQ: hold it to hear the DAC without its filters, release to hear the EQ again. Flash is never written.
- Mobile Profiles: **Use on DAC** loads a profile and saves it to the connected DAC in one step.
- Mobile: when the DAC does not have the editor's EQ, a bar above the tab bar says so and offers **Save to DAC** on the Tuning, Profiles and Settings tabs.
- Mobile: tap near a dot on the graph to edit that band. The band being edited has a ringed dot and is the only single-band curve drawn.

### Changed

- Unplugging and replugging a DAC while the app is open no longer blocks the window or shows an error. The sidebar and header say it is reconnecting, the editor keeps that DAC's limits, and on return unsaved edits are kept without asking. On Linux, a brief permission gap right after replug no longer triggers a password prompt.
- **Connect DAC** now scans and connects directly when one DAC is present, without opening the device picker first. The picker remains available when several DACs are present or connection fails. Disconnect and Change device are tucked under **Connection options** in the device summary.
- The Linux AppImage works better with AppImage managers such as Gear Lever and Shelly. It now carries its version (`X-AppImage-Version`) and a `Music` menu category in its desktop entry, embeds GitHub update information and AppStream metadata, and each release ships a matching `.AppImage.zsync` file so these tools can tell when a newer release exists.
- Adding a band on a 5- or 8-band DAC now starts it at a frequency spread across the audible range (for example 63 Hz to 12.5 kHz on 5 bands) instead of the 10-band bass-heavy list. A band you have already tuned keeps its settings.
- A frequency typed into the band's number box is kept exactly. ISO snapping now applies only to dragging and the arrow steps, so typing 3500 no longer becomes 3150.
- The Tuning tab's graph now follows its AutoEQ dropdowns: choosing a measurement or target makes it the only curve shown, so switching inputs leaves the measurement and target pair instead of piling up curves. The graph's Curves menu still turns any other curve back on.
- The frequency box steps by ratio (1/12 octave, or 1/3 octave for large steps) instead of a fixed 50/500 Hz, so steps are usable at both 20 Hz and 10 kHz.
- The Profiles tab is quieter and shows more: every saved profile has its own rename and delete buttons (and apply-to-DAC when connected), so you no longer load a profile first to manage it. The editor card shows Save, Discard, Export, and Copy directly instead of behind a menu.
- The empty EQ editor now says how many bands the current DAC has and which filter types it supports.
- FiiO JA11 is now listed as tested (both USB audio mode IDs), from community tester reports on JA11 firmware. JM12 and the KA series stay untested.
- Mobile band editor: Gain, Frequency and Q are always shown; the filter type is chosen beside the band number. "More band settings" is gone. The graph and band chips stay pinned on tall screens while the controls scroll.
- Mobile: the band chips use short frequencies (4.4k), and the Add chip disappears once every band is in use.
- Mobile: the Device tab is now the top of the Settings tab, leaving four tabs.
- Mobile: an unfinished EQ from the last session is restored automatically, with a notice to keep or discard it. An unreadable draft still asks first.
- Mobile: the graph's legend button moved from the plot into the graph toolbar, and band dots are drawn above the dB labels so a label never hides a band.
- The header title no longer changes to "Default EQ" when the app regains focus while a generated, imported, recovered or DAC-read EQ is open. A saved profile or Default EQ with changes is marked **Edited** on mobile.
- Dragging a gain slider lands on 0.1 dB steps; the number box still takes exact values.
- The Tuning tab draws the target shown in its dropdown even when no target was active, and scrolls to the result after **Generate EQ**.
- Scanning in Connect DAC connects at once when it finds exactly one DAC.
- Android: Settings > About links to the latest APK instead of showing a disabled update button.
- The Walkplay temporary apply now sends only the RAM load. It used to send the flash save as well, so Walkplay was kept off the temporary-apply list. Every Walkplay DAC except the Fosi / iBasso entry is now on it, so Profiles can apply temporarily there too.

## [0.15.0] - 2026-10-18

### Thanks

A huge thank-you to **AkariYui** for sticking with us through repeated JA11
and Dawn Pro tests. The time spent trying builds, reporting problems, and
checking the next fix has helped us work through issues we could not verify
on our own hardware. Thank you for keeping at it with us!

### Added

- JA11 microphone, USB audio mode, and hardware-volume controls, with readback and confirmation for large volume changes.
- Session-tagged HID diagnostics and timestamped CLI HID tracing through `GLACIER_TRACE`.
- A warning for AutoEQ fits with five or fewer bands, while keeping generation available.
- A read-only Default EQ card with direct load/restore actions and a temporary DAC apply action where supported.
- A rebuilt mobile Profiles screen with shared shadcn-style controls, a current-EQ card, searchable library, collapsed preview, and touch-sized load, save, import, and management actions.
- A compact device connection card with a shared status badge and quieter connection actions.
- Direct Restore and Discard actions in the mobile draft-recovery notice, without forcing the full header open.
- A pinned EQ graph while More band settings is expanded on taller mobile screens. The graph releases for the on-screen keyboard, and mobile filter dots remain display-only.
- A visible explanation when a connected DAC has no hardware EQ, with clearer original Dawn Pro sound-control support and a reason for the missing EQ Read/Write actions.

### Changed

- Organized the frontend by feature, with workspace composition in `src/app/`, shared UI controls, and directly tested device-operation factories.
- AutoEQ searches filter layouts for one to five bands; devices with six or more bands keep the previous fitting path.
- JA11 saves verify RAM before the final Save report, then wait for restart and reopen the connection. Background read recovery stays quiet and never replays writes.
- Walkplay writes use a 16 ms interval. Control changes stage their register writes before one flash commit and a 250 ms settling wait. These timings were checked on EPZ TP35 Pro hardware.
- Walkplay EQ verification rewrites once on a value mismatch before rollback. Resent global-gain reads require an agreeing independent read.
- Mobile EQ sections use flat, full-width panels. Graph controls group Curves and add on the left, with show/hide on the right.
- Toasts and the Linux permissions badge use quieter styling. Verification settings explain that required safety checks always run.

### Fixed

- Corrected JA11 signed preamp encoding and support for its two USB audio mode product IDs.
- Recognized additional Windows disconnection errors and retired old handles after an expected JA11 restart.
- Walkplay control reset no longer commits between individual register writes, which caused later writes to be dropped during flash settling.
- Replaced the DAC filter-response canvas with SVG to avoid a blank graph after closing and reopening its disclosure in WebKit.
- An unmodified DAC read is no longer saved as an unfinished editor draft.
- Walkplay control reset and final factory-reset control writes now verify every setting before reporting success. Control rollback verifies the captured state before claiming it was restored.
- Restore default uses ordinary profile loading after one confirmation and adopts the loaded EQ as its clean baseline.
- Control and factory resets reserve the shared operation slot before confirmation and cancel queued work when its device session is replaced.

### Known limitations

- TP35 microphone readback can differ by 1 dB. Control persistence after a physical power cycle is not established.
- The new reset-verification checks have fault-injection coverage but have not been physically retested.
- Windows/macOS device behavior and Android USB/lifecycle behavior still need physical-device checks.
- Local Linux builds do not establish compatibility with older distributions.

See [Release readiness](docs/release-readiness.md) for validation results and
the remaining hardware and platform limits.

## [0.14.0] - 2026-10-12

### Added

- After an unexpected close, the editor offers to restore the unfinished EQ. Restore loads it into the offline editor only; it does not connect to or write to a DAC.
- The web app applies the saved theme before rendering and offers a retry if startup fails.

### Changed

- Reworked most of the interface: the EQ editor, Tuning, Profiles, Device and Settings screens, plus dialogs and menus.
- Tuning replaces numbered step cards with grouped measurement and target fields, a separate settings panel, and collapsible advanced options and curve comparisons.
- Profiles now distinguish the saved library from the EQ in the editor. An import can be saved as a profile or loaded into the editor only.
- Tokyo Night is now the default on fresh installs. Existing theme choices are kept.
- Settings and Device use grouped lists and section views. Android Back returns to the previous list and restores focus.
- The theme picker shows previews, and Settings and Device lists show the selected values.
- Segmented controls have 48 px touch targets. Tapping empty editor space dismisses the keyboard without consuming the next tap.
- Slider changes preview while you drag. A completed drag is one Undo step; canceling restores the previous value.
- Android waits for appearance settings before releasing its startup screen. If initialization stalls, it continues after 8 seconds.
- Changing the theme does not recolor EQ traces. Imported trace colors are kept.
- Routine status messages stay quiet; errors remain visible.

### Fixed

- Numeric fields accept a decimal point or comma and reject malformed input instead of accepting a numeric prefix.
- Android resizes the editor around the keyboard, opens external links outside the app, and no longer opens the DAC chooser on launch.
- Browser EQ paste and import remain available when clipboard access is denied.
- A DAC write remains successful when the device rounds values during readback.

## [0.13.0] - 2026-10-09

### Added

- Added Glacier as the default dark theme.

### Changed

- Rebuilt tuning as a measurement, target, and EQ-generation workflow, with separate graph comparisons and advanced settings.
- Simplified mobile band editing and compact-window layouts.
- Made routine status updates quiet and integrated important feedback into the bottom edge of the interface.
- Standardized UI wording and clarified editor-only, temporary, and saved DAC changes.
- Replaced subjective DAC filter descriptions with technical explanations.
- Updated README instructions and screenshots.

### Fixed

- Corrected Android system-bar spacing and mobile text insets in About settings.
- Kept theme validation aligned with the themes available in settings.
- Strengthened WebRPC argument, AutoEQ input, and disconnect-session validation.
- Corrected channel balance slider labels.
- Built WASM before frontend verification in the GitHub Pages workflow.

## [0.12.0] - 2026-10-03

### Changed

- Simplified EQ and tuning workflows, with clearer controls and improved keyboard access.
- Redesigned the curve picker with ranked measurement search, result counts, loading feedback, and automatic search focus.
- Redesigned the DAC connection dialog for mobile and stabilized modal scrolling, sizing, and footer placement.
- Improved filled-button contrast, Android Material You styling, number-stepper colors, and settings alignment.
- Added build-provenance attestations for release assets and locked dependency resolution across platform builds.

### Fixed

- Fixed reconnect attempts racing an unfinished WebHID close.
- Fixed the clean EQ baseline referring to the previous DAC after switching devices.
- Fixed partial control resets leaving changed state behind, and made unverified device writes explicit.
- Fixed completed profile writes being reported as save failures and made profile-extension matching case-insensitive.
- Aligned web and desktop validation, including command arguments, filter types, profile names, and data limits.
- Preserved unknown theme settings instead of discarding them.
- Added diagnostic trails for user-facing failures and corrected data-loss notification severity.
- Enforced saved curve limits before restoring measurement data.
- Prevented Android WebView font boosting from disrupting layouts.
- Fixed stale curve-picker operations reporting results after the dialog closed.

## [0.11.0] - 2026-09-27

### Added

- Added a minimal offline mode that hides hardware-only controls and presents the engine's limits while no DAC is connected.
- Added an About settings section with version, system information, and project links.
- Added external link handling through the native platform opener in Tauri.

### Changed

- Changed AutoEQ to scale the correction uniformly when a DAC's preamp range cannot provide enough headroom, instead of failing the whole operation or returning a clipping result.
- Changed release and Android builds to resolve dependencies from the committed lockfile, and made the local Android release path fail fast when signing is not configured.
- Changed service-worker caches to be scoped to their registration so two deployments on the same origin can no longer share a release.

### Fixed

- Fixed dialogs failing to open: closing one dialog could immediately close the next one opened after it, which left Change Device and Diagnostics unresponsive.
- Fixed the device chooser refusing to select a device while a connection was live, leaving the Connect button permanently disabled.
- Fixed a disconnect reporting success while the device stayed open, which could leave the next connection attempt holding a half-released device.
- Fixed filter gains outside the device's wire range wrapping to a wrong value instead of being rejected, and validated filter Q as unsigned where the protocol requires it.
- Fixed WebHID global-gain reads accepting a response that arrived for an earlier, abandoned request.
- Fixed a disconnect or detach event tearing down a replacement device that had already claimed the same path.
- Fixed Android device teardown returning before the interface was actually released.
- Fixed two app windows reserving the same online-database generation, and a download reporting success after the cache was cleared.
- Fixed profile files being opened through symbolic links.
- Fixed device and editor confirmations resuming against a different device or session after their dialog was answered.
- Fixed device controls and profile import fields staying editable while a write to the DAC was in progress.
- Fixed a dropped AutoEQ file being applied after a newer, rejected drop had already superseded it.

## [0.10.1] - 2026-09-18

### Fixed

- Fixed EQ write and DAC operations failing on Windows caused by HIDAPI output padding to report length (fixes #45).
- Prevented duplicate diagnostic log entries when status toasts are displayed.

### Changed

- Enhanced diagnostic reports with system environment, platform architecture, connected device VID:PID, protocol, and transport details when copying logs.

## [0.10.0] - 2026-09-13

### Added

- Added raw HID developer CLI support for sending arbitrary reports, reading responses, repeats, and delays with explicit `--yes` confirmation.
- Added verified five-filter support for Walkplay DAC profiles, including High-Pass and Low-Pass editing.

### Changed

- Made AutoEQ choose only the Peak, LowShelf, and HighShelf filter types supported by each DAC.
- Aligned Android Material You colors with native Material 3 surface, text, outline, error, and primary roles.
- Refined DSP control spacing and Android rendering.

### Fixed

- Preserved resolved Android Material You roles across the Rust bridge so native colors reach the app.

## [0.9.0] - 2026-09-13

### Added

- Material You dynamic color theming on Android 12+, with safe system-theme fallback on older Android, desktop, and web.
- Mobile section-stack navigation for Device and Settings, with focused subsections and native momentum scrolling.
- Mobile graph preview while editing filters, profile management, undoable band removal, and centralized toast/history state.

### Changed

- Replaced icon fonts with crisp inline Lucide SVG icons and removed the service-worker registration from Tauri builds.
- Added Android HID listener permissions and kept USB DAC hotplug handling available to the native plugin.
- Refreshed mobile layouts, filter controls, diagnostics, and accessibility semantics for release use.

### Fixed

- Repainted canvas graphs when asynchronously applied Material You CSS variables change.
- Kept the Material You theme selection intact when settings are restored in Android webviews.

## [0.8.0] - 2026-09-12

### Added

- Hardware specifications HUD in the desktop sidebar displaying DAC chip, outputs, max power, decoding, DSP rate, PEQ bands, gain range, and firmware version.
- Linux one-shot USB permissions (udev rules) installer and uninstaller in Settings with automatic legacy cleanup.
- Seamless auto-connect and continuous background hotplug detection when replugging supported USB DACs.

### Changed

- Renamed packaged Linux udev rules to `69-glacier-eq.rules` so they execute before systemd's `73-seat-late.rules` seat processor.
- Added explicit `MODE="0666"` permissions to DAC udev rules alongside `TAG+="uaccess"`.
- Instant auto-connect immediately upon installing USB permissions without requiring DAC replug.
- Replaced disruptive full-screen reconnect overlays when working in secondary workspace tabs.
- Deduplicated firmware version display between the header strip and sidebar specs card.

### Performance

- Walkplay pacing tightened and validated on hardware (-46% pull latency, -47% push latency).
- AutoEQ gradient optimization inside device feasible set with gradient buffer reuse (-5.9% latency).
- High-performance single-pass measurement text scanner (-25% scan, -16% line split, -14% normalize).
- Reused internal cosine grid across frames (-2.5%) and split band/aggregate accumulators (-2.8%).
- Fast-path for already-ascending measurement curves (-11%).
- Table-driven delimiter classification (-8%).
- Hoisted band callbacks and avoided redraws for unchanged band controls.

## [0.7.0] - 2026-09-08

### Added

- Bundled reference target curves into the application for offline use.
- Desktop sidebar with grouped navigation: EQ, Tuning, and Profiles are separated from Device and Settings.

### Changed

- Redesigned the desktop workspace layout with a persistent navigation sidebar and dedicated right rail.
- Streamlined profile and tuning controls and fixed mobile horizontal scroll overflow.
- Device and Settings pages now show a focused header without EQ session details or undo/redo.
- Device and Settings content is centered with a constrained max width on desktop.
- Removed the obsolete internal tool tab strip.

### Fixed

- Fixed Linux desktop entry and icons for Wayland and KDE taskbars.
- Fixed Linux icon resolution by using Tauri-native icon paths.
- Seeded modern linuxdeploy in CI to prevent bundled libwayland white screen on AppImage.

## [0.6.0] - 2026-09-06

### Added

- Decoupled native desktop and web runtime adapters so desktop builds run without bundling WebAssembly.
- Updated high-resolution application branding and adaptive platform icons.

### Changed

- Streamlined the tuning section with unified measurement and target matching and minimal controls.
- Pull timing now uses each protocol's declared flood/gain-read delays instead of hardcoded values.

### Fixed

- Fixed multi-level redo losing the remaining redo history after the first redo.
- Fixed a crash when importing AutoEQ profiles whose comment headers contain characters that change length when lowercased (e.g. "İ").
- Fixed silent saturation of filter frequencies above 65535 Hz during AutoEQ import; they now warn and clamp.
- Fixed duplicate Android versionCodes for prerelease tags with numbers above the supported range; affected tags now fail the release build instead of colliding.
- Android versionCode prerelease bands are now disjoint (numeric, alpha, beta, rc/other) so distinct tags can never share a code.
- Release builds now verify tag/manifest versions in a fast first job instead of after the full build matrix.
- Hardened device disconnection recovery, utility setting synchronization, and profile mutation concurrency.

## [0.5.2] - 2026-08-20

### Fixed

- Fixed WalkPlay disabled-band writes by preserving valid band metadata and using zero-gain bypass semantics.
- Sanitized invalid PEQ readback values across WalkPlay, Moondrop, and FiiO protocols.
- Fixed Moondrop disabled-band writes to use valid zero-gain coefficients.
- Hardened HID device handling, disconnect recovery, settings writes, and release asset verification.
- macOS and Windows release installers are currently unsigned.

## [0.5.1] - 2026-08-14

### Added

- Added full token sets for Tokyo Night Storm, Tokyo Night Day, Nord, Dracula, Gruvbox, Catppuccin Mocha, and Catppuccin Latte themes.
- Added frequency readouts to mobile band picker chips and larger filter drag handles.
- Added a subtle film-grain texture to the app background.

### Fixed

- Rebuilt the theme token system so card borders, grid lines, and dividers use translucent layers instead of flat opaque borders.
- Fixed theme tokens across light themes (Tokyo Night Day, Catppuccin Latte) to prevent dark theme variables from leaking.
- Fixed theme dropdown labels on the Settings tab so full theme names are never cut off on small or mobile screens.
- Fixed high-contrast text and hover highlights for sidebar tabs, buttons, and navigation controls to meet WCAG AA standards.
- Hardened Android HID communication against connection teardown races, Android 12 receiver crashes, and report ID extraction failures.
- Aligned Android native libraries for 16 KB page memory support.
- Fixed biquad filter math for low sample rates and clamped balance attenuation.
- Added input bounds checks, frequency range clamping, and round-trip tests to AutoEQ optimization.
- Fixed error handling for poisoned mutex locks and improved localStorage recovery during state restoration.
- Improved accessibility labels, keyboard navigation, focus trapping, and modal safe-area insets.

## [0.5.0] - 2026-07-21

### Added

- EQ bands can now be edited directly from the frequency response graph.
- Graph bands now respond to mouse wheel adjustments.
- The app now respects the connected DAC's capabilities, including band limits and other constraints.

### Fixed

- Restored smooth scrolling in the tuning section.
- Fixed recovery when the desktop HID connection drops.
- Fixed race conditions between editor and device state changes.

### Changed

- Reworked the tuning tab to match the tuning workflow.
- Combined measurement tuning, collapsible sections, and profile saving into one flow.
- Made profile and device states clearer.
- Separated profile search from profile saving.
- Added instructions for connecting a DAC for the first time.
- Replaced dialogs with accessible versions and kept error messages visible.
- Shortened the desktop tuning workflow and moved task content ahead of secondary content on mobile.

## [0.4.2] - 2026-07-15

### Added

- Added the offline CLI and shared device architecture.
- Added a Linux polkit/pkexec fallback for USB permissions.
- Added CLI documentation to the project wiki.

### Fixed

- The Profile Library now scrolls when its contents exceed its height.
- Profile names now accept `@` and other common symbols.
- Fixed automatic file naming after AutoEQ imports.
- Added learning rate decay to AutoEQ optimization.

### Changed

- Adjusted the mobile UI and Android theme defaults.
- Simplified device and platform integration.
- Updated the project screenshot and release tooling.

[0.6.0]: https://github.com/Bukutsu/glacier-eq/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/Bukutsu/glacier-eq/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/Bukutsu/glacier-eq/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/Bukutsu/glacier-eq/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/Bukutsu/glacier-eq/compare/v0.4.1...v0.4.2
