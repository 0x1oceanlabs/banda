# Banda

A tiling workspace for working with Agents: a desktop app first, then your own
server or our cloud, then teams.

How it is built: [`docs/architecture.md`](docs/architecture.md), the
decisions in [`docs/adr/`](docs/adr/), the words in
[`GLOSSARY.md`](GLOSSARY.md).

## Run it

You need Rust (stable), Node 24 and pnpm 11.

```sh
pnpm install
cargo build                              # the engine and the fake agent
pnpm --filter @banda/desktop start     # builds the page and opens the window
```

Without `~/.config/banda/harnesses.toml` the engine offers Claude Code
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

## Check it

```sh
scripts/check.sh               # everything: Rust, types, lints, tests, the window
scripts/check.sh --no-window   # without the window's end-to-end tests
```
