# Glacier EQ Project Rules

## Version Bumps and Release
- Whenever bumping the application version, you must update:
  - `package.json`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
- **CRITICAL**: After updating these files, you MUST run `cargo check` at the workspace root to ensure `Cargo.lock` is synchronized with the new version. Failure to do so will cause the CI/CD pipeline to fail because of the `--locked` flag.
