# Changelog

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

[0.5.0]: https://github.com/Bukutsu/glacier-eq/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/Bukutsu/glacier-eq/compare/v0.4.1...v0.4.2
