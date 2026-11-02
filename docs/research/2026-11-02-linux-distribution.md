# How Banda can reach Linux

2026-11-02. Asked by Roma: how to give Banda to people on Linux conveniently, through repositories such as the AUR or Flatpak, starting simple but with the whole picture. ADR 0033 decided on an AppImage first (decision 5) and the AUR later. This note weighs every way against what Banda does.

**What Banda needs from the system.** These decide most of it:

- It starts programs of the Person's: Claude Code, Codex, `npx` for their ACP adapters, the shells of its terminals (`pty-process`), `git`, and `hyprctl` and `gsettings` for the look.
- It reads files outside its own folders: any folder a Space is (ADR 0026), Omarchy's theme, the desktop's wallpaper (ADR 0030), and Hyprland's socket.
- Dev changes on every merge into `main`, many times a day (ADR 0033, decision 3).

## The ways

| Way | Who gets it | Updates | Fits Banda? | Work for us |
|---|---|---|---|---|
| **AppImage** | anyone on x64 Linux, one file | by itself (electron-updater) | yes: no sandbox | built now (step 2) |
| **tar.gz** | anyone, unpacked anywhere | by hand | yes | one more electron-builder target |
| **AUR** (`banda-bin`) | Arch and Omarchy, `yay -S banda-bin` | with the system (`yay -Syu`) | yes | a PKGBUILD, pushed on each Stable by CI |
| **.deb / .rpm** from Releases | Ubuntu, Debian, Fedora | by hand | yes | electron-builder targets |
| **apt / dnf repository** | Ubuntu, Debian, Fedora | with the system | yes | a signed repository to host (GitHub Pages, or Cloudsmith/packagecloud, free for open source) |
| **Flathub** | every distro, GNOME Software, KDE Discover | with the system | badly: sandbox | build from source on Flathub, offline |
| **Snap Store** | Ubuntu first | by itself | only "classic" confinement | approval by Canonical |
| **Nix** | NixOS | with the system | yes | usually packaged by the community |

## What each means for Banda

- **AppImage** runs as a plain program: Banda sees the Person's PATH, folders and sockets as from a checkout.
  - electron-builder's legacy runtime needs `libfuse2`, which Omarchy and newer Ubuntu leave out. Its toolset `1.0.3` packs the static type2 runtime with FUSE 3 inside. Tried on Omarchy (fuse3 only): it mounts and runs.
  - It isn't listed among the desktop's apps by itself. Banda writes its own entry on each start (`app/desktop/src/entry.ts`).
  - It is the only way that updates itself, fitting Dev's many builds a day.
- **AUR** is how Omarchy installs software (Omarchy's own installer uses it). A `-bin` package downloads the release built here, so the AUR builds nothing. It needs public releases (ADR 0033, decision 10) and Roma's AUR account, with an SSH key that CI pushes with. Stable only: a package that changes many times a day burdens everyone who updates their system.
- **.deb and .rpm** come from the same electron-builder run. As files on a release they don't update. A repository that `apt upgrade` reads has to be hosted and signed; it is worth it when people on Ubuntu ask.
- **Flathub** puts the app in a sandbox:
  - Everything Banda starts (the Harnesses, a terminal's shell, `git`) would run inside it, without the Person's tools, unless through `flatpak-spawn --host` with the permission to talk to Flatpak, as code editors on Flathub do.
  - The look's readers and any Space's folder need holes in the sandbox too.
  - Flathub builds from source without network, so the crates and npm packages would have to be vendored.
  - Much work, against what Banda is. Not now.
- **Snap** has the same sandbox; "classic" confinement lifts it, but only after a review by Canonical. Not now.
- **Nix**: a flake in the repository is cheap once it is public, and someone in the community usually packages it.

From knowledge, not verified today: what Flatpak, Snap and Nix need beyond the sandbox, and that Omarchy installs through the AUR. The AppImage runtime was checked in electron-builder 26.18.0's schema and tried on this machine.

## The order

1. **Now: the AppImage**, for Stable and Dev, built here and on CI. People get the file; Dev, and Stable once public, update by themselves.
2. **With the first public Stable: `banda-bin` in the AUR**, pushed by the release workflow.
3. **When people on Ubuntu or Fedora ask: .deb and .rpm**, then a repository for them.
4. **Not now**: Flathub and Snap (the sandbox), until a Banda without its own terminals and Harnesses makes sense in one.
