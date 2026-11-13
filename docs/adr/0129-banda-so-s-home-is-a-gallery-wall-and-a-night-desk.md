---
status: accepted
date: 2026-11-13
---

# banda.so's home is a gallery wall and a night desk

ADR 0128 made banda.so a static Astro site and left its look to mocks.
Four directions were drawn on 2026-11-13. One came from a painting Roma
found in a museum, titled BANDA: a crowd of odd characters with big round
eyes, in flat colour with black outlines. Roma liked two of the
directions: "The gang", Banda's Agents painted as that crowd on a gallery
wall, and "The desk", a live Banda window on dark glass. The home page
joins them.

It serves "What Banda is not" in [what we build](../what-we-build.md), as
ADR 0128 does, and shows principle 1's three actors: the Person leads, and
the Agents work.

**Decision.**

1. **The home page goes from a light wall to a dark desk and back.**
   - The hero is a canvas on a gallery wall, with the Agents painted as a
     gang. Each one's shape is its state, as the Mark's is (ADR 0099).
   - Dark paint floods the wall. In the dark only the gang's eyes are left,
     then a glow in the painting's colours comes up. A live Banda window
     rises, tilted, and straightens as the page scrolls: the inbox, the
     Panes and the machines.
   - The page ends back on the wall, with the install and a green painted
     strip.
2. **The home page does not follow the system's theme,** which supersedes
   ADR 0128, decision 3 for it. The wall stays light and the desk stays
   dark, because the change from one to the other is the page's story.
   Other pages, when there are some, follow the system as ADR 0128 says.
3. **The painting's colours are the site's own palette,** in
   `site/src/styles/site.css`, beside Banda UI's tokens. Their meanings
   are the Mark's: orange asks, red failed, green done, yellow woke, blue
   works.
4. **The page ships no framework.** Small scripts move the eyes, the
   speech bubble, the dive and the window. The living Mark is
   `docs/design/kit/mark.js`. Reduced motion stills all of them.
