# CI

`.github/workflows/ci.yml` runs `scripts/check.sh`'s parts side by side
(`rust ts` in one job, as `ts` reads the checkpoints `rust` writes, and
`window` in nine shards: six for most of its specs, three for those
that start arc, a second engine, whose tests are slow) on GitHub's own `ubuntu-24.04` runners, free for
a public repository. One status, `ci`, sums them up. A PR that changes
only Markdown or `docs/` passes it without running them.

Each job is a VM of its own, 4 CPUs and 16 GB, which GitHub throws away
after it. What a run builds on is only the caches main's runs save
(below): main's `rust ts` saves the dependencies every Linux part reads,
and each part keeps pnpm's store and Electron's download by the
lockfile. The Ubuntu packages a part needs, `ci/apt.sh` installs: only
those the runner's image lacks (the window's libraries it has), and,
when Ubuntu's mirrors fail, bubblewrap from Debian's archive by a pinned
hash. `ci/Dockerfile` still pins the Node the jobs install. `release.yml`
packs and publishes Banda Dev on the same runners, so nothing runs on
devbox any more (below).

How long it took, on devbox and here, is in
`docs/research/2026-11-11-ci-devbox-to-github.md`.

## Windows

`ci`'s `windows` part, `scripts/check.sh windows`, lints the workspace for
Windows and builds its tests (ADR 0090, decision 9). It runs on GitHub's
`windows-2025` runner, free for a public repository, whose Visual Studio
has Microsoft's CRT and SDK, with `Swatinem/rust-cache` keeping the
dependencies main's runs built. It runs when a PR changes Rust or what
builds it, and on every push to main; `ci` waits for it.

- It gates merges once it has passed on main: main's green run leaves an
  artifact, `windows-passed-on-main`, kept 90 days, and from then on a
  failure fails the part, and so `ci`. Until then a failure only warns
  and the part stays green, so neither a PR nor main's Dev build
  (`release.yml`) is held up by what main has not passed yet. Each green
  run on main leaves a new one.
- With no cache, as on a PR before main has saved one, `check.sh windows`
  took 4 to 5.5 minutes on `windows-2025`, and the whole job 4.5 to 6
  (2026-11-07). `ci` waits for the slower of it and the other parts. Only
  main's runs save the cache, so a warm run's time shows after main's
  first.
- From Linux, cargo-xwin builds the same (`scripts/check.sh windows`); it
  fetches Microsoft's CRT and SDK on its first run, 1.2 GB. On a laptop's
  20 threads it took 3 minutes with an empty `target/`, 65 s after a
  change to the kernel and 26 s with nothing changed (2026-11-07).
- `.github/workflows/windows.yml` runs the tests on `windows-2025`, on each
  push to main, on PRs that touch Windows code, and by hand
  (`gh workflow run windows --ref <branch>`). It is not a merge gate, and
  each run keeps the `banda.exe` it built. With no cache its tests took
  6.5 minutes (2026-11-07).
- `.github/workflows/release-windows.yml` packs Banda Dev's installer on
  `windows-2025` (ADR 0090, step 5), by hand
  (`gh workflow run release-windows --ref <branch>`) and on PRs that change
  how it is packed. It installs it, installs it again over a program
  running from its folder, and uninstalls it, then keeps the installer for
  14 days. It starts the app too, which runs its engine from a copy and
  removes old copies, and writes how long the run took to its summary. It
  publishes nothing and is not a merge gate.

## The fence's tests

The fence's tests (`platform/fence`, `engine/tests/fence.rs`) make user,
mount and PID namespaces, which Ubuntu keeps off behind AppArmor: in
`check` they skip, each saying why. `ci`'s `fence` part runs them on
GitHub's `ubuntu-24.04` runner, a VM of the job's own, free for a public
repository. Ubuntu keeps unprivileged user namespaces off there behind
AppArmor, so the job turns them on for itself, installs bubblewrap, and
runs the tests with `BANDA_FENCE_TESTS=all`: every test runs, and one that
would skip fails the part. As `windows`, it runs when a PR changes Rust or
what builds it, and on every push to main; `ci` waits for it. With no
cache the job took about 2 minutes (2026-11-07).

## The same-path test

`client/desktop/e2e/same-path.spec.ts` checks that what the window does
for another machine's Project ends at that machine's files (ADR 0106, law
3). Its fake machine "arc" (`e2e/arc.ts`) runs everything of its own in a
mount namespace, with bwrap, where arc's own home is mounted over a
throwaway home in the test's folder that stands in for this machine's:
one path names arc's `who.txt`, which says "arc", for arc, and this
machine's, which says "mac", for the window, as `~/code/banda` does on
two machines. A window that reads its own file for arc's then reads "mac"
and fails. Its link is 40 ms away a round trip, and can go into a black
hole, which drops what it carries with no reset.

`check` leaves user namespaces off, so there the window shards
run the spec with arc's files only in arc's own folders: a window that
asks this machine's engine for them finds nothing, but a whole path read
from this machine's disk still finds arc's file. `ci`'s `same-path` part
runs it with the namespace on GitHub's `ubuntu-24.04` runner, which turns
unprivileged user namespaces on as `fence` does, and with
`BANDA_SAME_PATH=require`, which fails the part where bwrap makes no
namespace. It builds only the engine and the fake agent, and the window,
and runs when a PR changes any code, and on every push to main; `ci`
waits for it. More of the window's tests move to it slice by slice, a
spec of `e2e/remote-*.spec.ts` each, which the part names as its step
turns its road on: `remote-panes.spec.ts`, arc's Panes, New Pane on
arc and an act arc does not run (step 1a), and arc's Thread restored as
the window starts again while arc is away (step 1a″);
`remote-terminal.spec.ts`, arc's terminal: keys, its size, a link, and a
shell found again once arc is back (step 1b);
`remote-run.spec.ts`, a reply's Run and a sign-in on arc, and Run
refused while arc is away (step 1c);
`remote-git.spec.ts`, arc's Diff, its card, a refused Commit and a push
cut off (step 2a);
`remote-bytes.spec.ts`, this machine's pictures, PDFs, videos and pages
through the relay to its engine, beside arc's at the same path (step 4b);
`remote-files.spec.ts`, arc's Files: its tree, an edit saved to arc, the
Trash and Undo, a refused drag, a held arc (step 3b).
Here,
outside CI, the spec requires the namespace where `unshare -Ur true`
works, as the fence's tests do; `BANDA_SAME_PATH=off` runs it as
`check`'s shards do.

## The themes' shots

`client/desktop/e2e/themes.spec.ts` shoots each built-in theme in all
four, light and dark, solid and over glass, and compares each shot with
the one kept in `client/desktop/e2e/shots/` (ADR 0100, decision 4). The
glass is made of `e2e/backdrop.png`, white, mid grey and black side by
side, not a real wallpaper. Fonts and their rendering differ machine to
machine, so the shots are the window shards' own: only in CI does the
spec compare, and elsewhere it puts each look in `test-results/themes/`
for eyes.

A change that means to show fails the spec, and its shard uploads what
it shot. `scripts/bless-shots.sh <run id>` keeps those shots in
`e2e/shots/`; look at them before you commit them. A new look, with no
shot yet, goes the same way.

## macOS

`.github/workflows/macos.yml` runs the Rust tests on GitHub's `macos-15`
runner, free for a public repository. It is not a merge gate.

- A PR's run tests the crates with code of their own for macOS
  (`git grep -l 'target_os = "macos"'`) and the kernel, whose file
  watching is FSEvents there. It runs when one of them, the adapters the
  engine's tests start, the workspace's manifests or the toolchain
  changes. A crate that gains macOS code goes into both its path filter
  and its `-p` list.
- On main, a push that changes Rust tests the whole workspace. A newer
  push cancels the run before it, so main has one macOS run at a time,
  under the five macOS jobs GitHub runs at once for the organization.
- By hand: `gh workflow run macos.yml --ref <branch>`, the whole
  workspace.

## Caches

GitHub keeps 10 GB of Actions caches for the repository, and past that
deletes those used least lately, main's too. The tests'
`Swatinem/rust-cache` entries (`macos-test`, `windows-test`,
`windows-check`, and `linux`, which `check`'s `rust ts` saves and every
Linux part reads) are saved only from main (`save-if`), and a PR's run
reads main's. `release-linux` is the release build's, saved only by a
Dev's own pack, which a PR's pack reads. pnpm's store and Electron's download are one entry per
lockfile (`pnpm-…`), which the first run on a new lock saves.

`.github/workflows/cache-prune.yml` runs each day and keeps, of each
family of keys, the newest entry main saved; it deletes the rest, main's
older entries and every PR's or branch's. A family is a key without its
hashes, commits and run ids (every `-` part of 8 or more hex digits), so
a job that saves a cache names it for itself (`shared-key`). To see what
it would delete, and delete nothing:
`gh workflow run cache-prune.yml -f dry_run=true`.

## A fork's PR

A PR whose branch is in a fork is not checked at all (ADR 0038, decision 4):
Roma decides what comes in, and reads it before any of it runs here.

- `ci.yml` skips every check on it, and its `ci` fails, so it cannot be
  merged as it is. `release.yml` packs no fork's PR.
- To take it, Roma reads it, pushes its commits to a branch here
  (`gh pr checkout <n>`, then `git push origin HEAD:<kind>/<slug>`) and opens
  a PR of that branch. CI runs there, and the commits keep their author.
  Roma merges that PR by hand: no agent arms auto-merge on someone else's
  commits.
- A fork's PR runs its own copy of the workflows and could undo all that.
  On GitHub's runners it gets what GitHub gives every fork: a VM of its
  own, a read-only token, no secrets, and no cache it could leave for
  main's runs.

## A tag

Nothing in `release.yml` starts on a tag, and a run by hand publishes
nothing, so a tag pushed by hand ships nothing (ADR 0092, step 2).

## devbox's runners

Nothing runs on devbox's runners any more: `ci.yml` moved to GitHub's
runners first, and `release.yml`'s `which Banda` and Linux pack after it,
before devbox was installed again (2026-11-11) without them. A Dev is
built from nothing each time; the dependencies come from the
`release-linux` cache.

What was the runners' is still here until it is removed: `ci/compose.yaml`,
`ci/devbox.sh`, `ci/entrypoint.sh`, `ci/job-started.sh` and `ci/target.sh`.
`ci/Dockerfile` stays while it pins the Node every job installs.
