---
name: apps
description: Read before you write or change a Banda App, a Pane, a bar Widget or a platform part - the rules on borders, Here, data, design, motion, devices and trust, with a checklist.
---

<!--
A draft. It becomes the Banda skill's topic `apps` (`sdk/skill/apps.md`)
once an App from elsewhere can be installed (V4): every `skill/*.md` next
to a part of Banda ships to every Person's Agents
(`platform/skill/build.rs:1-3`), so it waits until the rules can serve
them. It follows `docs/sdk/guidelines.md`; a change to a rule changes both
in one PR.
-->

# Writing an App for Banda

These are the rules of `docs/sdk/guidelines.md`, one line each, with
their ids; that page has the reasons and the code they cite. They come
with ADR 0087, ADR 0088 and ADR 0089. Name a rule by its id in a review,
a test or an allowlist line.

A rule binds new code now, unless it says *after* a step; until that step
lands, do what the guidelines' *Until* says. Today's cases are counted and
only fall.

## The shape

The **Window** is Banda's program on one screen: it holds the Bar, the
Sidebar and the Top layer, keeps **Here** (where the Person is) and
routes the keys. The **Tiling** holds the Panes in the middle. An App
gives Actions, Panes, Widgets and Items.

The parts talk through five channels, and no sixth:

- **Here**, read-only, by selector (`useHere`; at V2, a Tree Widget's
  declared args).
- **Data**, from your host by query and follow.
- **Acts**: a command to your host part; an action by id, your own or
  the Window's, the Tiling's or a platform part's; another App only by an
  intent.
- **Slots**: Items you put in another App's thing.
- **Facts**, between host parts.

Nothing an App gives talks to anything else directly.

## Borders

- `borders.1` Your code runs on your host; client React only for
  first-party live components, each Pane or Widget written so marked
  `[unstable] client-pane` or `client-widget` (the marks after an engine
  step, #1001).
- `borders.2` Write only your own tables; read no other App's.
- `borders.3` Reach another App only by its published facts (`listens`),
  published queries (`calls`) and intents (after B8); never by a method
  string, never by running its action by id, never by opening its Pane
  kind with its private args.
- `borders.4` Import no other App and none of its contract types; take
  the client core only as `@banda/core/react`.
- `borders.5` The kernel, the platform, the Window and the Tiling name no
  App.
- `borders.6` Keep no `WindowApi` in a module variable, no module global
  as a channel, no privileged props.
- `borders.7` Work in one Project; only the platform spans Projects.
- `borders.8` Never place or move Panes; ask `show.*@1` (after B8).
- `borders.9` No client `start()` daemon; background work is a host
  listener.
- `borders.10` Every exception is an `[unstable]` mark or an allowlist
  line with the rule id; the counts only fall.
- `borders.11` A platform part keeps the same rules and stays generic
  over `item@1`, `call@1` and Address.

## What you give

- `give.1` Every verb is an Action: an id and a JSON Schema of its args.
  Every Widget's click and every way to open a Pane names one.
- `give.2` A Pane names its Project and subject, looks the same on every
  client, never reads Here to draw, and has its header as data.
- `give.3` A Widget says something without a click, draws nothing while
  idle, runs actions through `useRun()`, is marked `compact` only if it
  fits a phone's header, and stands where the Person's `[bar]` puts it.
- `give.4` To be listed or to call the Person, publish `item@1` or
  `call@1` with the change behind it (after B7).
- `give.5` To add to another App's thing, put an Item in its Slot (after
  B4i).
- `give.6` A verb on your own Items is an item action.
- `give.7` A dialog or picker is part of the view that opens it.

## Here

- `here.1` Context comes only from Here and your own args.
- `here.2` Read only the fields you need, by selector:
  `useHere((h) => h.project)`.
- `here.3` Here is read-only; change it by an action.
- `here.4` Here reaches a host only as args.
- `here.5` A Pane never reads Here to draw; an act gets Here at its
  gesture, `window.here.get()` as it runs.
- `here.6` Don't work out sight or visibility yourself.

Here holds `front`, `sidebar`, `workspace`, `pane` (`{id, project,
subject?}`) and `project`. It has no Pane kind and no device form: branch
on neither. A Widget reads it with `useHere` from `@banda/core/react`; an
act reads `window.here.get()` as it runs.

## Data

- `data.1` Data comes only from a host: query, follow, stream.
- `data.2` A write is a command, pending until its receipt's `at`.
- `data.3` Publish facts as `<app>.<noun>.<past-verb>@<major>`, naming
  things by Address.
- `data.4` The client never touches a host's disk; bytes by signed URL.
- `data.5` The Person's data lives on the home host; device storage holds
  only conveniences (after E8).
- `data.6` Read and write only your own settings files, through
  `settings.set`.
- `data.7` A view is pure: a tree of at most 30 KB, at most 5 ms at p95.
- `data.8` Show staleness as "as of".

## Design

- `design.1` Draw only with the catalogue.
- `design.2` No colours or functions in a Tree's props.
- `design.3` Colour means state, one meaning per colour.
- `design.4` Tokens only, never colour literals.
- `design.5` The Bar draws text and small icons, quietly.
- `design.6` Banda draws the Pane header from your manifest.
- `design.7` Menus are Banda's, each row an action with its key.
- `design.8` is a rule of Banda's own repository; for your App, show
  your Person a visible change before you make it.

## Motion

- `motion.1` Animate only `transform`, `translate`, `scale`, `opacity`.
- `motion.2` Never read layout in a tick that writes it.
- `motion.3` No animation-frame loop of your own; use the shared clock.
- `motion.4` Obey your Tile's Configure (`useTile`, `tileOf`): hidden
  draws nothing, moving measures and resizes nothing, what you draw takes
  the Configure's size and scale, one fit per settled size (after P7).
- `motion.5` No animation values in React state; select, memoise, act by
  action id.
- `motion.6` Work over 4 ms off the main thread; long lists windowed.
- `motion.7` Motion from the look's springs; honour reduced motion.
- `motion.8` is a rule of Banda's own repository.

## Devices

- `device.1` Declare device needs from the closed list, with a fallback
  (after E3).
- `device.2` No `window.banda`, Electron or `node:*` in view code.
- `device.3` Every action has a path without a key and without hover.
- `device.4` Sizes in rem; touch targets at least 44 px on a phone.
- `device.5` Never branch on the device.

## Trust

- `trust.1` Declare the fewest capabilities.
- `trust.2` Only a gesture on the Person's device acts as the Person.
- `trust.3` An action that sends words to an Agent, or runs or opens
  something outside Banda, is `runsAsPerson`.
- `trust.4` A device request that opens, runs or reads needs a gesture
  there.
- `trust.5` No secrets in logs, facts, Trees, args, Problems, toasts,
  URLs or recordings.
- `trust.6` HTML you did not write runs only in a Frame.
- `trust.7` Banda's own reads of a Project never run its content.
- `trust.8` Never touch credentials, a Harness's configuration or
  Banda's data folder; never write a `keys.toml` line that acts as the
  Person.

## Words

- `words.1` An App id is one lowercase word that prefixes everything; an
  id a Person already binds keeps its name when its owner changes.
- `words.2` `window.`, `tiling.`, `banda.` and platform ids are reserved.
- `words.3` Titles say what happens, in sentence case.
- `words.4` Say Window, Here, Top layer, Pane, Tile, Widget, Item, Slot,
  Action, Tiling. Avoid shell, Overlay, Focus (for Here), Desk, Surface,
  Panel, plugin.

## Checklist

- [ ] Every verb is an Action with an args schema.
- [ ] Panes name their Project and subject; Widgets are quiet and read
      Here by selector.
- [ ] Listed things and calls go out as `item@1` and `call@1`.
- [ ] No other App's id in my strings or imports; I run by id only my
      own actions and the platform's.
- [ ] No module-level state about the Window.
- [ ] Data from my host; writes as commands; no paths on the client.
- [ ] Catalogue and tokens only.
- [ ] No loop of my own; nothing drawn while hidden.
- [ ] No `window.banda`; device needs declared.
- [ ] Fewest capabilities; no secrets anywhere.
- [ ] Every exception is a mark or an allowlist line with its reason.
