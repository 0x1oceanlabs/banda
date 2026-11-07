// Writes the AUR package of a Linux release (ADR 0033, decision 5; the
// research note docs/research/2026-11-02-linux-distribution.md), to push
// to the AUR as `banda-bin`. Nothing runs it until Banda is promoted from
// a Dev once a day (ADR 0092, step 6): the release workflow ran it for a
// Stable built from a tag, and builds none since its step 2.
//
//   node scripts/aur.mjs <stable|dev> <version> <AppImage> <folder>
//
// It writes the folder's PKGBUILD and .SRCINFO whole, so the AUR holds
// no copy to keep in step. The package takes the release's AppImage
// apart into /opt, where Banda finds no APPIMAGE: it neither updates
// itself nor lists itself in the launcher, which pacman does for it. Its
// `package-type` says pacman owns it, as electron-builder's own packages
// say theirs, so Banda runs its engine where pacman put it, not from a
// copy of its own (ADR 0086, decision 2). electron-updater reads that
// file too, and would update through `sudo pacman -U`: Banda's update
// (client/desktop/src/update.ts) leaves it alone with no APPIMAGE.
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { CHANNELS, DESCRIPTION } from "../client/desktop/src/channel.ts"

const [which, version, image, folder] = process.argv.slice(2)
const channel = CHANNELS[which]
if (!["stable", "dev"].includes(which) || !version || !image || !folder) {
  throw new Error("aur.mjs <stable|dev> <version> <AppImage> <folder>")
}
const sha256 = createHash("sha256").update(readFileSync(image)).digest("hex")
const name = `${channel.folder}-bin`
const app = channel.folder
// pacman's versions have no "-": Dev's 0.1.0-dev.9 is 0.1.0_dev.9.
const pkgver = version.replaceAll("-", "_")
const desc = DESCRIPTION.replace(/^an? (.)/i, (_, first) => first.toUpperCase())
const file = `${app}-${version}-x86_64.AppImage`
const url = `https://github.com/0x1oceanlabs/banda/releases/download/v${version}/${file}`
// What Electron's Chromium loads; git for the Projects' changes.
const depends = ["alsa-lib", "git", "gtk3", "libxss", "nss"]
const optdepends = ["npm: npx, which starts the Harnesses' ACP adapters"]

const fields = (key, values) => values.map((value) => `${key} = ${value}`)
const quoted = (values) => values.map((value) => `"${value}"`).join(" ")

const pkgbuild = `# Written by the release workflow of 0x1oceanlabs/banda (scripts/aur.mjs):
# a change here is lost at the next release.
# Maintainer: 0x1oceanlabs <https://github.com/0x1oceanlabs/banda>
pkgname=${name}
_app=${app}
_version=${version}
pkgver=${pkgver}
pkgrel=1
pkgdesc='${desc}'
arch=('x86_64')
url='https://banda.so'
license=('Apache-2.0')
depends=(${quoted(depends)})
optdepends=(${quoted(optdepends)})
provides=('${app}')
conflicts=('${app}')
options=('!strip' '!debug')
source=("\${_app}-\${_version}-x86_64.AppImage::https://github.com/0x1oceanlabs/banda/releases/download/v\${_version}/\${_app}-\${_version}-x86_64.AppImage")
noextract=("\${_app}-\${_version}-x86_64.AppImage")
sha256sums=('${sha256}')

prepare() {
  chmod +x "\${_app}-\${_version}-x86_64.AppImage"
  rm -rf squashfs-root
  "./\${_app}-\${_version}-x86_64.AppImage" --appimage-extract >/dev/null
}

package() {
  cd squashfs-root
  install -d "\${pkgdir}/opt/\${_app}" "\${pkgdir}/usr/bin"
  cp -a --no-preserve=ownership . "\${pkgdir}/opt/\${_app}/"
  rm -r "\${pkgdir}/opt/\${_app}"/{AppRun,.DirIcon,usr,"\${_app}.desktop","\${_app}.png"}
  printf 'pacman\\n' > "\${pkgdir}/opt/\${_app}/resources/package-type"
  chmod -R u+rwX,go+rX,go-w "\${pkgdir}/opt/\${_app}"
  chmod 4755 "\${pkgdir}/opt/\${_app}/chrome-sandbox"
  ln -s "/opt/\${_app}/\${_app}" "\${pkgdir}/usr/bin/\${_app}"
  install -Dm644 "usr/share/icons/hicolor/512x512/apps/\${_app}.png" \\
    "\${pkgdir}/usr/share/icons/hicolor/512x512/apps/\${_app}.png"
  sed -e "s|^Exec=AppRun|Exec=/usr/bin/\${_app}|" -e '/^X-AppImage/d' "\${_app}.desktop" |
    install -Dm644 /dev/stdin "\${pkgdir}/usr/share/applications/\${_app}.desktop"
  install -Dm644 resources/LICENSE "\${pkgdir}/usr/share/licenses/\${pkgname}/LICENSE"
}
`

const srcinfo = [
  `pkgbase = ${name}`,
  ...[
    `pkgdesc = ${desc}`,
    `pkgver = ${pkgver}`,
    "pkgrel = 1",
    "url = https://banda.so",
    "arch = x86_64",
    "license = Apache-2.0",
    ...fields("depends", depends),
    ...fields("optdepends", optdepends),
    `provides = ${app}`,
    `conflicts = ${app}`,
    `noextract = ${file}`,
    "options = !strip",
    "options = !debug",
    `source = ${file}::${url}`,
    `sha256sums = ${sha256}`,
  ].map((line) => `\t${line}`),
  "",
  `pkgname = ${name}`,
  "",
].join("\n")

mkdirSync(folder, { recursive: true })
writeFileSync(join(folder, "PKGBUILD"), pkgbuild)
writeFileSync(join(folder, ".SRCINFO"), srcinfo)
