---
status: accepted
date: 2026-11-02
---

# The bar's middle counts who waits and who works

ADR 0024 left the bar's middle empty: a Pane has its own header, so the
bar need not repeat it. With the sidebar closed, though, nothing tells the
Person which Agents finished and wait for them, or how many still work,
except the Mark's loudest state and a toast that goes away. Roma, on
2026-11-02: "a strip of the agents' work for when the sidebar is closed,
so it is seen who finished what and you go to it", "a counter of how many
agents finished and wait for you and how many work now", "with our marks
from the logo", "in the middle of the bar". Roma tried four ways in a
mockup (two marks, three marks, marks with words, a mark per Agent) and
decided.

## Decision

1. **The bar's middle shows the sidebar's counts**, centred on the
   window whatever the sides hold. Each count is a mark and a number:
   - **asks you**: the Threads that ask, or failed; the triangle, in the
     attention colour, red once any failed;
   - **done**: those that finished and the Person has not seen; the
     square that smiles, green as in the sidebar;
   - **working**: those at work; the circle, muted.

   A count of none is left out (Roma: "if there are no failures, don't
   show it"). With nothing to count, the calm square stays: the Agent's
   mark at rest, muted, so the counts never vanish from their place
   (Roma, 2026-11-02: "I want the widget not to disappear; if nothing
   goes on, let the square of calm hang there"). Seen Threads are
   counted no more: the number is all the bar shows, not their names.
2. **The counts are the sidebar's**: the same lists every module's Watch
   gives (ADR 0008), over every open Space, and a settled Thread is not
   counted, as the sidebar shelves it. So they show while the sidebar is
   closed, the default, as it shows the same.
3. **A click lists them** under the bar, as a menu: "Wait for you" then
   "Working", each row as the sidebar draws it (the mark, the title, the
   Space, the status). The loudest comes first, then the one that waited
   longest, as Alt+U goes (ADR 0011, decision 5). A row opens its Thread
   as the sidebar's row does; seeing it makes "done" seen.
   _Changed by ADR 0087, decision 8: inside each group the rows follow
   the sidebar's order, the one Alt+U walks, not the loudest first._
4. **A number rolls when it changes**, up as it grows, down as it falls,
   and not at all for a Person who asked for less motion. The done
   count's mark flips as a Thread finishes; a row of the list does not
   flip each time the list opens, as that already was and is no news
   (ADR 0011, decision 6): a mark can be drawn as no news.
5. **`[bar]` in `sidebar.toml` changes them**, as part of the sidebar; a
   preset may set it too. Every key is optional; the defaults are Roma's:

   ```toml
   [bar]
   show = "closed"                     # "closed", "always" or "never"
   counts = ["asking", "done", "working"]  # also "waiting": asking and done as one
   color = true                        # false: the counts in the text's colours
   words = false                       # words beside the numbers
   empty = "mark"                      # the calm square when nothing is counted; "hide": nothing
   ```

   The settings Pane shows them from the schema (ADR 0016).

**Not now.** A mark per Agent in the bar (it does not stay readable past
a few); counts of one Space only; the counts as a widget of the system
ADR 0024's widgets will have. When that system comes, these counts become
its first widget in the middle, and `[bar]` stays where it is.
_ADR 0043, step 2, made them the widget `sidebar.counts`, the look's
`[bar] center` by default._

## Consequences

- ADR 0024's "the middle stays empty" holds for everything but these
  counts.
- The bar takes what goes in its middle from the window, so the counts
  are the window's, beside the sidebar, and the bar knows nothing of
  Threads.
- `Status` of a sidebar row is drawn from a listed thing alone, so the
  list in the bar draws the same words.

## Build order

1. The counts, the list, `[bar]` with its defaults (this ADR, all of it).
