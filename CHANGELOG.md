# Changelog

## [Unreleased]

### Fixed

- Fixed multi-level redo losing the remaining redo history after the first redo.
- Fixed a crash when importing AutoEQ profiles whose comment headers contain characters that change length when lowercased (e.g. "İ").
- Fixed silent saturation of filter frequencies above 65535 Hz during AutoEQ import; they now warn and clamp.
- Fixed duplicate Android versionCodes for prerelease tags with numbers above the supported range; affected tags now fail the release build instead of colliding.
- Android versionCode prerelease bands are now disjoint (numeric, alpha, beta, rc/other) so distinct tags can never share a code.
- Release builds now verify tag/manifest versions in a fast first job instead of after the full build matrix.

### Changed

- Pull timing now uses each protocol's declared flood/gain-read delays instead of hardcoded values.

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

[0.5.2]: https://github.com/Bukutsu/glacier-eq/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/Bukutsu/glacier-eq/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/Bukutsu/glacier-eq/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/Bukutsu/glacier-eq/compare/v0.4.1...v0.4.2
