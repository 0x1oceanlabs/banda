---
status: accepted
date: 2026-11-07
---

# Motion runs on the compositor, and content takes its size once

_Proposed on 2026-11-07, to be accepted with ADR 0087 and ADR 0089. The
research behind it is `docs/research/2026-11-07-client-architecture.md`,
§8 (here "the research"), and its measurements are in
`docs/research/2026-11-07-client-architecture/measurements.md`. Code is
cited as `path:line` from main at `ed293406`._

Roma wants windows and animations to feel native on a 120 Hz display,
where a frame has 8.3 ms. Headless runs of `client/desktop/e2e/motion.spec.ts`
on 2026-11-07 measured why they do not:

- **A column's width** writes `style.width` and then reads `offsetLeft`
  and `offsetWidth` of every column in the same callback
  (`client/web/src/workspaces/layout.ts:391-400`): 1.46 layouts per moving
  frame. Each terminal refits every frame, synchronously inside
  `flushSync` (`client/ghostty/src/t3/lib/observeResize.ts:44`,
  `client/ghostty/src/t3/surface.ts:873-922`): 126 fits in 4.2 s. The
  browser's page box is resized every frame
  (`apps/browser/pane/src/pages.ts:280-281`).
- **A workspace switch** re-renders the whole window from the key handler
  (`client/web/src/shell/Shell.tsx:1109-1137`), with `PaneFrame` and
  `Strip` not memoised (`client/web/src/workspaces/PaneFrame.tsx:129`,
  `client/web/src/workspaces/Strip.tsx:59`): p95 12.0 ms per moving
  frame, tasks up to 29.8 ms.
- **An idle window** asks for 62 animation frames a second, 122 with a
  browser Pane: the Mark's clock runs while any mark is registered, and
  the Bar's Mark always is
  (`client/ui/src/components/banda-mark.tsx:680-685`), and the page
  follows its tile every frame while it shows (`pages.ts:439-447`).
- **A terminal off screen** that prints made over 11,500 canvas calls in
  3 s:
  `surface.setVisible` exists (`surface.ts:747`) and nothing calls it.
- **A working Agent's Group plate** animates registered custom properties
  (`client/ui/src/styles/globals.css:422-446`, `:568`, `:593`, `:604`),
  which Chromium runs on the main thread. No phase measures it yet.

Banda is not slow because of where its code runs. It changes sizes every
frame, reads layout in the frame it writes it, draws what nobody sees and
re-renders everything on a key. The fix has the shape Wayland compositors
use: the Tiling hands each Pane a configure, animates the box and not the
content, and runs one clock that goes quiet.

ADR 0007 d9 weighed the niri way for a column's width and kept the
content following the width, because a frame changed alone "clips the
frame's right border away" when growing and "cannot be drawn wider than
its box" when shrinking. This ADR keeps that question open for a mockup:
today's way stays one of the options, and the objection is answered by a
plate in three parts, or by holding the content's size until the move
settles.

**Decision.**

1. **Budgets are the contract, and counts gate before timings.**
   - Hard gates, counts that are stable on CI: no app animation frames
     while quiet; no draws by a hidden terminal; no layouts in a moving
     frame of a move that only translates (and of a width change, once
     decision 5's pick is B or C); one fit per settled size per terminal
     (for a width change, likewise after the pick); at most
     two `PaneFrame` renders per focus step; no frame where a page trails
     its tile.
   - Soft gates, timings: the main thread at most 4 ms per moving frame
     at p95; no task over 8.3 ms during a move that only translates;
     opening a Pane mounts in at most 50 ms with no long animation frame,
     and its animation starts after its first commit; a key to its frame
     at most 16 ms at p95, also at `--latency 150` once decision 11
     lands. They fail at 20% over the committed baseline, as the median
     of three runs, once CI's variance is known.
   - A working phase (Agents working, nothing moving) allows a focused
     terminal's cursor blink, about two ticks a second, and gets a
     paints-per-second budget once measured.
   - `client/desktop/e2e/motion-budget.json` holds the numbers. A PR may
     lower one; it raises one only by saying why.

2. **Only compositor properties animate:** `transform`, `translate`,
   `scale` and `opacity`. `clip-path` joins once a trace in Electron
   shows its animation composited. Width, height, top, left, inset,
   margin, padding and grid tracks never animate, CSS transitions
   included. Today's cases are counted and only fall.

3. **One clock, and it goes quiet.**
   - `client/ui/src/lib/frames.ts` is the only continuous animation-frame
     loop, and it already asks for a tick only on demand (`:17-21`). A
     tick runs the moves, which write, then `afterMoves`, which read.
   - The loops that never stop are fixed where they are: the Mark ticks
     only while a mark animates; the page follows only while the Tiling
     moves or a hand drags; the overview stops once landed and reads its
     constants once; each terminal's own loop joins the clock.
   - Nothing reads layout in a tick that writes it. Values that cannot
     change during a move are read once at its start.

4. **The Tiling gives every Pane a Configure, and every live component
   obeys it.**
   - `Configure = {size: {width, height}, scale, state, serial}`, where
     `state` is `shown`, `moving` or `hidden`, and `size` is the content
     box as settled.
   - It is delivered imperatively, `tileOf(element).watch()`, and to React
     through `useTile(select)`. It is never a Pane prop.
   - **Hidden:** draw nothing, stop timers and animations, hold commits
     (at most once a second), keep state. **Moving:** measure nothing,
     resize nothing; a terminal shows its retained bitmap. **Shown:**
     draw.
   - The Tiling predicts each Tile's state at a move's start from the
     target layout, plus a margin, so incoming Panes do not slide in
     blank; an `IntersectionObserver` per Tile corrects hand scrolls.
     Inactive Deck tabs, Tiles under a zoom, and every Tile while the
     window is away are hidden. The target of a jump is shown in the
     input task that starts it.
   - The states land first; the size lands with decision 5's pick.
   - Tiles are never wrapped in React's `<Activity mode="hidden">`: it
     destroys Effects, and the terminal's streams with them.
   - Quick Look, the Drawer and popped-out windows give their Panes the
     same contract.

5. **Content takes its size once per move.**
   - A Pane's content gets a new size only through a Configure. Moves
     that only translate (focus, scroll, a workspace, open, close) send
     none.
   - When the width's Configure is sent is the Tiling's policy. Roma
     picks it from a mockup run inside Electron with a busy main thread,
     after a one-day trace of `clip-path`:
     - **A**, today's way: the content follows the width every frame, as
       ADR 0007 d9 has it. It keeps the layouts and fits per frame that
       the measurements found, so the width's hard gate does not apply;
     - **B**, niri's way: the final size at once, the neighbours sliding
       from where they were, and a plate in three parts (a fixed left
       cap, a right cap translated, a middle stretched by `scaleX`);
     - **C**: the content keeps its size during the move, cropped by a
       still container, and fits once at settle.
     _For Roma:_ C unless `clip-path` is shown composited, since B's
     reveal would otherwise need a cover, which shows through the glass
     tiles (ADR 0023).
   - A hand drag of a column's edge, or the OS resizing the window,
     configures at most every 100 ms and once on release.
   - Inside a Tile, the Configure is the only source of size. No App or
     live component keeps its own `ResizeObserver`, `IntersectionObserver`
     or animation-frame loop. The mechanism (one observer per Tile) lands
     first with the policy "every frame", so nothing changes before the
     pick.

6. **One motion driver, in the platform.**
   - It samples the look's springs (`springAt`,
     `client/web/src/motion.ts:20-50`) into `element.animate` with a
     `linear()` easing, or sampled keyframes where `linear()` is missing.
     It writes the final value as the base style first, so an animation
     that ends is simply removed.
   - A retarget starts from the spring's state now, worked out, not read
     from the DOM, and keeps its velocity, as `Moving` does today
     (`client/web/src/motion.ts:94-160`).
   - Followers replay a Tile's animation with the same start time.
   - It is built after decision 5's pick, for the moves that still write
     every tick (the workspace stack, the slide, open and close). The
     overview moves to it only through a mockup: scaled text looks
     different mid-zoom.
   - Per-tick writing stays only for values a hand drives.
   - Reduced motion and `[motion] off` jump, as ADR 0007 d9 says.

7. **View state lives outside React, and a key's work stays small.**
   - Here and the Tiling's view are external stores read by selector
     (ADR 0087). A focus step re-renders only the two `PaneFrame`s whose
     focus changed.
   - Memo boundaries sit at `Strip`, `PaneFrame`, the Pane and each
     widget. Each Tile gets one stable handle; no function or inline
     object travels into a memoised child. The action context is stable.
   - Motion starts in the input task, from the predicted target; React
     reconciles after. No animation value is React state.
   - A visible stream commits at most once a tick, and about ten times a
     second while its Tile moves.
   - Lists over about 200 rows are windowed; long documents use
     `content-visibility:auto`, as messages do
     (`client/ui/src/components/message-scroller.tsx:74`). Work over 4 ms
     goes to a worker or is cut into pieces.

8. **Areas and Tiles contain their layout.** Each area gets `contain:
   layout paint style`. A Tile gets `contain: layout style`, with `paint`
   only on its content box, since the Deck's names and the focus frame sit
   outside it (`PaneFrame.tsx:126-127`). A terminal's mount gets
   `contain: strict`.

9. **A working Agent costs no main-thread paint per tick.** The Group
   plate's breath and sheen are rebuilt as the opacity of a painted layer
   and a translated gradient layer. ADR 0065 d6's three choices
   (`breath`, `line`, `sheen`) stay. The look may shift slightly, so a
   mockup comes first.

10. **Banda owns its terminal renderer.** libghostty-vt gives terminal
    state and dirty rows, and no renderer. Each step comes only when the
    one before misses its gate: visibility (decision 4); Canvas2D wins
    (the scrollbar written only when it changes, a typed snapshot, blit
    scroll); one WebGL2 context shared by every visible terminal, with
    one glyph atlas; a worker with an OffscreenCanvas.

11. **A key is drawn before the host answers.** ADR 0062 d17's end state
    stands: one Rust model, its authority on the home host, the same
    crate in WebAssembly in each client, intent commands, an overlay. The
    order changes:
    - Every intent that creates something names the ids it creates
      through its CommandId: each is derived from it by what it names
      (`Seed`, `platform/workspaces/engine/src/model.rs`), so the client
      knows them before the answer and a command sent again names the
      same, and the host refuses a command whose ids it holds. A
      placement derives them from its `show.requested@1` event instead
      (`workspaces.place`), so several clients place it once (ADR 0082
      d15). (Amended in T-ids: at first the client was to make each id
      and carry it in the intent, as the model then made them itself and
      a predicted Pane would have come back with another id and
      remounted.)
    - A parity test replays golden traces from the Rust model through the
      TypeScript one: a copy of the model's commands
      (`client/web/src/tiling/arrangement.ts`), which the prediction runs
      and T1 replaces. The engine's tests record the traces
      (`platform/workspaces/traces/`) from the model functions its
      module's handlers run, through `commands::apply`. (Amended in
      T-par.)
    - Then the client draws its prediction at once, sends intents in
      order with a CommandId, and reconciles by `at` (ADR 0082 d4, A8).
      The wait for the host to draw (`Shell.tsx:198`, `:438-492`) goes.
      A refusal animates back by retargeting with velocity. (Amended in
      T-pred: not by `at` alone. A command answered as one that wrote
      nothing leaves the prediction at once, and those before a command
      heard leave with it, as they commit in the order sent. One whose
      fact comes before its answer leaves by what the fact says: the
      fewest commands at the head that, applied to the facts before,
      give the facts now; #879 would have the event name its command
      instead.)
    - The WebAssembly model (T1) then deletes the TypeScript one, keeping
      the arrangement in its own memory; the overlay (T2) follows.
    - _Amended 2026-11-09 by
      [ADR 0101](0101-machines-are-peers-and-there-is-no-home-host.md): the
      authority is in the engine that holds the arrangement, the window's
      own machine. Only a browser tab's engine is on another machine, so
      the overlay (T2) waits for stage 4's decision on the web and is not
      built for the desktop; plan step 7 ends with T1._

12. **Device views follow; they do not poll.** The page layer stays a
    fixed layer (ADR 0013 d1). Its box sits inside a still clip
    container and replays its Tile's translate with the same start time.
    It measures once at rest, and every tick only while a hand drags.

13. **Measurement is part of the code.** `motion.spec.ts` keeps the
    browser on screen in every phase, and adds phases (working, a hidden
    terminal printing, open and close, the Banda menu, Thread streaming,
    a key burst, Alt+U to a hidden Thread), a DPR 1.6 project, counters
    from an init script, long-animation-frame and event-timing observers,
    and a trace per phase summarised over moving frames, in TypeScript. A
    run on Roma's display, glass on and off, comes before releases and
    after each visible step.

14. **Not done:** a separate compositor process; a WebGPU layer over the
    DOM; a native window toolkit; WebContentsView for Panes that move;
    Chromium GPU flags; React's `<Activity>` on Tiles.

**Plan.** Each step its own PR; `scripts/check.sh` passes after each; each
posts its motion.spec numbers before and after. Ids are the research's §9.

1. motion.spec v2, reporting only, and the budget file in record mode
   (P0).
2. A quiet window: the Mark, the page follow, the overview, the
   terminals' loops (P1). Gate: no animation frames while quiet.
3. Tile states: `tileOf`, `useTile`, `setVisible`, the hidden page box,
   commits held while hidden, predicted states, containment (P2). Gate:
   no draws while hidden.
4. The resize gate with the policy "every frame" (P3).
5. View state outside React and memo boundaries come with ADR 0087's R1
   and B4c. Gate: workspace p95 under 6 ms headless, two renders per
   focus step.
6. Terminal Canvas2D wins (P4). Gate: the printing phase's main time
   halves.
7. Client-minted ids, the parity test, then prediction (T-ids, T-par,
   T-pred); T1 and T2 after B8 and A8.
8. The `clip-path` trace (P5), the width mockup (P6), then the width as
   picked (P7). Gate, if the pick is B or C: no layouts in a width
   change; one fit per change.
9. Working plates on the compositor, through a mockup (P8).
10. The motion driver for moves that still write every tick (P9), then
    the overview, through a mockup (P10).
11. One WebGL2 context, only if step 6 misses its gate (P11); a worker
    only after that.

**Consequences.**

- An idle Banda draws nothing, and a hidden terminal costs only its
  parsing.
- Motion survives a busy main thread, because it runs on Chromium's
  compositor.
- Every live component of the catalogue (terminal, page, Thread scroller,
  file view, Mark, Visual) implements the Tile contract. A Level 1 Tree
  gets it for free through the catalogue.
- What an App author must obey is in `docs/sdk/guidelines.md` ("motion").
- Notifications' sight can come from what the Tiles show (ADR 0087
  decision 9).
- The host never sees Tile states; they leave the device only as
  presence.
- The terminal stays Banda's to draw; no renderer is awaited upstream.

**Changes.**

- **ADR 0007, decision 9, `resize`,** only if Roma picks B or C from the
  mockup (decision 5): "The content follows the width as it goes"
  becomes: the content takes its size once per move, at the moment the
  pick says. The objection about the frame's border is answered by a
  plate in three parts (B), or by holding the content's size (C). If he
  picks A, this line stands.
- **ADR 0007, decision 9, last bullet:** "Springs run in the window,
  frame by frame" becomes: springs are worked out in the window and
  played on the compositor; a move sent elsewhere halfway still carries
  its speed (decision 6).
- **ADR 0013, decision 1:** "the tab follows the slot's place on every
  frame" becomes: the page's box sits inside a still clip container,
  replays its Tile's translate with the same start time, and measures
  once at rest, every tick only while a hand drags (decision 12).
- **ADR 0062, decision 17:** before the WebAssembly model, intents carry
  client-made ids and the TypeScript model predicts behind a parity test;
  the end state is unchanged (decision 11).
- **ADR 0065, decision 6:** the working plate's breath and sheen are drawn
  by layers on the compositor; the three choices stay (decision 9).
- **GLOSSARY:** Tile and Configure are added; Live component says it
  obeys its Tile's Configure (decision 4).
