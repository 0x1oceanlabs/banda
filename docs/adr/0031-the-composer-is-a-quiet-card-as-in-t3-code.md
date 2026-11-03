---
status: accepted
date: 2026-11-02
---

# The composer is a quiet card, as in T3 Code

ADR 0010 and ADR 0015 made the composer work as T3 Code's. It still looks
like a form field: shadcn's input group, a border with a 3 px ring on
focus, a square send button, and under the text a row of everything the
Thread runs with (an image button, the Harness's options one by one,
Plan, the mode, the context share). On 2026-11-02 Roma asked for a
redesign like T3 Code's, beautiful and elegant, and found the first mock
too crowded: Plan is a slash command, and the composer need not say the
Agent works.

T3 Code's composer (`apps/web/src/components/chat/ChatComposer.tsx`,
`ComposerSurface.tsx`, `ComposerPrimaryActions.tsx`, clone of 2026-11-02):
a card with large corners on a raised, frosted surface; a hairline outline
and, in dark, a faint highlight at its top edge; no focus ring; text first,
then one row: `+` on the left, the model picker (model, effort and
permissions in one trigger) and a round send button on the right; Stop is
round too; the card is as wide as the messages, centred.

## Decision

1. **The composer is a card, as Codex's.** In light it is the tile's own
   `background`, not grey, lifted by Codex's soft shadow (a 4 % hairline,
   `0 2px 8px` at 4 %, `0 4px 40px 8px` at 2.4 %); in dark it is a little
   lighter than the tile (`foreground` at 8 %) with Codex's hairline
   (`inset 0 0 1px` white at 20 %) and no shadow. No focus ring. Its
   corners follow ADR 0007's ladder (`rounded-lg`), never rounder than the
   tile around it, not Codex's 22 px. It is as wide as the messages and
   centred. Files dragged over it tint it (`accent`) with an inner
   `primary` line. (Roma, 2026-11-02: the first, grey card was not liked;
   of four mocks, Codex's own was chosen.)
2. **The send button is round.** `primary` with a thin arrow; with nothing
   to send it is `foreground` at a tenth and muted. While a turn runs it
   steers or queues as before (ADR 0010, decision 7), with those icons;
   with no text it is Stop: round, neutral, a rounded square inside, not
   red.
3. **One row under the text, three things in it.** `+` on the left adds
   images and files. On the right: what the Thread runs with as one
   trigger, and the button. The trigger names the model, then the other
   chosen values muted ("Opus 4.7 High"), after an icon of the mode; it
   opens one menu with each of the Harness's options and the mode ("How
   freely it acts"). Nothing rests faded beside them (this replaces ADR
   0010 decision 7's last point).

   *Amended 2026-11-03, as Codex has it (Roma's call):* two triggers, not
   one. A quiet shield, the mode's icon, opens the modes, and the
   Harness's options the picker does not set. The model picker names the
   Harness by its logo, then the model and the effort, the effort in the
   theme's blue, its top level in magenta. It opens on a slider of effort
   levels (the Harness's `thought_level` option; its `default` is no
   stop), with Fast mode (a `model_config` toggle named fast) on the
   left and a way back to the Harness's own defaults on the right; the
   model's name opens the list of models, each under the logo with what
   it is for.
4. **Only what is on shows.** Plan is not a button: `/plan` and `/default`
   switch it, and Shift+Tab, as before. While it is on, a quiet "Plan"
   sits beside `+`, and a click turns it off. The context ring shows from
   half full; from 80 % it warns, as before.
5. **The composer does not say the Agent works.** The timeline and the
   Thread's mark do; the button turning into Stop is enough.
6. **A new Thread's Space and Harness sit under the card**, in a bare row
   without a surface, as T3 Code's environment and branch.
7. **The messages fade out at both ends**, under the header and above the
   composer, while there is more that way (shadcn's `scroll-fade`, a mask,
   so it works on glass too); at the end, the last line is not faded.
   Roma chose a plain fade over macOS Tahoe's progressive blur.
8. **A Thread's header has no line under it** (the Pane kind's `header:
   "bare"`), and reads: its Agent's mark, as the sidebar shows it (faded
   at rest), its Space, then its title. The frame draws it from the list
   the sidebar reads, for any Pane that shows a listed thing; a tabbed
   column's tabs still take its place.
9. The empty box keeps naming the Agent and its triggers ("Write to Claude
   Code. @ files, / commands, $ skills"): Banda runs more than one Harness.

Not done: T3 Code's banners docked on the composer's top edge (a Question
or Plan ready as part of the card). Roma did not want it now.

## Consequences

- The composer no longer uses `InputGroup`; it is its own surface in the
  agents Pane. Beside the send button sit `ModeMenu` and `ModelPicker`;
  the settings page keeps its
  bar of a Harness's defaults, Plan among them.
- The look follows the theme's tokens only, so light and dark, Omarchy
  themes and the glass (ADR 0023) need nothing of their own.

## Build order

1. The card and the buttons: decisions 1, 2.
2. The row: decisions 3, 4, 6.
