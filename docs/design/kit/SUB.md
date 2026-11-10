# Sub-agent kit (sub.css + sub.js)

The shared parts for the sub-agent and Crew mocks (the sub-agent brief's §3,
§5.1–5.6 and §5.9). Reference sheet: `sub-demo.html`, its notes in Russian;
a shot of it is [`../shots/satellites.jpg`](../shots/satellites.jpg). The
rules behind it: [`../README.md`](../README.md). The paths below are a mock's
in a folder beside `kit/`.

```html
<link rel="stylesheet" href="../kit/kit.css">
<link rel="stylesheet" href="../kit/sub.css">
…
<script src="../kit/icons.js"></script>
<script src="../kit/mark.js"></script>
<script src="../kit/sub.js"></script>   <!-- last: mounts [data-sat], [data-glyph], [data-strip], [data-sicon] -->
```

If you write markup from JS after load, call `BandaIcons.scan(); BandaMark.scan(); Sub.scan()`.

## Satellite

| state | shape | colour |
|---|---|---|
| working | filled circle | fg 45% |
| asks | rounded triangle | `--attention` |
| failed | octagon (flats on whole px) | `--destructive` |
| done | rounded square | fg 70% (not green) |
| stopped | outline square | fg 38% |
| queued | dashed circle | fg 32% |
| lost | faint outline square, top-right gap | fg 30% |

- `Sub.sat(state, size = 10, {dim, tip})` returns an HTML string. `<span data-sat="asks" data-size="10"></span>` does the same in markup. `data-dim` (or `{dim:true}`) means "from last run".
- Sizes: 8 in a strip, 10 at the start of a row (in a 16px slot), 12 in a Pane header and the status bar.
- `Sub.set(el, state)` blends to a new state: 0.45 s, or a 0.6 s leap when the shape family changes. Satellites never move on their own.
- Aliases: running, retrying → working; error, blocked → failed; cancelled, skipped → stopped; waiting → queued; cached → done.
- `Sub.glyph('running' | 'finished' | 'lost' | 'asks' | 'relaunched' | [3 states], 16)` draws the Crew glyph. `<span data-glyph="running">` does the same in markup.
- At 8px an octagon is nearly round. The red still marks it there, and the shape reads from 10px up.

## Row, detail, group (see the markup in sub-demo.html)

```
.s-row[data-state] (.is-open, .is-dim)
  .s-line  > .s-slot(sat) .s-title(.s-fit | .s-path>span) .s-role .s-deep .s-wt b-tag .s-now .s-time .s-acts .s-chev
  .s-detail > .s-brief(.s-brief-text>.s-k "Claude asked") .b-tl .s-report(.is-long) .s-dacts
.s-group (.is-settled, .is-folded) > .s-line.s-ghead(.s-sats .s-gtitle .s-chev) + .s-members(.s-row… .s-more)
```

- `Sub.row({state, title, role, now, time, wt, deep, tag, path, dim, open, stop, detail})` returns HTML. `now` may hold HTML. For asks it adds "**Asks:**" itself. Failed adds the `Failed` tag. Stop is offered only while the row is working or asks, and `stop:false` hides it (Crew agents, idle Codex children).
- `Sub.group({members, more, moreStates, settled, time, title})` gives "3 sub-agents · 2 working · 1 asks" while live and "Ran 5 sub-agents · 2m 40s" once settled.
- Hover actions replace the time: Open beside (`panel-right`) and Stop (`stop`). Add `.is-hover` to `.s-line` to show them in a still.
- `.s-path` fades a path from its start so the file name stays. `.s-fit` fades the end. Both fade only when the text overflows (Sub.fit).

## Crew strip and card

- `Sub.strip(el, {phases: [{title, agents: [state | {state, label, dim}]}], current, size: 8 | 10, max: 24})`
- Markup: `<div data-strip="Scan: done*4 | Fix: done failed working asks | Verify: queued*3" data-current="1">`. Use `~done` for a dimmed agent.
- `current` is a phase index or title. By default it is the first phase with work still open. Use -1 for all future (approval) and `phases.length` for all past.
- A phase with more than `max` agents, or one that will not fit on one line, becomes a segmented bar with "settled/total". The strip re-fits on resize. `.is-spread` stretches the rules, for the Pane.
- Dots carry `data-tip`. A click fires `sub:open` with `{phase, index, agent}`, and the event bubbles.
- `Sub.crew(el, {state: running | finished | lost | relaunched | asks, name, desc, phases, current, narrator, time, foot, action, open, glyph})` renders the card. The foot is counted for you: running gives "12 agents · 1 working · 1 asks · 6 done · 1 failed · 3 waiting", finished gives "12 agents · 3 phases · 2 failed", lost gives "Stopped when Banda restarted · 7 of 12 done" plus **Ask Claude to go on**, and asks gives "Waiting for your OK".
- `Sub.counts(states, {noun, total, queued})` and `Sub.tally(states)` are there for your own summary lines. Only "N asks" (orange) and "N failed" (red) take colour.

## Dock, live line, status bar

- Sub-agent asks: `.b-docked > .b-docked-head.s-ask-head` holding `<span data-sat="asks"></span><span><b>Reviewer</b> asks · 2m</span>`, then `.s-cmd` (`<span class="s-prompt">$</span>`), the `.b-choice` rows (`.is-hl`, with `.s-hint` "↵"), and `.s-note`.
- Crew approval: `.b-docked.s-crewask` holding the head, `.s-crewask-title` (glyph, `<b>name</b>`, `.s-crew-desc`), `.s-phases` (`<span><i>1</i>Scan <em>detail</em></span>`), `.s-note` and the choices.
- Live line: the kit's `.b-tl` + `.b-spin` + `.b-shimmer` + `.b-quiet`. Work that outlives the turn swaps the spinner for `Sub.glyph('running', 15)`.
- Opened sub-agent: `.b-pane-head` with `data-sat` at size 12, the title and `.b-pane-detail`. Nested panes use `.s-crumbs` (`span … i[chevron] … span.is-here`). The brief is `.s-asked > .s-asked-label + .b-you`.
- `.s-statusbar[data-state]` (working | asks | done | failed | stopped | lost) takes the message box's place, with its shape and radius (kit `--r-card`): satellite 12, `.s-sb-text > .s-sb-word, .s-sep, span`, and `.s-sb-acts` with **Ask Claude about it** (at-sign) and Stop.

## Tools

- `node docs/design/kit/shot.mjs page.html out.png [--width 1440] [--height 900] [--selector "#id"] [--clip X,Y,W,H] [--full] [--light] [--solid] [--hash x] [--scale 2] [--wait 600] [--type jpeg] [--quality 85] [--chromium PATH]`. It prints every page error, and then exits 1.
- Pages read `#light` / `#solid` in the hash (sub-demo also toggles with the t and g keys).
