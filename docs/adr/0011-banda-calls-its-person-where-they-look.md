---
status: accepted
date: 2026-11-01
---

# Banda calls its Person where they look

A Thread that finishes, asks or fails calls its Person: its Mark changes (ADR 0005, decision 8) and a sound plays (ADR 0009). A Person who works in another window misses the Mark, and a sound alone does not say which Thread called or why. ADR 0005 (decision 8) planned a system notification for this, and ADR 0009 left it for later.

Every tool that runs Agents grows its own answer. Claude Code and Codex ring the terminal's bell or run a hook. Cursor and T3 Code send a desktop notification when their window is not in front. Slack and Linear add an inbox. Most of them say the same thing in two places at once, or keep saying it after the Person has seen it.

On 2026-11-01 Roma asked how system notifications and those in the window should work, "good UX is needed". He tried a prototype (`brand/session-08-notifications.html`) with the rules below and said: "a good default, every variant through the config file".

**Decision.** Roma decided the points marked _decided_. The rest are the defaults he asked for, and each one can be changed in the config file.

1. **Say it once, where the Person will notice it, and take it back once they have seen it.**
   - Where to say it depends on where the Person's attention is:

     | The Person                                    | Banda                                                  |
     | --------------------------------------------- | ------------------------------------------------------ |
     | looks at the Thread                           | nothing: they see it already, and it is seen           |
     | has the window in front, the Thread on screen | the sound; the Mark changes where it shows             |
     | has the window in front, the Thread elsewhere | the sound and a toast in the window                    |
     | has another window in front                   | the sound and a system notification                    |
     | has the desktop's Do Not Disturb on           | nothing but the Marks                                  |

   - "Looks at" means the Thread's Pane has the focus and the window is in front, as for the sound (ADR 0009, decision 3) and for "seen". A Thread whose Pane has the focus while the window is behind another one is not seen: it calls.
   - "On screen" means its Pane is on the current workspace. _Changed by ADR 0087, decision 9: it means at least half of its Tile shows inside the Strip's clip, so in Solo only the filled Group's Tiles do, as that Group takes the whole clip, and under a zoom only the zoomed Pane. A Pane in a window of its own counts as before. So an Agent that finishes scrolled out of view, or behind the Solo Group, gets its toast._
   - Nothing is said twice: a toast never repeats a system notification, and the sound plays once for both.

2. **A toast tells, the Mark remembers.**
   - A toast sits at the top right of the window, below the bar, where Omarchy shows its own notifications.
   - It goes away by itself: `done` after 5 s, `failed` after 8 s, `asking` after 12 s. The pointer over it holds it.
   - At most three show; more say how many more, and the sidebar lists them all. A Thread's new call replaces its toast.
   - Clicking it opens the Thread. There is no inbox: the sidebar already keeps the Threads that call at its top (ADR 0005, decision 8).

3. **A system notification tells the Person who is elsewhere.**
   - It is silent, since Banda plays its own sound (ADR 0009). Its icon is the Mark in its state.
   - It names the Thread and says what it said, as the sidebar's row does (ADR 0008): the Question, why the turn failed, or what the Thread was last asked to do.
   - A Thread's new call replaces its notification. More than two calls at once make one notification that names them all.
   - Clicking it brings the window to the front and opens the Thread; the summary opens the sidebar.
   - A `done` notification goes away by itself, as the desktop shows them. One that asks or failed stays until the Person sees the Thread. Every notification of a Thread goes away once the Person sees it in the window.
   - The window asks the desktop to mark it urgent, so the workspace that holds it lights up in the desktop's bar.

4. **The desktop's quiet is Banda's.** While Omarchy's Do Not Disturb is on (`omarchy-shell notifications isDnd`), Banda plays no sound and shows no notification. The Marks still change. A desktop with no such switch Banda can read is never quiet.

5. **`Alt+U` goes to the Thread that calls**, the loudest first, then the one that called first, as Hyprland's `focusurgentorlast` does.

6. **A module says what calls; the window says how.**
   - A module already reports, for each Space, the rows the sidebar lists (ADR 0008): each with its Mark, what it asks or why it failed, and the Pane a click opens. A row whose Mark is `done`, `asking` or `failed` calls. The module says nothing more.
   - The window compares each report with the one before: a thing that starts calling, or calls another way, is news, and one that stopped calling is taken back. A Watch reports first once it has read its list, and what calls then already was, so it is no news (ADR 0009, decision 3).
   - The window decides what to say and where, from where the Person looks. A Pane kind says which thing it shows, so the window knows when the Person sees it.
   - The desktop shows the system notifications and reads the desktop's quiet; the page only asks it to.

7. **Every variant through the config file: `[notify]` in `look.toml`** (_decided_: "every variant through the config file").
   - It sits beside `[sound]`, layered the same way (ADR 0009, decision 5): how Banda calls its Person is in one file.
   - The keys, with their defaults:

     ```toml
     [notify]
     system = "away"          # "away": when the window is not in front; "always"; or "off"
     window = "out-of-sight"  # toasts: "out-of-sight", "always", or "off"
     detail = true            # what the Thread said, in the words; false shows only its title
     quiet = "desktop"        # "desktop": silent while the desktop's Do Not Disturb is on; or "never"
     done = true              # which calls notify
     asking = true
     failed = true
     ```

**Consequences.**

- The agents module stops tracking which Thread its Person looks at: the window knows. A Thread Pane marks a Thread seen only while the window is in front.
- A Watch no longer calls the window: the rows it reports are the calls.
- The order of work, each step its own PR:
  1. **Calls the window understands, and toasts**, with `Alt+U`.
  2. **System notifications and the desktop's quiet.**
  3. **`[notify]` in `look.toml`.**
- Later: answering a Question from its notification, as with a permission's Allow and Deny.
