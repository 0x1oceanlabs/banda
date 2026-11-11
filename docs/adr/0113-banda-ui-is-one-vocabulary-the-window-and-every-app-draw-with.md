---
status: accepted
date: 2026-11-11
---

# Banda UI is one vocabulary the Window and every App draw with, and a check holds it

_It carries out the guidelines' planned lint (`design.4`, "Check: planned
(a lint)") and widens it from colours to type, shadows, layers and
lengths, as ADR 0080 decision 6 did for corners. It adds the type scale
and the elevations to the token list of ADR 0080 decision 7, so that the
whole look is in the tokens, as ADR 0062 decision 18 asks. It amends the
design reference's "4 px grid". It touches no ADR's behaviour._

Roma asked on 2026-11-11 (translated): "Is there a rule for Agents
writing the interface: which radii and other parts of the theme to use,
so the look is one everywhere? If not, bring it in properly, maybe
through a lint." After hearing the plan: "In essence we are making our
own Banda UI, and it will be useful for the App SDK later."

## What is there today

Most of the vocabulary exists, in four places, and one part of it is
held by a machine:

- **The reference.** `docs/design/README.md` has the tokens, the type
  scale (prose 14/22, UI 14/20, meta 12/16, mono 12.5/20, headings 18
  and 16), the five corner levels, a 4 px grid, the heights, the
  elevation (none, mostly; shadows only for what floats) and the motion.
- **The tokens.** `platform/theme/src/tokens.rs` lists them once; the
  build writes `sdk/contract/src/generated/look/{tokens.css,tokens.ts}`
  (ADR 0080, decision 7). Colours, the corner levels, the fonts, the
  root size, the gaps and three shadow strengths are tokens. The type
  sizes and the shadows' shapes are not: `globals.css` writes them by
  hand.
- **The classes.** `client/ui/src/styles/globals.css` names Tailwind
  classes on the tokens in `@theme inline`: every colour, the five
  corners (with shadcn's ladder mapped onto them, ADR 0100 decision 11),
  `text-prose`, `text-meta`, `text-code`.
- **The catalogue.** shadcn/ui as `@banda/ui` has it, and Banda's own
  components (ADR 0062, decision 7).
- **The check.** `client/web/src/architecture.test.ts` refuses any
  corner off the five levels. Its exceptions are a list, each with its
  reason, held both ways: a new case fails, and a case that takes a
  level must leave the list. It reads every file the Window and the
  Panes draw with, stylesheets included. Nothing holds colours, type,
  shadows, layers or lengths.

So the drift is where nothing holds it. Measured on main at
`8e112dfef`, over the 584 files the corner check reads, comments
stripped, and counted again by step 1's check on `121ac5258`, over the
599 files it reads:

| Kind | Cases | Files | Mostly |
|---|---|---|---|
| type | 109 | 61 | `text-[11px]`, `text-[10.5px]`, `text-[13px]`; `font-size` as numbers; `text-base`, `text-lg` |
| layers | 55 | 40 | `z-10`, `z-50`, `z-20`, `z-1`, `z-30`, `z-40` |
| colours | 56 | 24 | masks' `#000`, a copied palette, `bg-white`, `bg-black/10`, fallback copies of tokens |
| shadows | 45 | 37 | `shadow-md`, `shadow-sm`, `shadow-lg`, `shadow-xs`, seven drawn by hand |
| lengths | 28 | 9 | `pb-[5px]`, `mt-[22px]`, `gap-[7px]`: off the 4 px grid |
| corners | 9 | 3 | already listed, each with its reason |

_Step 1's check is the record. The first count missed a PDF's two
system colours, a Question's 14.5 px and a slider's two shadows, and
left out Tailwind's size names other than `text-xs` and `text-sm` (16);
main gained a 13 px since._

Of the 109 type cases, 56 (in 38 files) are sizes from 9 to 11.5 px: keys,
tags, counts on icons, captions in Files' lists, menus' labels, the
limits' notes. 12 (in 10 files) are 13 px. A px size also ignores the
theme's font size: the `macos` theme's 13 scales every `rem` level, and
leaves a `text-[13px]` at 13.

The design kit (`docs/design/kit/`) has the same drift: it draws keys,
tags and menus' labels at 11, buttons, menus, tabs and toasts at 13, a
badge at 9, and its shadows by hand. Tailwind's own names are also
common: `text-xs` 327 times and `text-sm` 126 times, in 150 files. They
equal meta and UI exactly, so they are no drift, but they are a second
name for each.

## Decision

1. **Banda UI is one vocabulary.** Whatever Banda draws, in the Window
   or an App, takes its colour, corner, type size, shadow, layer and
   lengths from it, and from nowhere else. It has four parts:

   | Part | What | Where |
   |---|---|---|
   | the tokens | colours, the five corners, fonts, the root size, gaps; new: the type scale and the elevations | the theme: `platform/theme/src/tokens.rs`, generated to `tokens.css` and `tokens.ts` |
   | Banda's names | the classes on the tokens: `bg-muted`, `rounded-card`, `text-meta`, `shadow-float`; the layers | `@banda/ui`: `globals.css`'s `@theme` |
   | Tailwind's names, mapped | `rounded-md`, `text-sm`, `shadow-lg` land on a level, for code that comes as it is | the same `@theme` |
   | the catalogue | shadcn's components and Banda's own | `@banda/ui` (ADR 0062, decision 7) |

   The design reference shows it, the guidelines' §5 say its rules, and
   one check holds them (decision 9).

2. **A value the vocabulary lacks becomes a named step, never a number
   in a component.** If a theme may change it (a colour, a size, a
   strength), it is a token in the theme, so every client, a phone too,
   draws it (ADR 0062, decision 18). If it is structure that no theme
   changes (the layers' order, Tailwind's spacing step), it is named
   once in `@banda/ui`.

3. **Type has one scale.** Each level is a token, its size worked out
   from the theme's font size as `text-root` is, so the `macos` theme's
   13 and a Person's font size scale every level together. Banda's code
   writes the level's name:

   | Level | Size / line | For |
   |---|---|---|
   | `text-heading` | 18/26 | a reply's first heading, a page's title |
   | `text-title` | 16/24 | a reply's second heading, a dialog's title |
   | `text-prose` | 14/22; 15/24 from 40rem | a reply, the Person's message |
   | `text-ui` | 14/20 | rows, work lines, menus, controls |
   | `text-code` | 12.5/20 | code, diffs, commands, paths |
   | `text-meta` | 12/16 | times, counts, captions, small buttons |
   | `text-small` | 11/14 | **Roma's answer, Q1:** a key, a tag, a count on an icon, a menu's label |
   | `text-figure` | 28/32 | **Roma's answer, Q3:** the one number a Pane is about |

   A line height may change by Tailwind's names (`leading-none` in a
   badge), not by a number. A size does not change. Weights and letter
   spacing stay as the reference has them, and are not checked.

4. **A shadow is one of the elevations.** Most things have none: a 1 px
   line and a step of fill set them apart (the reference, "Elevation").
   The named ones:

   | Elevation | What |
   |---|---|
   | `shadow-float` | what floats: the Top layer (menus, popovers, dialogs, toasts) and a Pane's own floating bar (Find, a quote's button, a zoom badge) |
   | `shadow-lift` | what the Person carries: a Pane being moved, a Peek |
   | `shadow-tile`, `shadow-focus`, `shadow-panel` | the Window's own: a tile over glass, the focused tile, the glass sidebar (ADR 0075, decision 5; ADR 0023) |

   Each is a token: its offset, blur and strength, a theme saying the
   strength, as it does for the three today. A line drawn as an inset
   shadow with no blur, in a token's colour, is a ring, not an
   elevation: Tailwind's `ring` and `inset-ring` draw it, and it is not
   counted.

5. **A layer is named.** Two scopes:
   - **Inside a Pane, or a component:** `z-raised` (above its siblings)
     and `z-float` (a Pane's own floating bar, a sticky head). Each Tile
     isolates its stacking, so nothing a Pane draws rises past its Tile.
   - **The Window's own:** the sidebar, the Drawer and sheets, the Top
     layer, and what the Person carries, each one name. Their order is
     ADR 0110 step 3's ("the Top layer in the Window: one stack"); this
     ADR only names them, in one table in `@banda/ui`.

6. **A colour is a token, or tokens mixed.** A token thinned
   (`bg-foreground/10`) or two tokens mixed (`color-mix()` over `var(--…)`
   and `transparent` alone) follow every theme, so they are the
   vocabulary. A literal is not: hex, `rgb()`, `oklch()`, a named colour,
   a Tailwind palette name (`amber-500`), `black` and `white`. Three
   colours are not the theme's, and get names of their own in
   `@banda/ui`:
   - `paper`: a document's own page, white in every theme, as a PDF's
     or a notebook's;
   - `scrim`: black that dims, under a dialog, the Drawer, a tile out of
     focus, a web page's veil, and behind a video;
   - the glass's light edge, as a glass token (ADR 0036).

7. **Lengths are Tailwind's steps or tokens.** `p-2`, `gap-1.5`, `h-7`,
   `w-(--sidebar-width)`, `calc()` over tokens, `%`, `ch`, `vh` are the
   vocabulary. A literal length in a class's brackets off the 4 px grid
   (`pb-[5px]`, `gap-[7px]`) is not. Tailwind's half steps (2 px, as in
   `gap-1.5`) stay: shadcn's components and the kit use them (a
   control's corner is 10, a card's padding 6 × 8), and they are 592
   uses in 143 files. Lengths in stylesheets are not checked: they hold
   the tokens' definitions and streamdown's restyling.

8. **One name per level in Banda's code; Tailwind's names only land.**
   - Banda's code writes Banda's names, as ADR 0080 decision 6 has it
     for corners. A name says what a level is for (`shadow-float`,
     `text-meta`), which the check cannot hold and a reviewer can read.
   - Tailwind's names stay mapped onto a level for what comes as it is:
     streamdown, shadcn's components as `shadcn add` brings them. Type:
     `xs` meta, `sm` UI, `base` title, `lg` and up heading. Shadows:
     every size is `float`. Corners: as ADR 0080 decision 6.
   - The rest of Tailwind's defaults is cleared in `@theme`, kind by
     kind, once nothing uses it, so a wrong class does not exist: the
     palette (`--color-*: initial`, `black` and `white` too), the other
     text sizes, `inset-shadow-*` and `drop-shadow-*`. Not before: a
     class cleared while in use loses its style with no error.
   - `z-*` and arbitrary values cannot be cleared; the check holds them.

9. **One check, built as the corner check is.**
   - One scanner, `look(source)`, in `@banda/ui/testing`, finds each
     case in a source or a stylesheet with its kind and rule id
     (`design.4`, `design.9` to `design.13`). The corner scanner joins
     it, and `OWN_CORNERS` joins its list.
   - It reads what the corner check reads: `client/web`, `client/core`,
     `client/ui`, `client/ghostty`, and every App's and platform part's
     `pane/src`; TS, TSX and CSS; not tests, not `@banda/ui/testing`.
     The kit's stylesheets join in step 2. Not read: `node_modules`
     (streamdown, shadcn as published, which land by decision 8), the
     generated tokens, Rust (a Tree carries no colours, decision 12),
     and the pages Agents write for a Visual, which are content.
   - Allowed by rule, not listed: a custom property defined in
     `@banda/ui`'s stylesheets (that is where a name is made, as
     `--tile-shadow` is); `color-mix()` of tokens anywhere; rings
     (decision 4); `z-index: 0` and `-1`.
   - **The list.** Each case is a line, in groups, each group with its
     rule id and its reason: why it stays, or the step that moves it.
     Two tests, as for corners: nothing off the vocabulary beyond the
     list, and a case that came onto it leaves the list. So the list
     only falls (`borders.10`).
   - It lives in its own test, `client/web/src/look.test.ts`, with the
     list beside it, not in `architecture.test.ts`. What files are read
     moves into `@banda/ui/testing`, shared by both.
   - A refusal says what to write instead: "`text-[11px]` is off the
     scale: write `text-meta`, or add a level to the theme".

10. **A test, not an ESLint plugin or stylelint.**
    - The cases are in TSX and CSS alike: a class in a string, a
      `font-size` in a stylesheet. ESLint reads one, stylelint the
      other: two tools, two configurations, two lists. One scanner reads
      both, as `corners` and `layoutMotion` do now.
    - A class is a string in `cn()`, a `cva` variant, a template or a
      constant. A pattern over the source finds it wherever it is; an
      ESLint rule must know each call's shape.
    - The list that only falls is the guidelines' rule (`borders.10`).
      ESLint's exceptions are `eslint-disable` comments spread over the
      files, which nothing counts.
    - It runs where the corner check runs, in `pnpm test` and CI's `ci`.
      Nothing new to install or wire.
    - What ESLint would give is a mark in the editor as one types. The
      scanner is a pure function, so a rule that calls it can come later
      if that is wanted.

11. **The rules in words.** With the check, in one PR (step 1):
    - **AGENTS.md** gets a rule beside "Show it first":

      > **Draw with Banda UI.** Whatever you draw, in the Window or an
      > App, takes its colour, corner, type size, shadow, layer and
      > lengths from Banda UI: the theme's tokens and the classes
      > `@banda/ui` names on them ([the Banda look](docs/design/README.md),
      > [the guidelines' §5](docs/sdk/guidelines.md#5-design)). A value it
      > lacks becomes a token, never a number in the code. The look check
      > refuses the rest; a case it must allow goes in its list with its
      > reason, and the list only falls.

    - **The guidelines' §5**, and their digest `docs/sdk/skill-apps.md`
      in the same PR, as their header asks:
      - `design.4` **Colours are tokens,** or tokens mixed: no hex,
        `rgb()`, `oklch()`, named colour or palette name. *Check:* today.
      - `design.9` **Corners take the five levels** (ADR 0080, decision
        6). *Check:* today (the corner check, which joins).
      - `design.10` **Type takes the scale,** by the level's name; no
        size as a number. *Check:* today; `text-xs` and `text-sm`
        after step 1b.
      - `design.11` **A shadow is an elevation:** `float`, `lift`, or
        the Window's own; most things have none. *Check:* today.
      - `design.12` **A layer is named;** a Pane's stay inside its Tile.
        *Check:* today.
      - `design.13` **Lengths are Tailwind's steps or tokens,** no
        literal off the 4 px grid. *Check:* today.
      - `design.14` **A value the vocabulary lacks becomes a named
        step,** never a number. *Check:* review; the check finds the
        number.
    - §10 "Planned", item 1, drops "colour literals": this check holds
      them.

12. **Apps get the same vocabulary.** Banda UI is what the App SDK
    gives an App to draw with:
    - **A Tree** draws only the catalogue (`design.1`), and its props
      carry no colours, with `className` for layout alone (`design.2`).
      So a Tree cannot drift in colour, type or shadow, and the Tree
      schema holds its lengths to decision 7. _Waits for the Tree
      schema's check (`design.2`, planned)._
    - **A Frame** (`ui://`, ADR 0062, decision 10) gets the vocabulary
      as CSS variables through MCP Apps' `host-context-changed`, as a
      Visual already gets the colours and fonts under T3 Code's names
      (`apps/agents/pane/src/visual/visual-frame.ts`). The type levels,
      the corners and the elevations join them, so an MCP App can match
      Banda without knowing it. _Waits for the step that hosts MCP
      Apps._
    - **An App from elsewhere** runs the same scanner, as `banda check`
      over its folder, with its own list, and sees the same refusals
      under the same rule ids. _Waits for V4, when an App from
      elsewhere can be installed._

13. **A catalogue page shows Banda UI.** One page of the web client draws
    each `@banda/ui` component, each type level, elevation and corner,
    from the real code. CI shoots it in the four schemes of each
    built-in theme, with `client/desktop/e2e/themes.spec.ts`. It is the
    reference that cannot drift from the code, for Roma, for Agents
    before they draw, and for an App's author. The kit stays for mocks
    of what is not built yet.

## Today's cases, by kind

What step 1's list holds, by group. "Stays" is a reason that holds;
the rest leave with the step named.

**Colours, 56 (`design.4`)**
- Stays, 26: masks and probes, where black and white say what shows or
  read a colour back, not a colour seen (14: the Mark's mask in
  `banda-mark.tsx`, a Project's Sign's cut, a fade's mask in
  `globals.css`, two canvas probes); Recharts' own default strokes,
  matched to restyle them (5, `chart.tsx`); the code highlighter's
  palette, copied for Files' JSON tree (6, `code-look.ts`); the Agent's
  pointer over a web page, outlined in white to read on any page (1).
- Named colours, step 4, 12: `paper` (4: a PDF's, a page's, a
  notebook's), `scrim` (6: a dialog, the Drawer, the Overview's lifted
  tile, a tile out of focus, a web page's veil, a video), the glass's
  edge (2).
- Drift, step 4, 18: fallback copies of tokens in the notifications
  module (6); `text-white` on two counts; hover fills of
  `black/[3.5%]` and `white/8` (4); PDF find highlights in `rgb()` (2);
  a PDF's text layer's selection and caret in the system's colours,
  `AccentColor` and `CanvasText` (2); `bg-amber-500/10` in a notebook;
  the terminal renderer's default selection, which the `selection` token
  has.

**Type, 109 (`design.10`)**, all step 2 but 3: 56 at 9 to 11.5 px; 12 at
13 px; 4 at 12.5; 1 at 14.5 (a Question's title); 2 at 15 (the Banda
menu); 1 at 0.8rem (a small button's); 2 figures at 40 and 28 (the Usage
Pane); 2 line heights in px; 2 prose sizes by `var()`; 11 sizes as
numbers in stylesheets and styles (streamdown's headings, footnotes, code
and table cells in `globals.css`, the diff's header in `code-diff.tsx`,
Mermaid's size); 13 of Tailwind's other size names (`text-base` in
shadcn's inputs, fields, cards and dialogs; `text-lg` and `text-xl`, the
Settings page's title and the message box's headings), which step 2
clears. A font file's specimen (Files' font view, 3) stays: it shows the
font at sizes of its own.

**Shadows, 45 (`design.11`)**, all step 3: 9 in the Top layer's
components (menus, a popover, a select, the suggestions, a chart's
tooltip, the browser's titles), which become `float`; 18 on a Pane's or
the Window's floating parts and dialogs, which become `float`; 4 on what
the Person carries (a Pane being moved, a widget dragged on the Bar, a
workspace lifted in the Overview, a Peek), which become `lift`; 11 on
what does not float (a picked segment, a sidebar card, the Projects
list, the Overview's labels, a thumbnail, a Group's handle, a machine's
pill, a switch's and a slider's thumb), which lose it or float; 3 of
their own (the browser's inset glow and cursor shadow, a PDF page's
lift).

**Layers, 55 (`design.12`)**, step 5: 16 at the Top layer's 50 (shadcn's
menus, dialogs and popovers, a carried Pane); 6 for the Window's areas
(20, 30, 40); 33 inside a Pane or a component (1, 2, 10, 20).

**Lengths, 28 (`design.13`)**, step 5: 17 in the Usage Pane, the limits'
widget and the spend card; 3 in the browser; 8 elsewhere.

**Corners, 9 (`design.9`)**: as listed today, all stay.

At the end of step 5 about 30 cases stay, each with its reason, and
the corners' 9.

## Roma's calls

Roma answered on 2026-11-11: A to all three ("as you recommend").

**Q1. The small sizes, 9 to 11.5 px (56 uses in 38 files).**
- A. One more level, `text-small` at 11/14, only inside small things: a
  key, a tag, a count on an icon, and a menu's label (the reference
  already says 11 for it, and the kit draws keys, tags and labels at
  11). About 20 of the 56. The rest (Files' captions and footers,
  Git's notes, the limits' and spend's notes, Settings' notes in mono)
  go up to meta, 12/16.
- B. All up to meta, 12/16. The count on the logo grows from a 14 px
  dot to 16.
- **Answer: A.** It keeps the look Roma liked in the mocks, and puts
  one floor, 11, where there are five sizes today. Captions are meta.

**Q2. 13 px (11 uses in 9 files: the sidebar's search and tabs, a
Thread's details rows, a sub-agent's row, Files' info title, the Usage
Pane's tabs and lists, the machine picker, the update card).**
- A. Up to UI, 14/20, as the reference's table and shadcn's controls
  have it. The kit's 13 (search, tabs, buttons, menus, toasts) moves to
  14 in step 2.
- B. A `compact` level at 13/18 for controls, tabs and menus, as the kit
  draws them. Then the window's buttons and menus move from 14 to 13.
- **Answer: A.** 13 beside 14 and 12 is three sizes in two pixels.
  If Roma wants the whole look denser, the `banda` theme's font size
  goes to 13, as `macos`'s is, and every level scales together.

**Q3. Above the headings: the Settings page's title at 20, the message
box's headings at 20 and 18, the Usage Pane's figures at 40 and 28.**
- A. Titles onto `text-heading`, 18/26, the reference's ceiling. The two
  figures onto one level, `text-figure` at 28/32, only for the one
  number a Pane is about.
- B. Everything onto 18, figures too.
- **Answer: A.** A Usage Pane reads by its number; one size for it,
  and nowhere else.

## Rejected

- **An ESLint plugin, or stylelint:** decision 10.
- **Tailwind's defaults cleared at once,** as a safety net before the
  moves. Each class in use would lose its style silently, a change on
  screen with no picture.
- **A check of every length off the 4 px grid,** half steps included:
  592 cases in 143 files, most of them shadcn's own, for no change a
  Person sees. Decision 7 keeps the literal ones.
- **Tailwind's `text-xs` and `text-sm` kept as second names in Banda's
  code.** They equal meta and UI, but one level would have two names,
  and Agents would read both. Renamed in step 1b, by a script, with
  nothing on screen.
- **`color-mix()` refused, as `design.4` had it.** In a stylesheet it is
  the only way to thin a token, and in a class `/10` is the same mix. A
  mix of tokens follows every theme; a literal does not.
- **The layers in the theme.** A theme does not reorder the Window.

## Consequences

- An Agent or a Person who writes `text-[11px]`, `shadow-lg`, `z-50` or
  `#fff` in Banda's code sees CI refuse it, with what to write instead.
  A real exception is a line in the list, with its reason, in review.
- The look reaches every client: the type scale and the elevations are
  tokens, so a phone draws the same levels (ADR 0062, decision 18).
- A visible step is a move onto a level, so most of them make the window
  more alike, not new. Each still shows Roma before and after.
- Two copies of the look stay, the window's and the kit's. The parity
  test (step 2) and the catalogue page (step 6) hold them together.
- `architecture.test.ts` loses the corner check and gets shorter.
- Fills (the text at 3.5, 5, 7, 8, 10, 12 or 13%) stay unchecked: see
  below.

## Changes

- ADR 0080, decision 7: the token list also holds the type scale and the
  elevations. `globals.css` stops writing `--text-meta` and `--text-code`
  by hand.
- ADR 0080, decision 6: its check becomes part of the look check, with
  its rule unchanged.
- The design reference, "Radii and spacing": "a 4 px grid inside
  everything" becomes "Tailwind's steps, 4 px, with halves (2 px) inside
  small things". Its type table gets the levels' names and Roma's
  answers; "Elevation" gets the elevations' names; the kit-vs-window
  table loses what step 2 aligns. With step 2.
- The guidelines, as decision 11 says. With step 1.

## Steps

Each step is its own PR. Step 1 and 1b change nothing on screen. Each
visible step shows Roma shots before and after, in light and dark, glass
on and off, and has no auto-merge.

1. **The check.** The scanner (the corner scanner joins), its test and
   its list; the new names defined (`text-ui`, `text-title`,
   `text-heading`, `shadow-float`, `shadow-lift`, the layers, `paper`,
   `scrim`) with today's values, used by nothing yet; AGENTS.md, the
   guidelines and `skill-apps.md`.
   - 1b. `text-xs` and `text-sm` (453 uses, 150 files) renamed to
     `text-meta` and `text-ui` by a script, at a time when few branches
     are open. Then the check refuses them too, as it does Tailwind's
     other size names from step 1.
2. **Type onto the scale,** with Roma's answers. The scale into the
   theme's tokens. The kit onto the same levels; it joins the check,
   with a test that its values are the theme's. Tailwind's other sizes
   cleared.
3. **Shadows onto the elevations.** Their strengths in the theme.
   Tailwind's shadow sizes mapped to `float`, inset and drop shadows
   cleared.
4. **Colours into tokens:** the copies, `paper`, `scrim`, the glass's
   edge. Mermaid's error drawn as Banda's own block, since streamdown
   draws it in its own reds. Tailwind's palette cleared.
5. **Layers and lengths.** The named layers, with ADR 0110 step 3; each
   Tile isolates. The 28 lengths onto steps. Shots where something
   moves.
6. **The catalogue page,** shot by `themes.spec.ts`.

The SDK's parts wait for their own steps (decision 12).

## Not decided here

- A scale of fills: the text at 3.5, 5, 7, 8, 10, 12 and 13% is used
  today, beside the reference's few steps. Whether to name them and
  check them is its own question.
- Weights (400, 500, 550, 600) and letter spacing: in the reference, not
  checked.
- Whether code's colours follow the theme, as the terminal's ANSI ones
  do, instead of the highlighter's own palette.
- The kit's future once the catalogue page draws Banda UI from the code.
