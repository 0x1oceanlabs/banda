# Working on Banda

The rules for whoever changes this repository, a Person or an Agent. They
are short on purpose: what a document or a test already says is linked,
not said again.

## How we write code

UNIX composition + deep modules + explicit contracts.

- **A module is deep.** A small interface hides substantial work: its
  caller knows what it does, never how. The test of one is that
  `banda call` can drive it. A layer that only passes calls on is shallow:
  fold it into its caller.
- **One thing, one place, one owner.** A record has one writer, a
  behaviour one place, a function one door. Before you build, find the
  place that does it already and change that.
- **A contract is written once.** It defines ownership, permissions,
  outcomes and failures, not just data formats. The engine's types are
  written in Rust and generated for TypeScript, never typed again.
- **Text is the interface.** What the window does with a button, the CLI
  and an Agent do with the same call.
- **A border is real when a check holds it.** Splitting code into more
  packages does not, by itself, make the design modular
  ([Borders](#borders-are-held-by-checks)).
- **The smallest change on the roads there are.** Complexity is added
  only on a user's request or with a new module: no layer, option or
  abstraction for a future that has not asked.
- **A slice in its end shape.** Build a thin thing that works from end to
  end, in the shape it will keep. A foundation is built when a slice
  needs it
  ([the roadmap](docs/research/2026-11-08-roadmap-in-slices.md)).

## Before you change things

- What we build: [`docs/what-we-build.md`](docs/what-we-build.md). Read it
  first. Every ADR and PR serves one of its principles or stories and names
  it; a change that goes against it is Roma's call first.
- The window: [`docs/window.md`](docs/window.md), its six rules. A change
  to what the Person sees or touches follows them: each thing in one
  place, the engine decides, and no second door to a function.
- The words: [`GLOSSARY.md`](GLOSSARY.md). Use its terms exactly.
- The shape: [`docs/architecture.md`](docs/architecture.md).
- Where it is going: [the architecture vision](docs/research/2026-11-06-architecture-vision.md),
  accepted on 2026-11-06, and the order of the work in
  [the roadmap](docs/research/2026-11-08-roadmap-in-slices.md). Where they
  differ from what we build, what we build wins.
- The decisions: [`docs/adr/`](docs/adr/README.md). Its index says which
  still bind, by subject: read the standing ones of what you change. A
  change that contradicts a standing ADR needs a new ADR first, and that
  page says what an ADR is for.

## What is in play

Banda is built by one Person and many Agents, on tracks.
[`docs/now.md`](docs/now.md) is the one page that says which tracks run,
what is not built now and what waits for Roma, and where each plan is.

- A session builds a slice of its track, or the task Roma gave it. A new
  feature outside the tracks is Roma's call first.
- What you notice outside your slice becomes an issue, not a PR: a bug, a
  rule held only in words, a part worth rewriting. Two things you fix at
  once, in a PR of their own: a red `main`, and a few lines in the files
  you are changing anyway.
- A slice is done when it was tried, not when it merged. The PR says what
  was tried and where, and what was not: a system, a machine, a real
  Harness. What only Roma can try, it lists for Roma.

## Beside other sessions

Other sessions change this repository while you do, some sixty PRs a
day, and you cannot count on reaching one. The repository is where
sessions meet:

- **Before you start,** fetch `main` and look for an open PR on the files
  or the thing you will change: `gh pr list --search "<word>"`. If one
  is there, build on it, wait for it or take another slice. Never write
  the second version of a thing.
- **Keep a PR small and short-lived,** and rebase it onto `main` before
  it opens. A branch a day old meets a `main` sixty PRs on.
- **In another track's code,** change only what your slice needs and say
  so in the PR. More than that is an issue for that track.
- **In a file many touch** (`client/desktop/src/main.ts`,
  `kernel/src/api.rs`, a test's list), change your lines where they
  are: no move, no reformat, no reorder.
- **A test you did not write fails:** read why before you change it. It
  may hold a rule your change broke. If `main` is red from a merge that
  is not yours, fix it in a PR of its own that names that commit.
- **A PR that waits for Roma** says so in its first line, with what it
  waits for, has the label `waits-roma` and is not armed to merge itself.
  Roma's queue is that label.

## Borders are held by checks

Who may import, name or call whom is held by a test, not by this page:
[the architecture's list](docs/architecture.md#checks-that-hold-the-shape)
says which test holds which border.

- A case a check must allow goes in its list, with its reason. The lists
  only fall: never raise a count or add a line to make a test pass. Take
  the other road (the registry, a fact, an intent, the kit), or ask Roma.
- A new border comes with its check, in the same PR.
- A rule you find held only in words, here or in an ADR, becomes a check
  or an issue.

## Workflow

One change, one branch, one PR. Nothing is pushed straight to `main`.

1. **Branch.** Each branch has its own worktree in
   `../banda-worktrees/<slug>`, never loose beside the main checkout:
   `git worktree add -b <kind>/<slug> ../banda-worktrees/<slug> origin/main`.
2. **Show it first**, if Roma will see the change ([below](#show-it-first)).
3. **Build it**, and try it in the window if it shows there
   ([below](#see-what-you-changed)).
4. **Review it for bugs**, if it changes what Banda does: read the whole
   diff as a stranger would, for what is wrong and not for how it reads.
   In Claude Code that is `/code-review medium`, and `high` for the
   kernel, the contract, access and the fence. A change to documents,
   mocks or tests alone skips this step.
5. **Simplify it**: look for what the code base has already, what can be
   shorter, and what sits at the wrong depth; in Claude Code,
   `/simplify`. After the review, so nothing is polished that will change.
6. **Check what you touched** ([below](#checks-before-a-pr)).
7. **Open the PR and arm the merge:** `gh pr merge --auto --rebase`, and
   go on. The PR merges itself once `ci` is green.
8. **Remove the worktree** once its PR is merged.

A red `ci` is yours to fix, on the PR or, after a merge, on `main`. So is
a red `tests (Windows)` on `main` after your merge: it is no merge gate,
so nothing else stops for it
([`windows.yml`](.github/workflows/windows.yml)).

That is for Roma's PRs and yours. A PR with someone else's commits, taken
in from a fork, Roma merges by hand: never arm auto-merge on it
([ADR 0038](docs/adr/0038-banda-is-open-source-under-apache-2-0.md),
decision 4).

### Checks before a PR

CI runs every check on every PR, and nothing merges while `ci` is red
([`ci/README.md`](ci/README.md)). So before a PR you run what is cheap and
tells you most, not all of it:

- **Format and lints** of the language you changed.
  Rust: `cargo fmt --all --check` and
  `cargo clippy --workspace --all-targets -- -D warnings`.
  TypeScript: `pnpm exec prettier --check .`, `pnpm exec eslint .` and
  `pnpm -r typecheck`.
- **The tests of what you changed:** `cargo test -p <crate>`,
  `pnpm --filter <package> test`.
- **The generated types**, after a change to a Rust type the contract
  carries: that crate's tests rewrite `sdk/contract/src/generated`.
  Commit what they wrote.
- **The architecture tests**, after a new import, dependency or name of
  another part: `cargo test -p banda-kernel --test architecture`,
  `cargo test -p banda apps::tests` and
  `pnpm --filter @banda/web exec vitest run src/architecture.test.ts`.
- **Windows**, after a change to code behind `cfg`:
  `scripts/check.sh windows`, with cargo-xwin and clang. A call only Unix
  has goes behind `cfg(unix)`, with Windows code beside it or a refusal
  that says it is not on Windows yet (ADR 0090). A path is made whole
  with `dunce::canonicalize`, never std's, which `clippy.toml` refuses.

`scripts/check.sh --no-window` is all of it but the window's end-to-end
tests. Run it when a change crosses the contract or many crates, or when
`ci` is red and you cannot see why. Read a check's result before you
push: never chain the push to it.

### Dependencies

Renovate opens the dependency PRs on Mondays
([`.github/renovate.json5`](.github/renovate.json5)), and none merges
itself. An agent takes one: reads what changed in the release notes, makes
`ci` green on its branch, then merges it as above, or closes it with the
reason. A major waits unopened on the Dependency Dashboard issue: tick its
box to get the PR.

## Show it first

A change Roma will see is shown to Roma before it is built: a mock,
drawn with the kit in [`docs/design/kit/`](docs/design/kit/) to
[the Banda look](docs/design/README.md), with its variants and the one you
would pick. Take its pictures with `node docs/design/kit/shot.mjs`, at
1440 and 728 wide, in light and with the glass off, and look at each
before Roma does. Build it once Roma has chosen, then try it as below.

## Draw with Banda UI

Whatever you draw, in the Window or an App, takes its colour, corner, type
size, shadow, layer and lengths from Banda UI: the theme's tokens and the
classes `@banda/ui` names on them ([the Banda look](docs/design/README.md),
[the guidelines' §5](docs/sdk/guidelines.md#5-design)). A value it lacks
becomes a token, never a number in the code. The look check refuses the
rest; a case it must allow goes in its list with its reason, and the list
only falls
([ADR 0113](docs/adr/0113-banda-ui-is-one-vocabulary-the-window-and-every-app-draw-with.md);
the check is `client/web/src/look.test.ts`).

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
errors, `engine.log` the engine's; a trial's Chromium says its own in
`run.log`, a packed Banda's in `state/logs/chromium.log`. `--detach` comes back once the start
went well, or says what the window shows instead. `--hidden` keeps the
window, its notices and its sounds off Roma's screen; without it, the window
opens there to be clicked through, and is driven the same way.
`scripts/drive.mjs --help` has the rest: `--tab` for the browser's tabs,
`drag`, `fill`, `wait`, `eval`, `size`.

A checkout's window starts only through `scripts/local.sh`: `try.sh`,
the end-to-end tests and `pnpm --filter @banda/desktop start` go through
it. On Linux it runs the window in a systemd user unit of its own (the
trial's is `banda-trial-<slug>.scope`), so your unit stopping neither
crashes it nor leaves part of it in yours
([ADR 0086](docs/adr/0086-the-engine-is-the-machine-s-and-outlives-the-window.md),
decision 7). That unit does not take it out of your process group:
`--detach` does, with a session of its own, so start yours only with
`try.sh --hidden --detach`. Behind Banda's fence (below) there is no
user manager: the window runs as it is, inside the fence, and ends when
your Harness does, which Banda does not let go for idling while the
trial listens. `pnpm --filter @banda/desktop start` and `try.sh` without
`--detach` are for a Person's terminal: in your shell, the window
crashes when your Turn's processes are killed. The end-to-end tests'
windows are apart already, and close once the tests have gone, however
they went. Never start one with a bare `electron .`, and never stop one
by killing its process group or its unit while it runs: `try.sh --stop`
closes it as the Person does, and SIGTERM to its main process does too.

The trial's own `banda` is the `banda` in its folder,
`~/.local/state/banda-trial/<slug>/banda`, which `try.sh` writes and
names as it starts: it runs the trial's `bin/banda` with every folder of
the trial's and without the Agent's pass. Never call `bin/banda` with
`BANDA_STATE` alone: it reaches the trial's engine, yet reads and writes
the settings in `~/.config/banda-local`, which are every Banda Local's on
the machine.

## Behind the fence

On Linux a Thread's Harness, and all you run, runs behind Banda's fence
where it holds
([ADR 0083](docs/adr/0083-banda-keeps-its-own-state-out-of-an-agents-reach-and-only-the-persons-gesture-acts-as-the-person.md)):
`banda status` says whether it does. Banda's own state and data are
hidden there, every Banda's settings read-only, and so is what Roma has
outside your Harness:

| Behind the fence | What happens, and what to do |
|---|---|
| The session's runtime folder | Empty: no `systemctl --user`, `notify-send`, `hyprctl`, `wl-copy`, keyring, gpg agent (signed commits) or rootless Docker. The SSH agent stays only in a Project Roma said they trust, so `git push` over ssh works there |
| The display | None: a window runs headless (`try.sh --hidden`, the end-to-end tests) |
| `sudo`, `newuidmap`, `fusermount` | Refused, so AppImages (`APPIMAGE_EXTRACT_AND_RUN=1`) and sshfs too |
| `/dev` | null, zero, full, random, urandom, tty, pts and shm only: no GPU, `kvm`, `fuse`, `tun` or sound |
| Other processes | Only your Harness's are seen or signalled |
| `gh`, `git push` | Only in a Project Roma said they trust, with their token as `GH_TOKEN` and their SSH agent: in another, ask Roma to trust it again |
| `~/.config/banda*` | Read-only: `banda settings` and `banda keys bind` go through the engine |
| pnpm's store | Its links cross a mount the fence makes: on btrfs or XFS an install clones its files, on ext4 it copies them. Ask Roma before moving the store with `pnpm config set store-dir`, which moves Roma's too |
| What you start in the background | Ends with your Harness: a dev server, a trial, `gh run watch`, a long build or a wait loop. Your Harness ends as the engine restarts (each Banda Dev update does), after 30 minutes with no turn unless what you started listens, and when Roma trusts or stops trusting the Project, once the turn ends |

For anything out of reach, give Roma the command to run in a terminal
Pane, which runs outside the fence.

## Effect in the window's main process

Electron main is written in Effect 4: `client/desktop/src` (not the
preload), `client/desktop-kit` and the modules' `desktop` parts, never the
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

## Where things are written

Write the least that the next session must read
([#1800](https://github.com/0x1oceanlabs/banda/issues/1800)).

- **An ADR** is for a decision that is hard to undo or that binds more
  than one part: a protocol, a format kept on disk, a border, a right. A
  step of work, a look or an order of work is no ADR.
- **A PR** says what changed and why, what was tried and what was not.
- **An issue** holds a plan, and what was found and not done.
- **`docs/architecture.md`** follows the code: a change to the shape
  changes it in the same PR.
- **`docs/research/`** keeps dated evidence with its source and limits.
  It is not a decision; ADRs are.
