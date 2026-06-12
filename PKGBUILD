# Maintainer: Bukutsu <bukutsu@users.noreply.github.com>
# Source: https://github.com/Bukutsu/glacier-eq

pkgname=glacier-eq-git
pkgver=r108.75057ec
pkgrel=1
pkgdesc="Cross-platform parametric EQ editor for USB DACs. Offline, direct, and built for dense tuning work on desktop and Android."
arch=('x86_64' 'aarch64')
url="https://github.com/Bukutsu/glacier-eq"
license=('MIT')
depends=(
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
  'nodejs'
  'npm'
  'cargo'
  'rust'
  'pkg-config'
  'openssl'
  'appmenu-gtk-module'
  'libappindicator-gtk3'
  'systemd'
)
provides=('glacier-eq')
conflicts=('glacier-eq')
install="${pkgname}.install"
source=("git+${url}.git")
sha256sums=('SKIP')

pkgver() {
  cd glacier-eq
  ( set -o pipefail
    git describe --long --abbrev=7 2>/dev/null | sed 's/\([^-]*-g\)/r\1/;s/-/./g' ||
    printf "r%s.%s" "$(git rev-list --count HEAD)" "$(git rev-parse --short=7 HEAD)"
  )
}

prepare() {
  cd glacier-eq
  npm ci
}

build() {
  cd glacier-eq
  npm run tauri -- build --no-bundle
}

package() {
  cd glacier-eq

  # Binary
  install -Dm755 "target/release/glacier-eq" "${pkgdir}/usr/bin/glacier-eq"

  # Desktop file
  install -Dm644 "desktop/glacier-eq.desktop" "${pkgdir}/usr/share/applications/glacier-eq.desktop"

  # Icons
  install -Dm644 "src-tauri/icons/32x32.png"   "${pkgdir}/usr/share/icons/hicolor/32x32/apps/glacier-eq.png"
  install -Dm644 "src-tauri/icons/64x64.png"   "${pkgdir}/usr/share/icons/hicolor/64x64/apps/glacier-eq.png"
  install -Dm644 "src-tauri/icons/128x128.png"  "${pkgdir}/usr/share/icons/hicolor/128x128/apps/glacier-eq.png"
  install -Dm644 "src-tauri/icons/128x128@2x.png" "${pkgdir}/usr/share/icons/hicolor/256x256/apps/glacier-eq.png"
  install -Dm644 "src-tauri/icons/icon.png"    "${pkgdir}/usr/share/icons/hicolor/scalable/apps/glacier-eq.png"
}
