---
status: accepted
date: 2026-11-05
---

# A Project has a sign, found in its folder or picked by hand

ADR 0069 left a Project's icon for later: "found by itself, from the
Project's favicon or logo, and picked by hand", after a mock. Today a
Project shows a badge (`app/ui/src/components/space-badge.tsx`): two
letters on one of six hues, chosen by its id. It stands in the bar for a
Project's workspace, in a sidebar row of one line, in a Project's section
header and in the Banda menu. Two faults are plain:

- **Two letters collide.** `banda` and `bandad` are both "BA". In the bar,
  where the badge takes the workspace's number, the two are one.
- **The hues are the state's.** Four of the six (red, orange, green,
  blue) are close to what an Agent's mark says: failed, asks, done,
  works (ADR 0065, decision 6). A Project's badge reads as a Thread that
  calls.

The mock (`artifacts/project-icon/project-icon-v1.html` in the brand
workspace) set the current badge beside three looks: A "Tone", the
letters on a hue as now; B "Quiet", a neutral tile and colour only when
picked by hand; C "No tile". It set Inbox rows with the name alone or the
sign and the name, and the Pane header with and without the sign.

Roma, on 2026-11-05: "1 B, 2 знак + имя, 3 да добавляем знак, 4 да
хорошо". So B, the sign beside the name in Inbox rows, the sign in the
Pane header, and a dashed empty tile for No Project.

## Decision

Roma decided the points marked _decided_ on 2026-11-05. The rest are our
defaults and stay his to change.

1. **A Project's sign is one of four kinds**, and the word is **sign**
   (the GLOSSARY gets it).
   - **Picture**: an image file, PNG, SVG, WebP or ICO.
   - **Emoji**: one.
   - **Icon**: one of Lucide's, by its name, which the window already
     draws with.
   - **Letters**: one or two.
   - Icons and letters may take a colour (decision 4). A picture and an
     emoji keep their own.

2. **What the Person picked wins; otherwise Banda finds one; otherwise
   letters** (_decided_: found by itself and picked by hand).
   - Banda looks in the Project's folder, in this order, and takes the
     first it finds:
     1. a file named as the Project: `<name>.svg` or `<name>.png`, at most
        three folders down (Banda's own is `app/desktop/icons/banda.svg`);
     2. a site's favicon: `favicon.svg`, `favicon.png` or `favicon.ico` at
        the root, in `public/`, `static/` or `src/`, Next.js's
        `app/icon.*`, and in a monorepo `apps/*/public/`;
     3. a logo: `logo.svg` or `logo.png` at the root, in `assets/`,
        `docs/` or `.github/`;
     4. an app's icon: `build/icon.png`, `resources/icon.*`,
        `src-tauri/icons/icon.png`.
   - In each place SVG comes before PNG. A file the folder's `.gitignore`
     ignores, one under 16 px, and one over 256 KB are passed over.
     - _Changed on 2026-11-06, as it was built:_ no git is asked, so a
       search is a few `stat`s and a short walk, not a listing of the
       whole repository. The walk for a file named as the Project skips
       hidden folders, `node_modules`, `target`, `dist` and `build`,
       which is where ignored files mostly are; the fixed places are
       taken as they are. A new folder made for a Project is not looked
       in.
   - It looks when a Project is added, as the engine starts, and when the
     Person asks ("Look again"). Watching the file is later.
   - Letters, with nothing found: the first letter of the name, its
     domain's ending left off (`romaocean.com` is R). When another
     Project's sign is letters with the same first letter, both take two:
     the first and the last consonant that differs (`bandad` is BD).

3. **The engine keeps the sign, and the folder keeps nothing of
   Banda's** (ADR 0026).
   - `project.json` gets `sign`: absent for "found or letters", or what
     the Person picked: `{ "emoji": "⌨️" }`, `{ "icon": "pen", "color":
     "violet" }`, `{ "letters": "BD", "color": "teal" }` or
     `{ "picture": true }`.
   - A picture, picked or found, is copied into the Project's data as
     `sign.<ext>`, with where it was found beside it, so the folder may
     change or go and the sign stays.
   - `projects.update { sign }` sets it, and `null` goes back to found. A
     picked picture comes as the file's bytes, at most 256 KB.
     `projects.find_sign` looks again.
   - `ProjectSummary` carries the sign as the window draws it: its kind,
     its text or icon or colour, and for a picture a version that changes
     with the file. `projects.sign` gives the picture as a `data:` URL.
     The window keeps it by that version and draws it with `<img>`, so an
     SVG runs nothing. The page's CSP already allows `data:` images.

4. **Look B, "Quiet"** (_decided_).
   - Letters and an icon stand on a neutral tile, the text's own colour
     thinned (ADR 0036). Their colour shows only when the Person picked
     one.
   - The colours are a quiet palette that leaves out what the state says:
     neutral, violet, magenta, yellow, teal and sand. There is no blue,
     orange, green or red. The palette is the look's, so a theme may
     change it.
   - A picture and an emoji stand as they are, on the tile's shape.
   - The tile is a rounded square, about a quarter of its side, as the
     mock draws it.

5. **Where it shows.**
   - **The bar**: a Project's workspace shows its sign in place of the
     number, with the dot while one of its Threads calls (ADR 0065,
     decision 9). 16 px.
   - **The sidebar**: before the Project's name in a row's line of the
     Project (_decided_: the sign and the name, in Inbox too), and alone
     in a row of one line, both 14 px. Before the name in a Project's
     section header and in the list of Projects, 16 px.
   - **The Pane header**: before the Project's name where the header
     names it, `[sign] banda /` (_decided_). This adds to ADR 0066, which
     kept the Project in the header as it was. 14 px.
   - **The Banda menu and the New Thread picker**: before each Project's
     name. 16 px.
   - **The settings' Projects**: the sign at 40 px, where it came from
     ("Found in the folder, by the Project's name: `app/desktop/icons/
     banda.svg`", "Nothing found: letters from the name", "Picked by
     hand", with "Back to auto"), and the five ways: Auto, Letters, Emoji,
     Icon, Picture. Letters and Icon offer the palette.

6. **No Project's sign is a dashed empty tile** (_decided_). It has no
   kind and no setting. It stands wherever a Project's sign would.

## Consequences

- `space-badge.tsx` becomes `project-sign.tsx`, and every place that drew
  the badge draws the sign. The six hues by id go.
- The bar tells two Projects apart, and nothing a Project shows reads as
  a call.
- The engine reads a little of each folder as it starts: a few fixed
  paths, and a walk three folders deep for one name that skips what
  `.gitignore` ignores.
- A Project's sign is the engine's, so every window and client sees the
  same one.

## Steps

After ADR 0069's step 4, so the code says Project:

1. **This ADR**, and the GLOSSARY's sign.
2. **The engine**: `sign` in `project.json`, finding it, the copy,
   `projects.update { sign }`, `projects.find_sign`, `projects.sign`, and
   the sign in `ProjectSummary` (decisions 1–3).
3. **The window**: the sign in look B everywhere the badge was, and in
   the Inbox row's line and the Pane header, and No Project's tile
   (decisions 4–6).
4. **The settings**: the sign's field and its five ways (decision 5).
