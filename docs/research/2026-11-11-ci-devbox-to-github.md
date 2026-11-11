# CI: devbox's runners to GitHub's (2026-11-11)

`ci.yml`'s `check` (`rust ts` and the window's four shards), `what
changed` and `ci` moved from devbox's twelve self-hosted runners to
GitHub's own, free for a public repository: `ubuntu-24.04` (4 CPUs,
16 GB) for `check`, `ubuntu-slim` for the two small jobs. devbox is left
to the Agents. `release.yml`'s Linux pack still runs there; it moves in
a PR of its own.

## Before: devbox

The last day of `ci` runs before the move, 2026-11-10 23:20 to
2026-11-11 11:04 UTC, from the Actions API: the green jobs' own times,
from start to end, without the wait for a runner. devbox is an old
32-core Threadripper with 128 GB, two 1 TB SSDs in RAID 1, shared by the
twelve runners and, at times, Agents' builds.

| Job | Runs | Median | p90 | Min | Max |
|---|---|---|---|---|---|
| check (rust ts) | 11 | 12.0 min | 12.9 | 8.3 | 12.9 |
| check (window, 1/4) | 11 | 16.3 min | 16.9 | 13.5 | 17.3 |
| check (window, 2/4) | 8 | 20.8 min | 23.0 | 14.2 | 23.0 |
| check (window, 3/4) | 10 | 11.7 min | 12.9 | 9.2 | 12.9 |
| check (window, 4/4) | 11 | 14.0 min | 15.0 | 11.6 | 15.0 |
| what changed | 16 | 0.2 min | 0.2 | 0.1 | 0.2 |
| ci | 9 | 0.1 min | 0.1 | 0.1 | 0.1 |
| fence (GitHub's) | 12 | 1.2 min | 1.4 | 1.0 | 1.5 |
| same path (GitHub's) | 11 | 8.7 min | 9.3 | 3.2 | 9.6 |
| windows (GitHub's) | 12 | 4.2 min | 4.8 | 3.2 | 4.8 |

A whole run with `check`, from its first job's start to its last job's
end, green: 9 runs, median **23.2 min**, min 19.1, p90 83.4. The p90 is
the wait for a free runner when several PRs ran at once.

What the numbers show:

- The window's shards are uneven: 2/4 takes 21 minutes, 3/4 12. Playwright
  splits the tests by count, not by time, and the run waits for the
  slowest.
- Each shard builds the whole workspace and the window again
  (`cargo build --workspace`, `pnpm build`): four builds of the same
  thing per run.

## After: GitHub's runners

Filled in from the first runs after the move (PR's run, then main's
first with a saved cache, then a week's median).

| Job | Cold (no cache) | Warm (main's cache) |
|---|---|---|
| check (rust ts) | | |
| check (window, n/4), slowest | | |
| whole run | | |

## Later, if it is too slow

In order of what each gives for its cost:

1. Build the engine, the fake agent and the window once, in a job of its
   own, and let the shards download it, instead of four builds.
2. More shards, split by time: GitHub's runners cost nothing here, but an
   organization on the free plan runs at most 20 jobs at once, and a run
   with `check` already takes ten.
3. `rust ts` alone on a bigger runner (Blacksmith, a Hetzner server), the
   one part that is mostly compiling.
