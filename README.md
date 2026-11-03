# Banda

A tiling workspace for working with Agents: a desktop app first, then your own
server or our cloud, then teams.

Each project is a Space. In it, Panes sit side by side in columns you scroll
through: Threads where you work with an Agent (Claude Code or Codex), the
terminal, a browser, the Diff of what changed. You work with Agents you
already have, in the folders you already have.

Banda is young: it runs on Linux now, and macOS comes next.

## Install it

Download the newest AppImage from
[Releases](https://github.com/0x1oceanlabs/banda/releases), make it
executable, and start it:

```sh
chmod +x banda-*-x86_64.AppImage
./banda-*-x86_64.AppImage
```

It adds itself to your launcher on its first start. Two builds install side
by side and keep apart:

- **Banda** (`banda-0.X.Y-x86_64.AppImage`): the one to work in.
- **Banda Dev** (`banda-dev-0.X.Y-dev.N-x86_64.AppImage`, a pre-release):
  what `main` is now, out after every merge.

It needs FUSE 3, as most distributions have.

## What it needs

- **A Harness**: Claude Code (`claude`) or Codex (`codex`), installed and
  logged in, and recent: Banda says so if it is too old. It runs as it
  would in your terminal, so its account, its plan and its settings are
  yours.
- **Node.js with `npx`**: Banda talks to each Harness through its Agent
  Client Protocol adapter, which `npx` fetches the first time.

## What it sends

Nothing of its own: there is no account and no telemetry, and a crash is
kept on your machine. Your Agents talk to their providers as they do in a
terminal, and the browser loads the pages you or your Agents open.

## Build it

How it is built: [`docs/architecture.md`](docs/architecture.md), the
decisions in [`docs/adr/`](docs/adr/), the words in
[`GLOSSARY.md`](GLOSSARY.md). How to help: [`CONTRIBUTING.md`](CONTRIBUTING.md).

### Run it from a checkout


You need Rust (stable), Node 24 and pnpm 11.

```sh
pnpm install
cargo build                              # the engine and the fake agent
pnpm --filter @banda/desktop start     # builds the page and opens the window
```

A build from a checkout is Banda Local: it keeps its things in folders of
its own (`~/.config/banda-local`, `~/.local/share/banda-local`,
`~/.local/state/banda-local`) and its window's class is `banda-local`, so
it runs beside an installed Banda without touching its Spaces (ADR 0033).
`BANDA_CHANNEL=stable` or `dev`, set for `cargo build` and the window's
build alike, makes it Banda or Banda Dev instead.

Without `~/.config/banda-local/harnesses.toml` the engine offers Claude Code
and Codex. To try the window without a paid model, list the fake agent
there instead:

```toml
[[harness]]
id = "fake"
name = "Fake AI"
command = "/path/to/banda/target/debug/banda-fake-agent"
```

For the page with live reload, run `pnpm --filter @banda/web dev` and,
beside it, `pnpm --filter @banda/desktop dev`.

### Pack it

```sh
scripts/package.sh dev    # or stable, or local: app/desktop/dist/*.AppImage
```

It builds the engine for release, the page and the window, and packs them
into an AppImage (ADR 0033). `BANDA_VERSION` names its version, `0.X.Y` or
`0.X.Y-dev.N`; unset, it is the workspace's, marked local. On its first
start the AppImage lists itself among the desktop's apps. The release
workflow packs and publishes Dev on every green push to `main`, and Stable
on a tag `v0.X.Y` (`.github/workflows/release.yml`). While the repository
is private, `gh` fetches one:

```sh
gh release list --repo 0x1oceanlabs/banda           # the newest first
gh release download v0.1.0-dev.42 --repo 0x1oceanlabs/banda --pattern '*.AppImage'
```

The ways to bring Banda to Linux: [`docs/research/2026-11-02-linux-distribution.md`](docs/research/2026-11-02-linux-distribution.md).

### Check it

```sh
scripts/check.sh               # everything: Rust, types, lints, tests, the window
scripts/check.sh --no-window   # without the window's end-to-end tests
```

## License

Banda is under the [Apache License 2.0](LICENSE). It includes code from T3
Code, Ghostty and the Nerd Fonts under their MIT licenses; [`NOTICE`](NOTICE)
says which and where.
