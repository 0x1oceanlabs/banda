# Measurements behind the client's architecture

Evidence for `docs/research/2026-11-07-client-architecture.md` §8, taken on
2026-11-07 from main at `ed293406`. It is evidence, not a decision.

## How it was measured

- **Where:** Electron 45.1.0 (Chromium 156), headless under Playwright 1.64.1,
  on Linux. Headless runs cap at 60 Hz and measure no GPU raster, so the
  counts below are work done, not frames shown.
- **The scene** is `client/desktop/e2e/motion.spec.ts` as it is on main: a
  Strip of three terminals, the first printing all the while, and a
  browser Pane on a local page; then a column's width cycled, the focus
  stepped along the Strip, a Group maximised, the workspaces stepped, the
  overview opened and closed, and the window left idle.
- **The command** (a fresh worktree of main):

  ```sh
  pnpm install --frozen-lockfile
  cargo build --workspace
  pnpm --filter @banda/desktop build
  cd client/desktop && pnpm exec playwright test e2e/motion.spec.ts
  ```

  It writes `client/desktop/test-results/motion.json`.
- **DPR 1.6** ran the same scene with the device scale factor set to 1.6,
  from a copy of the spec. Step P0 adds it as a project of its own.
- **Animation frames and canvas calls** came from a second copy of the
  spec, with an init script that counts the page's `requestAnimationFrame`
  callbacks and each terminal canvas's draw calls. P0 adds these counters
  to motion.spec v2. The copies are not in the repository.

## Main thread, per second of each phase

From `motion.json`. `L/s` is layouts a second, `RS/s` style recalculations
a second, then script and task time in milliseconds a second. Frame
timings are 16.7 to 16.8 ms at p95 in every phase, because headless runs
cap at 60 Hz; the page never trailed its tile where it was on screen.

| Phase | Seconds | L/s (DPR 1) | RS/s (DPR 1) | Script ms/s (DPR 1) | Task ms/s (DPR 1) | L/s (DPR 1.6) | Task ms/s (DPR 1.6) |
|---|---|---|---|---|---|---|---|
| printing | 3.0 | 45 | 45 | 44 | 86 | 46 | 98 |
| quiet | 3.0 | 0 | 0 | 10 | 22 | 0 | 25 |
| width | 4.2 | 61 | 121 | 29 | 98 | 61 | 122 |
| focus | 5.7 | 0 | 21 | 18 | 61 | 0 | 61 |
| maximize | 2.8 | 0 | 3 | 16 | 29 | 38 | 107 |
| workspace | 2.9 | 1 | 44 | 17 | 65 | 47 | 133 |
| overview | 3.7 | 80 | 132 | 34 | 158 | 37 | 120 |

At DPR 1.6 the overview had one long frame; no other phase had any.

## Animation frames and terminal draws

From the counters' run. Terminal 0 is the printing one; in every phase
but `width` it sits off screen to the left.

| Phase | rAF callbacks a second | Draws by terminal 0 (off screen) | Draws by terminal 2 (on screen) |
|---|---|---|---|
| printing | 168 | 11,560 | 12 |
| quiet | 122 | 0 | 12 |
| quiet, no browser Pane | 62 | 0 | 12 |
| width | 123 | 0 | 3,962 |
| focus | 126 | 6 | 6 |
| workspace | 122 | 0 | 12 |
| overview | 121 | 0 | 8 |

## Per moving frame

The research's per-frame figures (1.46 layouts per moving frame and about
one terminal fit per frame in the width phase; p95 12.0 ms of main thread
per moving frame, 22 tasks over 8.3 ms and the longest at 29.8 ms in the
workspace phase; p95 3.3 ms and 4 tasks over 16.7 ms in the overview) come
from Chrome traces of the same runs, summarised over the frames in which
something moved. The raw traces were not kept, so these figures stand as
recorded on the day; P0's per-phase trace summary reproduces them.

## The GPU

On Roma's machine (Hyprland), Electron reports GPU compositing,
rasterization, WebGL and WebGPU enabled, with no command-line flags.

## Limits

- One run per phase. Counts such as the off-screen terminal's draws vary
  from run to run, so the research rounds them ("over 11,500 in 3 s").
- No phase has a working Agent, so the Group plates' paints are not
  measured (research §8.7).
- The width phase pushes the browser off screen
  (`client/desktop/e2e/motion.spec.ts:204-213`), so the page's trailing is
  not measured while a width changes.
- Nothing was measured on a real 120 Hz display; research §8.12 plans
  that run.
