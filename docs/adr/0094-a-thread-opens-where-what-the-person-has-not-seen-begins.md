---
status: accepted
date: 2026-11-08
---

# A Thread opens where what the Person has not seen begins

_It amends ADR 0010, decision 8 (scrolling as in T3 Code). Code is cited
from main at `b36fc6ea` and after #786._

Roma, on 2026-11-08 (translated), after two scrolling bugs: "when a reply
comes, the Thread scrolls to its end, but the scroll icon does not go away
and the arrow stays", and then: "let's think about how it should work: a
UX that is clear to the Person and causes no frustration". He took the
three rules below as they were put to him: "the 3 rules are good, I
propose them as an ADR".

**Where it stands.**

- The Thread's timeline is `@shadcn/react`'s message scroller
  (`apps/agents/pane/src/thread/Transcript.tsx`,
  `client/ui/src/components/message-scroller.tsx`). A Person's message is
  its scroll anchor: it moves near the top, and the reply grows below it.
  Once the reply fills the screen, the scroller follows the end.
- Twice what the Person saw rested on the scroller's own guesses, not on a
  rule of ours:
  - It took a message as new only past the list's old length, and on an
    equal length it took the first anchor it had not handled. A reply that
    took its draft's place threw the Thread back to its first message.
    #786 patches the scroller (`client/ui/patches/`); upstream has the bug
    open (shadcn-ui/ui#11128, #11181); #795 tracks the patch.
  - It finds the end by its rows' boxes. A message's row reaches 24 px
    past the content to give its actions room (`-mb-6 pb-6`), so at the
    very end the button to the end stayed on (#809).
- A reply that came while the Thread was out of sight (its Tile on
  another workspace, `inert`, its view held) lands in one jump on return.
  The scroller turns to following the end only when its tail spacer drops
  from more than 0 to 0 while the reply grows, so the Thread stays on the
  sent message, and it does so by chance. In the probe of 2026-11-08 it
  stood 1,222 px short of the end.
- `ScrollPlace` keeps the message at the top of a Thread the Person
  scrolled up in, and takes them back there when the Thread opens again in
  its Pane (ADR 0010, decision 8); a Thread left at its end opens at its
  end.
- How ChatGPT and Claude place a conversation the Person comes back to is
  not written anywhere we found. While a reply streams they keep the
  prompt near the top and follow the end only while the reader is at it,
  as the scroller does.

## Decisions

The rule over all three: **a Thread shows where what the Person has not
seen begins, and never moves what they are reading.** What the Person has
seen is what was on screen in a Tile that showed (not `inert`, not on
another workspace, not beside the screen). A window in the background
still counts as seen, for now (see "Open").

1. **Watching, it follows.** While the Thread is on screen, the message
   the Person sends moves near the top and the reply grows below it. Once
   the reply fills the screen, the Thread follows its end: the Person reads
   it as it comes, so what they have not seen is always at the end. This
   is how it works now; a window test guards it ("a sent message moves
   near the top, the end says what waits, and a Thread keeps its place").

2. **Scrolled up by hand, nothing moves.** Once the Person scrolls up,
   nothing moves the Thread until they come back to the end, whatever
   comes in: replies, a Question, a draft that becomes an item. The button
   to the end shows while there is more below and goes away at the very
   end. A window test guards it ("scrolled up and back down by hand, the
   Thread's button to the end goes away", #809).

3. **Back from away, it opens at the start of what came.** When the
   Thread comes on screen again and something came while it was away, it
   shows the first line that came near the top. The line before it peeks
   above, as the scroller's anchor does. What came is read from the top
   down, as a letter is. When all that came fits below the place the
   Person left, it all shows and nothing jumps. The Thread does not open at
   the last line, as if the Person had watched it come. A long reply's end
   (a summary, the last tool calls) means little without its start, and
   the Person would have to find the start by hand.
   - "Away" is any time the Thread was not seen (above): its Tile on
     another workspace, beside the screen, in an Overlay that covers it, or
     another Thread open in its Pane (`ScrollPlace`'s case).
   - A Person who left while scrolled up comes back to their place, as
     `ScrollPlace` does now. Rule 2 wins over rule 3.

4. **The button to the end says that something new is below.** When the
   Thread opens by rule 3 and there is more below, the button says so,
   next to what it says already ("2 queued", "waiting for you"; ADR 0010,
   decision 8). The Person then knows the reply goes on below and has not
   stopped. Its words and look are a visible step: a mockup goes to Roma
   first.

5. **The rules are ours, and tests hold them.** The Thread places itself
   by these rules in its own code (`Transcript.tsx`, `ScrollPlace.tsx`),
   not by what the scroller happens to do. Each rule has a window test that
   runs under load, so a bump of `@shadcn/react` that changes its guesses
   fails a test, not the Person. The patch from #786 goes once upstream
   fixes shadcn-ui/ui#11128 (#795).

## Steps

1. Rules 1 and 2: done (#786, #809), each with its window test.
2. Rule 3: the Thread notes the last line it showed as it goes out of
   sight, and on its return places the first line after it near the top.
   A window test covers each kind of away: another workspace, beside the
   screen, another Thread in the Pane. One PR.
3. Rule 4: a mockup of the button for Roma, then the PR.

## Open

- **A window in the background.** The Person may be in another program
  while the window shows the Thread. Rule 1 counts that as seen. If it
  turns out to frustrate, the window's focus can join "seen" later.
- **A long run of an Agent.** A turn of many tool calls is long to read
  from the top. A way to jump from the button straight to the reply's last
  message may come later, once rule 3 is lived with.
