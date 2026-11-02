## Design principles

UNIX composition + deep modules + explicit contracts.

- Small interfaces hide substantial complexity.
- Contracts define ownership, permissions, outcomes and failures, not just
  data formats.
- Splitting code into more packages does not, by itself, make the design
  modular.
- Complexity is added only on a user's request or with a new module.

## Before you change things

- The words: [`GLOSSARY.md`](GLOSSARY.md). Use its terms exactly.
- The shape: [`docs/architecture.md`](docs/architecture.md).
- The decisions: [`docs/adr/`](docs/adr/). A change that contradicts an ADR
  needs a new ADR first.

## Workflow

One change, one branch, one PR. Nothing is pushed straight to `main`.

Each branch has its own worktree in `../banda-worktrees/<slug>`, never
loose beside the main checkout:
`git worktree add -b <kind>/<slug> ../banda-worktrees/<slug> origin/main`.
Remove it once its PR is merged.

Before a PR, run `scripts/check.sh --no-window`. CI runs every part,
the window's end-to-end tests too, on runners on devbox
([`ci/README.md`](ci/README.md)); the `ci` status sums them up. Merge with
`gh pr merge --auto --rebase` and go on: the PR merges itself once `ci` is
green. A red `ci` is yours to fix, on the PR or, after a merge, on `main`.

Renovate opens the dependency PRs on Mondays
([`.github/renovate.json5`](.github/renovate.json5)), and none merges
itself. An agent takes one: reads what changed in the release notes, makes
`ci` green on its branch, then merges it as above, or closes it with the
reason. A major waits unopened on the Dependency Dashboard issue: tick its
box to get the PR.

## Effect in the window's main process

Electron main is written in Effect 4: `app/desktop/src` (not the
preload), `app/desktop-kit` and the modules' `desktop` parts, never the
page
([ADR 0020](docs/adr/0020-the-windows-main-process-is-written-in-effect.md)):

- A part of main is a service: `class X extends Context.Service<X, {…}>()("banda/X")`,
  with a `static layer` that builds it. A service a module uses of main
  is a tag in `@banda/desktop-kit`, and main builds its layer
  (`Window`'s, which only says which window it is, comes with it). What it starts it starts in the
  layer's scope (`Effect.forkScoped`), so disposing the runtime stops it.
- Electron's callbacks are the edge: each runs one effect. Those
  `main.ts` registers run on its runtime (`runtime.runPromise`,
  `runtime.runFork`); those a service's layer registers, as Electron's
  or a library's handlers, run on a runner of the layer's scope
  (`FiberSet.makeRuntimePromise`), so they stop with it. Nowhere else
  runs an effect.
- Input from outside main (the page, an extension, a CDP client, a
  program's output) is decoded with `Schema`. The contract's types are
  not written again in `Schema`; they come from Rust.
- Errors a caller can act on are tagged classes (`Data.TaggedError`).
- Tests are `@effect/vitest` beside the code (`src/*.test.ts`): a fake
  layer, or `TestClock` for time.

## Research

`docs/research/` keeps dated evidence with its source and limits. It is
not a decision; ADRs are.
