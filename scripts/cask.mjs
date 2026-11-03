// Writes the Homebrew cask of a Mac release (ADR 0033, decision 6), for
// the release workflow to put in the tap 0x1oceanlabs/homebrew-banda:
//
//   node scripts/cask.mjs <stable|dev> <version> <zip> > Casks/<name>.rb
//
// The cask is written whole each time, so the tap holds no other copy of
// it to keep in step: its version and the zip's sha256 are all that
// change from one release to the next.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { basename } from "node:path"

import { CHANNELS, DESCRIPTION } from "../app/desktop/src/channel.ts"

const [which, version, zip] = process.argv.slice(2)
const channel = CHANNELS[which]
if (!["stable", "dev"].includes(which) || !version || !zip) {
  throw new Error("cask.mjs <stable|dev> <version> <zip>")
}
const sha256 = createHash("sha256").update(readFileSync(zip)).digest("hex")
// The zip as electron-builder names it (artifactName), with the version
// left to the cask, so `brew` reads one version.
const file = basename(zip).replace(version, "#{version}")
const app = `${channel.name}.app`
// brew's audit wants no article first.
const desc = DESCRIPTION.replace(/^an? (.)/i, (_, first) => first.toUpperCase())
const support = `~/Library/Application Support`

process.stdout.write(`# Written by the release workflow of 0x1oceanlabs/banda
# (scripts/cask.mjs): a change here is lost at the next release.
cask "${channel.folder}" do
  version "${version}"
  sha256 "${sha256}"

  url "https://github.com/0x1oceanlabs/banda/releases/download/v#{version}/${file}"
  name "${channel.name}"
  desc "${desc}"
  homepage "https://banda.so"

  depends_on arch: :arm64

  app "${app}"

  # Signed ad hoc, not notarized: without its quarantine Gatekeeper lets it open.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/${app}"]
  end

  zap trash: [
    "${support}/${channel.folder}",
    "${support}/${channel.name}",
    "~/Library/Caches/${channel.appId}",
    "~/Library/Caches/${channel.appId}.ShipIt",
    "~/Library/Preferences/${channel.appId}.plist",
    "~/Library/Saved Application State/${channel.appId}.savedState",
  ]
end
`)
