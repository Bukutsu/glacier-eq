# Maintainer: Bukutsu <bukutsu@users.noreply.github.com>
# Source: https://github.com/Bukutsu/glacier-eq

pkgname=glacier-eq-git
pkgver=v0.4.2.r17.g3570df0
pkgrel=1
pkgdesc="Cross-platform parametric EQ editor for USB DACs. Offline, direct, and built for dense tuning work on desktop and Android."
arch=('x86_64' 'aarch64')
url="https://github.com/Bukutsu/glacier-eq"
license=('GPL-3.0-only')
depends=(
  'polkit'
  'webkit2gtk-4.1'
  'libayatana-appindicator'
  'librsvg'
  'hicolor-icon-theme'
  'desktop-file-utils'
  'gtk3'
  'glib2'
  'cairo'
  'gdk-pixbuf2'
  'pango'
  'libsoup3'
)
makedepends=(
  'git'
  'npm'
  'rust-wasm'
  'pkg-config'
)
provides=('glacier-eq')
conflicts=('glacier-eq')

# Build from local checkout instead of re-cloning.
# Keeps the README flow (clone → cd → makepkg -si) lean.
source=()
sha256sums=()

_origin="${PWD}"

pkgver() {
  cd "$_origin"
  ( set -o pipefail
    git describe --long --abbrev=7 2>/dev/null | sed 's/\([^-]*-g\)/r\1/;s/-/./g' ||
    printf "r%s.%s" "$(git rev-list --count HEAD)" "$(git rev-parse --short=7 HEAD)"
  )
}

prepare() {
  cd "$_origin"
  npm ci
}

build() {
  cd "$_origin"
  npm run tauri -- build --no-bundle
  cargo build --release -p glacier-core --bin glacier-eq-cli
}

package() {
  cd "$_origin"

  # Binaries
  install -Dm755 "target/release/glacier-eq" "${pkgdir}/usr/bin/glacier-eq"
  install -Dm755 "target/release/glacier-eq-cli" "${pkgdir}/usr/bin/glacier-eq-cli"

  # Desktop file
  install -Dm644 "desktop/glacier-eq.desktop" "${pkgdir}/usr/share/applications/glacier-eq.desktop"

  # Icons
  install -Dm644 "src-tauri/icons/32x32.png"   "${pkgdir}/usr/share/icons/hicolor/32x32/apps/glacier-eq.png"
  install -Dm644 "src-tauri/icons/64x64.png"   "${pkgdir}/usr/share/icons/hicolor/64x64/apps/glacier-eq.png"
  install -Dm644 "src-tauri/icons/128x128.png"  "${pkgdir}/usr/share/icons/hicolor/128x128/apps/glacier-eq.png"
  install -Dm644 "src-tauri/icons/128x128@2x.png" "${pkgdir}/usr/share/icons/hicolor/256x256/apps/glacier-eq.png"
  install -Dm644 "src-tauri/icons/icon.png"    "${pkgdir}/usr/share/icons/hicolor/scalable/apps/glacier-eq.png"

  # Udev rules
  install -Dm644 "udev/99-glacier-eq.rules" "${pkgdir}/usr/lib/udev/rules.d/99-glacier-eq.rules"
}
