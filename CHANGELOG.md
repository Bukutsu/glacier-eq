# Changelog

## [Unreleased]

### Fixed

- Removed the unsupported original Dawn Pro HID PEQ assumption behind #46. The original Dawn Pro uses a different protocol from Dawn Pro 2.
- Corrected FiiO reply framing, command matching, gain encoding, USER slots, filter count/save commands, and KA17 report ID. Reading no longer changes the active preset.
- Corrected Dawn Pro 2's eight-band, 96 kHz coefficient packets, custom preset/latch, preamp, and separate EQ/offset saves.
- Validate HID report IDs and payload lengths before protocol I/O on desktop, CLI, Android, and WebHID. Windows Moondrop output uses control reports rather than short interrupt writes.

### Changed

- Match only exact, reference-backed USB model IDs. Untested models with unresolved write contracts are read-only, including Dawn Pro 2 pending activation/preamp recovery testing.
- Preserve the tested EPZ/TRN Walkplay save sequence and nonce correlation. Unverified models use zero in the reserved nonce field.
- Block unverified microphone writes and control reset before any changes. Device details show the restriction reason.
- Document protocol evidence, removed support claims, fixture provenance, and the remaining hardware checks in `docs/device-validation.md`.

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
