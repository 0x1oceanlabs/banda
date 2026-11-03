# CI runners on devbox

`.github/workflows/ci.yml` runs `scripts/check.sh`'s parts side by side
(`rust ts` in one job, as `ts` reads the checkpoints `rust` writes, and
`window` in another) on self-hosted GitHub Actions runners labelled
`devbox`. One status, `ci`, sums them up. A PR that changes only Markdown
or `docs/` passes it without running them.

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
- `ci/compose.yaml`: runners `devbox-1` to `devbox-6`. Each keeps its
  registration, checkout, toolchain, `target/`, cargo's registry, the pnpm
  store and Electron's download in its own volume (`/state`), so a run builds
  incrementally. `/tmp` is a 4 GB tmpfs: the tests' SQLite fsyncs stall on
  the shared disk.
- `ci/target.sh`: links the checkout's `target/` into the volume and empties
  it once it outgrows 25 GB (cargo never removes old artifacts).

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
