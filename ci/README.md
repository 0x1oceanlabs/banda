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
