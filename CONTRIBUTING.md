# Contributing to Banda

Thank you for looking. Banda is young and moves fast, and most of its code
is written by Agents working to the rules in [`AGENTS.md`](AGENTS.md).
Those rules hold for you too.

## Before you write code

- **Open an issue first** for anything larger than a fix: what you want,
  and why. Banda's shape is set by its decisions in
  [`docs/adr/`](docs/adr/), and a change that goes against one needs a new
  decision before it needs code.
- Read [`GLOSSARY.md`](GLOSSARY.md): Banda's words (Space, Pane, Thread,
  Agent, Harness, Person) mean one thing each, in the code and in the UI.

## Your change

- Build and run it as the [README](README.md#build-it) says. A build from
  a checkout is Banda Local and never touches an installed Banda's Spaces.
- `scripts/check.sh` must pass: formatting, lints, types, the Rust and
  TypeScript tests, and the window's end-to-end tests.
- One change per PR, its title saying what it does.

## What happens to your PR

CI does not run on a PR from a fork: Banda's runners are its own machine,
and they run only code from this repository. Roma reads your PR, and to
take it in pushes your commits to a branch here, where CI runs, and merges
that by hand. Your commits keep your name.

## License

Banda is under the [Apache License 2.0](LICENSE). What you contribute comes
in under the same license (its section 5); there is nothing to sign.

## Security

Please do not open an issue for a vulnerability: [`SECURITY.md`](SECURITY.md)
says how to report one privately.
