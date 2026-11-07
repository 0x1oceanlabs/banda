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
- Where it is going: [the architecture vision](docs/research/2026-11-06-architecture-vision.md),
  accepted on 2026-11-06, with its roadmap and PR plan.
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
That is for Roma's PRs and yours. A PR with someone else's commits, taken
in from a fork, Roma merges by hand: never arm auto-merge on it
([ADR 0038](docs/adr/0038-banda-is-open-source-under-apache-2-0.md),
decision 4).

Renovate opens the dependency PRs on Mondays
([`.github/renovate.json5`](.github/renovate.json5)), and none merges
itself. An agent takes one: reads what changed in the release notes, makes
`ci` green on its branch, then merges it as above, or closes it with the
reason. A major waits unopened on the Dependency Dashboard issue: tick its
box to get the PR.

## See what you changed

A change that shows in the window, you try in the window before its PR:
start a trial of your worktree and drive it yourself over CDP.

```sh
scripts/try.sh --hidden --detach   # builds, starts, waits for a good start
scripts/drive.mjs shot             # a picture: read the PNG it prints
scripts/drive.mjs snapshot         # what the page shows, by roles and names
scripts/drive.mjs click 'role=button[name="Settings"]'
scripts/drive.mjs press Alt+Space
scripts/try.sh --stop
```

The trial is your worktree's alone: its Projects, settings and logs in
`~/.local/state/banda-trial/<slug>`, with the fake agent for its Harness.
`state/logs/window.log` has main's console and the page's warnings and
errors, `engine.log` the engine's. `--detach` comes back once the start
went well, or says what the window shows instead. `--hidden` keeps the
window, its notices and its sounds off Roma's screen; without it, the window
opens there to be clicked through, and is driven the same way.
`scripts/drive.mjs --help` has the rest: `--tab` for the browser's tabs,
`drag`, `fill`, `wait`, `eval`, `size`.

A checkout's window starts only through `scripts/local.sh`: `try.sh`,
the end-to-end tests and `pnpm --filter @banda/desktop start` go through
it. On Linux it runs the window in a systemd user unit of its own (the
trial's is `banda-trial-<slug>.scope`), so your Turn ending, or your
unit stopping, neither crashes it nor leaves part of it in yours
([ADR 0086](docs/adr/0086-the-engine-is-the-machine-s-and-outlives-the-window.md),
decision 7). Never start one with a bare `electron .`, and never stop
one by killing its process group or its unit while it runs: `try.sh
--stop` closes it as the Person does, and SIGTERM to its main process
does too.

The trial's own `banda` is its `bin/banda`, with `BANDA_STATE` set to its
`state`. In an Agent's shell, `banda` acts under the Agent's pass for the
engine the Agent runs in, and refuses a `BANDA_STATE` that names another:
call the trial's engine under `env -u BANDA_TOKEN -u BANDA_ENGINE`.

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
