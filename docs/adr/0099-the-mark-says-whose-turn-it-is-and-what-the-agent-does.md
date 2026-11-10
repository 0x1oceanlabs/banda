---
status: accepted
date: 2026-11-09
---

# The Mark says whose turn it is and what the Agent does

_It amends the Mark's states in `client/ui/src/components/banda-mark.tsx`
(`MarkState`, `MARK_ORDER`, `loudest`) and adds what a Thread does now to
`ListedThread` (`apps/agents/engine/src/model.rs:793`). The sidebar that
draws it is ADR 0098's. Code is cited from main at `de0deb68`._

Roma, on 2026-11-09 (translated), over the sidebar's card: Agents come
back from Later and need their own sign; failed should be another shape,
"like a stop sign"; working "more original, and not so jumpy, so it does
not make noise"; woke "its own status, like an alarm clock or a sun, not a
clock badge, so it is seen that it came out of sleep". And: "what can we
get from the Thread to keep in step with what happens? When it is in the
terminal, `>_`… there are many events, we can show them by what it does."

The rounds, in the brand workspace's `artifacts/sidebar-card/`:
`marks-v1.html`, `marks-v2.html`, `marks-light.html`, and the approved set
`marks-final.html` (states, a transitions demo, the logo, still poses, the
light theme and the rhythm table).

## Where it stands

- **Eight states** (`MarkState`): rest, idle, thinking, running, asking,
  done, failed, offline. Running is one motion whatever the Agent does.
- **Failed** is the square in red; nothing but colour tells it from done.
- **A Thread that wakes from Later** shows as it was; the sidebar adds a
  word. Nothing on the mark says it slept.
- **The window does not know what a turn does now.** `ListedThread`
  carries the latest turn, the questions, the message, the Later and
  seen; the Body's tool entries have a `ToolKind` (read, edit, delete,
  move, search, execute, think, fetch, other) and a status, but no list
  reads them.
- **The bar's logo** takes the loudest state in its whole colour.

## Decision

### Whose turn it is

1. **The Mark has seven looks**, each its own shape, colour and motion:

   | Look | Shape | Colour | Motion |
   |---|---|---|---|
   | **Asks** | triangle | `--attention` | hops, once every 4.4 s |
   | **Failed** | octagon, a stop sign | `--destructive` | × eyes, shakes once every 4.4 s |
   | **Done** | square | `--added` | flips once, then ^^ eyes |
   | **Woke** | square | `#f5c542` | rings two small bells, then looks round |
   | **Open** | square | the text's | looks around, blinks |
   | **Later** | square | muted | asleep: closed eyes, breathes, no zz |
   | **Offline** | square | muted | asleep with zz |

   - **Woke arrives asleep** and wakes: it stretches, then rings. So a
     card that comes back from Later shows where it came from.
   - Yellow stays plain, with no outline, in both themes.

### What the Agent does

2. **A working mark shows what its Thread does now**, read from its
   events, quietly: no motion jumps, each holds at least 1.5 s.

   | Doing | What the mark does |
   |---|---|
   | think | eyes up, a slow sway |
   | read | eyes scan left to right |
   | search | one eye a lens, sweeping |
   | edit | tilts with each stroke |
   | execute | eyes become `>_`, the cursor blinks (530 ms) |
   | fetch | a dot goes out and comes back |
   | reply | types, eyes on the line |
   | other | a calm series of the above |
   | sub-agents | satellites, one per sub-agent, up to three |
   | compacting | squeezes and lets go |
   | stuck: no event for 3 min | half-closed eyes |
   | usage limit | dozes, sand drips |

   The line 2 of its card says it in words (ADR 0098, decision 8).
3. **Sub-agents are satellites** around their Agent's mark. They have no
   mark of their own.
   _Amended 2026-11-10 by [ADR 0103](0103-a-harness-s-sub-agents-work-in-their-thread-and-a-crew-shows-beside-it.md):
   the satellites stay grey circles, and only a failed sub-agent's
   changes: red, an octagon at 48 px, a dot at 16 px._

### How it moves

4. **One rhythm**: a call every 4.4 s, a blink every 3.7 s, a breath 2.6
   s, sleep 4.2 s. A change of look blends in 0.45 s; a change of shape
   leaps, 0.6 s. A mark drawn for the first time starts in its state, as
   if it had been there: no news on the first draw.
5. **The open Thread's mark does not call**: it keeps its look and shape
   still, since the Person already looks at it.
6. **Awake marks glance at the pointer** as it passes their card. Asleep
   ones do not.
7. **Quiet (ADR 0098, decision 21) stills every call**: shapes and colours
   stay, motion that calls stops.
8. **Every look has a still pose** for places that do not move: the
   tray, the dock, a notification's icon, `prefers-reduced-motion`.

### The logo

9. **The bar's logo shows the loudest**: offline › failed › asking › woke
   › done › working › rest. **Only its hat**, the Agent's tile, takes the
   colour and the motion; the two tiles under it stay as they are.

### The light theme

10. On a light theme: open at 80% of the text, working `#71717a` at 70%,
    later `#71717a` at 55%. The calls' colours stay.
    _Amended 2026-11-10 by [ADR 0107](0107-a-working-mark-takes-the-group-plate-s-blue-muted.md):
    a working Mark, on both themes, is the Group plate's `--working`,
    muted._

### What the engine says

11. **`ListedThread` gains what its Thread does now**, kept by its host
    from the Body's events and sent as the rest of the list is (ADR 0087):
    - `doing`: a `ToolKind`, or think, or reply, and since when;
    - `stepped`: when the last event came, so a client can tell "stuck";
    - `subagents`: how many of the Harness's sub-agents run;
    - `compacting`;
    - `limit_until`: when a usage limit lets it go on
      (`Failure::usage_limit`'s `until`).
    It changes no more often than once a second.
    _Amended 2026-11-10 by [ADR 0103](0103-a-harness-s-sub-agents-work-in-their-thread-and-a-crew-shows-beside-it.md):
    `subagents` counts the direct ones that work or ask, and `failed`,
    `crew` and `parent` come beside it._
12. **The look is worked out in one place** for the sidebar, the bar, the
    Pane's header and the notifications: ADR 0098's `status.ts` gives the
    place and the word; `markOf` gives the look and what it does.

## What it amends

- **`MarkState`**: thinking and running become working with its doing;
  woke and later are new; `MARK_ORDER` takes woke between asking and
  done.
- **GLOSSARY, Mark**: its looks, the logo's hat, and what it does.

## Plan

Each step is its own PR, tried in the window before it.

1. **The looks, in the window only** (decisions 1, 4, 8–10): the octagon,
   woke and later, the rhythm, the hat, still poses, the light theme;
   `marks-final.html`'s engine ported into `banda-mark.tsx`.
2. **The engine says what it does** (decision 11): `doing`, `stepped`,
   `subagents`, `compacting`, `limit_until` in `ListedThread`, the
   contract regenerated, tests.
3. **The window follows it** (decisions 2–3, 12): working marks by event,
   satellites, stuck and limit; line 2's words with ADR 0098's card.
4. **Calm** (decisions 5–7): the open Thread still, the glance, Quiet.

## Roma's calls

On 2026-11-09:

- Woke an alarm clock, later asleep, open, done, asks, the stop sign with
  its shake, thinking: "good".
- Sub-agents as satellites; working by what it does: "all good, a very
  good set; I approve".
- Only the Agent's piece of the logo changes colour; yellow as it was,
  no outline; the light theme's numbers: "approved".
