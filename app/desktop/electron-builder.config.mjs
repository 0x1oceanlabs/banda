// Packs the window, the engine and the page into one app (ADR 0033, step 2):
// scripts/package.sh runs it once the engine, the page and main are built,
// with the same BANDA_CHANNEL and BANDA_VERSION.
import { CHANNELS, DESCRIPTION } from "./src/channel.ts"

const channel = CHANNELS[process.env.BANDA_CHANNEL || "local"]
if (!channel) throw new Error("BANDA_CHANNEL is stable, dev or local.")
const version = process.env.BANDA_VERSION
if (!version) throw new Error("BANDA_VERSION names the version to pack.")

/** @type {import("electron-builder").Configuration} */
export default {
  appId: channel.appId,
  productName: channel.name,
  executableName: channel.folder,
  // The packed package.json: the app's name, version and description, and
  // its entry's name, as main names the window's class (src/main.ts).
  extraMetadata: {
    name: channel.folder,
    version,
    description: DESCRIPTION,
    desktopName: `${channel.folder}.desktop`,
  },
  // Main and its preload are bundled (build.mjs); the packages it leaves
  // out of the bundle come from node_modules.
  files: ["out/**"],
  // Where main looks for them packed: resources/banda and resources/web/dist.
  // Beside them, Banda's license and the notices of what it is built from
  // (scripts/licenses.mjs, ADR 0038).
  extraResources: [
    { from: "../../target/release/banda", to: "banda" },
    { from: "../web/dist", to: "web/dist" },
    { from: "../../LICENSE", to: "LICENSE" },
    { from: "../../NOTICE", to: "NOTICE" },
    {
      from: "../../target/release/THIRD-PARTY-NOTICES.txt",
      to: "THIRD-PARTY-NOTICES.txt",
    },
  ],
  artifactName: `${channel.folder}-\${version}-\${arch}.\${ext}`,
  icon: channel.icon,
  linux: { category: "Development", target: ["AppImage"] },
  // Apple silicon, signed ad hoc until there is a certificate (ADR 0033,
  // decision 6): a zip of the app. Ad hoc, the hardened runtime would
  // refuse Electron's own frameworks, signed by another team.
  mac: {
    category: "public.app-category.developer-tools",
    target: [{ target: "zip", arch: ["arm64"] }],
    identity: "-",
    hardenedRuntime: false,
  },
  // The static runtime, with FUSE 3 inside: it runs where only fuse3 is,
  // as on Omarchy, with no libfuse2.
  toolsets: { appimage: "1.0.3" },
  // Releases are published by the release workflow (step 3), not here:
  // scripts/package.sh packs with --publish never. The entry makes
  // electron-builder write the update file electron-updater reads beside
  // the AppImage, and app-update.yml into it (ADR 0041, decision 1). A
  // checkout's Banda Local never updates.
  publish:
    channel === CHANNELS.local
      ? null
      : { provider: "github", owner: "0x1oceanlabs", repo: "banda" },
}
