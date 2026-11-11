---
status: accepted
date: 2026-11-11
---

# What loops forever steps twelve times a second

On 2026-11-11 Roma said Banda loads the CPU on the Mac and on arc. On
arc (2880×1800 at a scale of 1.6, 120 Hz), Banda Dev had used about 100%
of a core in its renderer and 65% in its GPU process, steadily, for the
two hours since it started.

Nothing was wrong with any one animation. Several CSS animations never
end: the Marks' loops (ADR 0099, decision 4), a Group plate's breath at
work (ADR 0065, decision 6), and a working Thread's spinner and shimmer.
While one plays, Chromium draws a frame on every refresh of the screen:
its compositor ticks it, the main thread too for one the compositor
cannot run, and the GPU process composes and shows the window. That
happens 120 times a second on a 120 Hz screen, however little moves. A
16 px Mark's breath is a fraction of a pixel.

A trial of main on 2026-11-11 had Roma's look (glass, the same wallpaper)
at a scale of 1.6 on a 60 Hz headless screen, about twelve Marks in the
sidebar and two Threads at work open. It measured, in percent of a core:

| | renderer | GPU | together |
|---|---|---|---|
| as it was | 49 | 39 | ~88 |
| the Marks' loops off | 22 | 26 | ~48 |
| the plates' too | 15 | 22 | ~37 |
| every animation that never ends off | 1–2 | 0 | ~2 |
| the same, stepped 12 times a second | 9 | 9 | ~18 |

At 120 Hz the first line doubles, as on Roma's screens. The glass changed
nothing. Most of the cost is that frames are drawn at the screen's rate
at all, so one loop left at that rate costs much of it. Running the loops
on the compositor makes each frame cheaper, not fewer.

No gate saw it. ADR 0088, decision 1, counts the page's animation-frame
callbacks while quiet, and a CSS animation asks for none. ADR 0099's
first step checked that the compositor runs the Marks' loops, and only
at a scale of 1, which neither of Roma's screens has.

Roma was shown the same scene four times: at the screen's rate, and
stepped 15, 12 and 8 times a second. On 2026-11-11 Roma took the
recommendations: twelve, calls stepped too, and every loop on the same
clock.

## Decision

1. **A loop steps twelve times a second.** A loop is a CSS animation that
   plays forever on the page's timeline. Every loop is held still and
   stepped 12 times a second to where it would be had it played. All of
   them step together, so the window draws one frame for them all.
   `client/ui/src/lib/loops.ts` catches each loop as it starts, for the
   whole page; what draws one does nothing for it.
2. **A call steps too.** A Mark's call (asks hops, failed shakes, woke
   rings) is part of its loop. ADR 0099's looks and rhythm stand; only
   how often they are drawn changes.
3. **What ends plays at the screen's rate.** That covers a Mark's news,
   the Tiling's moves (ADR 0088), transitions, hovers and a plate's swell.
4. **Pausing stays as it was.** A loop inside `[data-paused]`, as a Mark
   out of view or in a hidden window, does not step, and no loop steps
   while the page is hidden. Less motion and `[motion] off` take the loops
   away, as before.
5. **A start or a time set from outside is kept.** The loop goes on from
   it: a Mark starting its loops on its rhythm again, or the Group plates
   at work breathing as one (`startAt`). A loop played from outside is
   held again at the next step.
6. **Gates count the frames the window shows.** While only loops live,
   the window shows at most 20 frames a second: the 12 steps, and what
   draws on its own beside them, as a Thread's clock once a second. Each
   loop is held and steps 12 times a second. With nothing that loops, the window draws nothing
   (ADR 0088). The end-to-end tests measure both.

## What it changes

- **ADR 0088, decision 1:** the quiet gate counts animation-frame
  callbacks, and decision 6 above adds the frames shown.
- **ADR 0088, decision 2:** a loop may animate any property. Stepped, it
  costs 12 paints a second wherever it runs, as a Group plate's custom
  properties and a shimmer's background do. Moves keep decision 2.
- **ADR 0088, decision 9, and step 9 of its plan:** superseded. A working
  Agent's plate costs 12 paints a second as it is drawn now, so it needs
  no layers of its own.
- **ADR 0099, decision 4:** the rhythm stands, drawn 12 times a second.
  The gate its first step's end-to-end tests kept, the compositor running
  every loop at a scale of 1, is replaced by decision 6.

## Consequences

- A window where something loops draws 12 frames a second rather than
  the screen's rate. That cost does not grow with the screen's rate. A
  window where nothing loops draws nothing.
- A loop's motion is stepped. At 16 px it barely shows; on a large Mark
  it does, as Roma saw before choosing.
- A loop new code adds is stepped with no work of its own.
- A Mark's beat may trail its rhythm by up to one step, 83 ms, after it
  is started on its rhythm again: the next step is the first to see it.
- A loop is held by the Web Animations API. Code that asks whether an
  animation runs (`playState === "running"`) no longer sees a loop, only
  what moves and ends.
