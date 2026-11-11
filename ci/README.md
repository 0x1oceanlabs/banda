# CI runners on devbox

`.github/workflows/ci.yml` runs `scripts/check.sh`'s parts side by side
(`rust ts` in one job, as `ts` reads the checkpoints `rust` writes, and
`window` in another) on self-hosted GitHub Actions runners labelled
`devbox`. One status, `ci`, sums them up. A PR that changes only Markdown
or `docs/` passes it without running them.

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
  (2026-11-07). `ci` waits for the slower of it and devbox's parts. Only
  main's runs save the cache, so a warm run's time shows after main's
  first.
- `ci/Dockerfile` has cargo-xwin and clang, so the part can move to devbox
  once its image is rebuilt (below): `runs-on: devbox` and `ci/target.sh`,
  as `check` has them. cargo-xwin fetches Microsoft's CRT and SDK into the
  volume on its first run, 1.2 GB. From Linux on a laptop's 20 threads it
  took 3 minutes with an empty `target/`, 65 s after a change to the
  kernel and 26 s with nothing changed (2026-11-07).
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
mount and PID namespaces, which the runners' containers do not give a job:
on devbox they skip, each saying why. `ci`'s `fence` part runs them on
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

devbox's containers give no user namespaces, so there the window shards
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
`remote-bytes.spec.ts`, this machine's pictures, PDFs, videos and pages
through the relay to its engine, beside arc's at the same path (step 4b).
Here,
outside CI, the spec requires the namespace where `unshare -Ur true`
works, as the fence's tests do; `BANDA_SAME_PATH=off` runs it as devbox
does.

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
`windows-check`, `linux-fence`, `linux-same-path`) are saved only from
main (`save-if`), and a PR's run reads main's.

`.github/workflows/cache-prune.yml` runs each day and keeps, of each
family of keys, the newest entry main saved; it deletes the rest, main's
older entries and every PR's or branch's. A family is a key without its
hashes, commits and run ids (every `-` part of 8 or more hex digits), so
a job that saves a cache names it for itself (`shared-key`). To see what
it would delete, and delete nothing:
`gh workflow run cache-prune.yml -f dry_run=true`.

## A fork's PR

A PR whose branch is in a fork is not checked at all (ADR 0038, decision 4):
its code could leave anything in the runners' volumes for the next run to
build on, and Roma decides what comes in.

- `ci.yml` skips every check on it, and its `ci` fails, so it cannot be
  merged as it is. `release.yml` packs no fork's PR.
- To take it, Roma reads it, pushes its commits to a branch here
  (`gh pr checkout <n>`, then `git push origin HEAD:<kind>/<slug>`) and opens
  a PR of that branch. CI runs there, and the commits keep their author.
  Roma merges that PR by hand: no agent arms auto-merge on someone else's
  commits.
- A fork's PR runs its own copy of the workflows and could undo all that.
  `ci/job-started.sh` is what keeps its code off devbox: the runner runs it
  before every job (`ACTIONS_RUNNER_HOOK_JOB_STARTED`, in `ci/Dockerfile`)
  and it fails a job whose PR or `workflow_run` comes from another
  repository.

## A tag

A pushed tag runs the workflows of the commit it names, and every
`release.yml` before ADR 0092's step 2 built a Stable from one, starting on
devbox. `ci/job-started.sh` fails every job for a pushed tag, so a tag
pushed by hand ships nothing, on any commit. It holds once the runners run
the image that has it (below). If a layer fails to build, compose leaves
the old runners running, without it. Check a runner, never with a test tag,
as a tag stays (ADR 0092):

    ci/devbox.sh compose exec -e GITHUB_EVENT_NAME=push \
      -e GITHUB_REF=refs/tags/v0.0.0 runner-1 banda-job-started.sh

It says `devbox builds no tag` and ends 1 there.

## Where they run

The runners are containers on the rootless Docker engine of devbox's OS user
`banda-ci`: no sudo, no `docker` group, no login shell, home `0750`. A PR's
code, an Agent's too, reaches only what that user can reach: not root's
engine, not the operator's, not the operator's home. No job needs a
container engine, so the runners do not reach even their own.

The user, its engine (Docker 29.7.2 under `/opt/banda-ci`) and its slice
(`CPUWeight=200`, `MemoryHigh=60%`, `MemoryMax=70%` of the host) were set up
for the old Banda's CI and are reused as they are. `ci/devbox.sh` only runs
`docker` and `docker compose` as that user.

- `ci/Dockerfile`: the runner with rustup, Node, pnpm and the libraries
  Electron runs on. A job installs `rust-toolchain.toml`'s toolchain itself
  and pnpm switches itself to `package.json`'s pin, so a new pin needs no new
  image; Node's pin lives here.
- `ci/compose.yaml`: runners `devbox-1` to `devbox-12`. Each keeps its
  registration, checkout, toolchain, `target/`, cargo's registry, the pnpm
  store and Electron's download in its own volume (`/state`), so a run builds
  incrementally. `/tmp` is a 4 GB tmpfs: the tests' SQLite fsyncs stall on
  the shared disk.
- `ci/target.sh`: links the checkout's `target/` into the volume, which
  cargo never prunes. Past 12 GB it drops `debug/incremental` and, in any
  job but `release.yml`'s pack, which builds on it, `release/`; still past
  15 GB, it empties it.

## Start (once)

On devbox, from a checkout of `main`:

```sh
# A registration token is valid for an hour and used only on the first start.
export RUNNER_TOKEN=$(gh api -X POST repos/0x1oceanlabs/banda/actions/runners/registration-token --jq .token)
ci/devbox.sh compose up -d --build
unset RUNNER_TOKEN
gh api repos/0x1oceanlabs/banda/actions/runners --jq '.runners[] | "\(.name) \(.status) \(.busy)"'
```

All show `online`. Later starts (a reboot, `restart: unless-stopped`) reuse
the registration kept in the volume and need no token. A runner added later
starts the same way: a fresh `RUNNER_TOKEN` and
`ci/devbox.sh compose up -d runner-<n>`.

## Upgrade the image

`git pull`, then `ci/devbox.sh compose up -d --build`. It recreates the
runners, and a recreated runner ends the job it was running: do it while
`gh api …/actions/runners` shows none `busy`, and rerun what it cut off
(`gh run rerun <run> --failed`). The runner binary updates itself in its
volume.

## Stop or remove

- Pause CI: `ci/devbox.sh compose stop`. Queued runs wait.
- Remove a runner for good: delete it on GitHub
  (`gh api -X DELETE repos/0x1oceanlabs/banda/actions/runners/<id>`), then
  `ci/devbox.sh compose rm -s runner-<n>` and
  `ci/devbox.sh docker volume rm banda-runners_runner-<n>`.
- Disk: `ci/devbox.sh docker system df -v` shows each volume.
