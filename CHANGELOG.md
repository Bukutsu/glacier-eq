# Changelog

## [0.5.0] - 2026-07-21

### Added

- Added ability to edit EQ bands directly from the frequency response graph.
- Added mouse wheel adjustment support for graph bands.
- Allowed the app to honor specific capabilities of connected DACs (band limits, constraints).

### Fixed

- Restored smooth scrolling in the tuning section.
- Fixed reliable recovery from desktop HID disconnects.
- Protected editor and device state transitions from race conditions.

### Changed

- Revamped the UI to simplify the tuning tab layout and align with actual tuning workflows.
- Unified measurement tuning flow, collapsible sections, and profile save actions.
- Clarified profile and device states to reduce user confusion.
- Separated profile search from profile saving workflows.
- Added guidance for the first-time DAC connection experience.
- Switched to accessible dialogs and persisted error messages for better visibility.
- Streamlined desktop tuning workflows and prioritized mobile task content.

## [0.4.2] - 2026-07-15

### Added

- Added the offline CLI and shared device architecture.
- Added Linux polkit/pkexec fallback for USB permissions.
- Added CLI documentation to the project wiki.

### Fixed

- Made the Profile Library list scroll when it exceeds the component height.
- Allowed `@` and other common symbols in profile names.
- Fixed automatic file naming after AutoEQ imports.
- Applied learning-rate decay during AutoEQ optimization.

### Changed

- Refined the mobile UI and Android theme defaults.
- Simplified device and platform integration.
- Updated the project screenshot and release tooling.

[0.5.0]: https://github.com/Bukutsu/glacier-eq/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/Bukutsu/glacier-eq/compare/v0.4.1...v0.4.2
