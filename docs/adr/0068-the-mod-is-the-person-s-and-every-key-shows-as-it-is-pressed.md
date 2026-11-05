---
status: accepted
date: 2026-11-05
---

# The mod is the Person's, and every key shows as it is pressed

ADR 0005, decision 10, made Alt Banda's mod: every Banda key holds it,
and so do the mouse's moves (ADR 0025, decision 5; ADR 0064). It also
said that on a Mac the mod is Cmd; the window never did that, and holds
Option there too. `keys.toml` (decision 11) binds one key at a time, but
Alt itself cannot change. It is in every default, written `alt: true`
some 45 times in the actions and the Apps' manifests; in the mouse's
`event.altKey`; in what a browser's page and a Visual give the window;
and in the hand-on of a key to a terminal's program.

How a key is shown is spread out too. The key sheet and the Pane menu
name keys from the keys in force, but write `Alt+R` on a Mac, where the
key says ⌥. Eleven strings write the key into their text: tooltips
(`Close (Alt+W)`, `Sidebar (Alt+A)`, `Overview (Alt+O)` …), a row of the
sidebar's menu and a Problem. They keep it after `keys.toml` moves the
action to another key.

Roma, on 2026-11-05: a Person's Option is the system's, bound for
tiling windows, so Banda's keys never reach the window; Banda needs
another mod, and every other key should stay as it is. And the menus
must show the keys as they are pressed, not `Mod+1`, as that is where
the Person learns them. AeroSpace, on a Mac, holds ⌥ and ⌥⇧; i3 and sway
often hold Alt; Rectangle holds ⌃⌥ with the arrows; GNOME often holds
Ctrl+Alt with the arrows. So no one other key fits everyone. Roma tried a
mock (`artifacts/mod-key/mod-key-v1.html` in the brand workspace) of the
choice, the keys as they read and what each desktop takes, and took the
proposals as they are: Alt stays the default on a Mac too, and ⌘ alone
is refused.

## Decision

1. **The mod is a line of `keys.toml`: `mod = "Alt"`.**
   - It is one or two of Alt, Ctrl and Super. On a Mac, Alt is ⌥ and
     Super is ⌘. Alt is Banda's own, on every system, as the window
     holds it today.
   - Refused, at its line, as the look's Problems are: Shift, which is
     Banda's second level; all three, which leave no third level; Ctrl
     alone, whose keys are the terminal's and the fields' (`Ctrl+C`,
     `Ctrl+W`, `Ctrl+R`); ⌘ alone on a Mac (`⌘C`, `⌘V`, `⌘W`, `⌘Q`).
   - Super alone on Linux is taken, with a word that most desktops hold
     it.
   - Settings › Keys shows it first, as the main key: Alt, Ctrl+Alt,
     Alt+Super, or one of the Person's own. Under it, Banda's keys as
     they read with it.

2. **Banda's keys come in three levels, and they move with the mod.**
   - The mod; the mod and Shift; the mod and one more, the first of
     Ctrl, Super and Alt that the mod does not hold:

     | mod | the mod | and Shift | and one more |
     |---|---|---|---|
     | Alt | `Alt+R` | `Alt+Shift+R` | `Ctrl+Alt+→` |
     | Ctrl+Alt | `Ctrl+Alt+R` | `Ctrl+Alt+Shift+R` | `Ctrl+Alt+Super+→` |
     | Alt+Super | `Alt+Super+R` | `Alt+Super+Shift+R` | `Ctrl+Alt+Super+→` |

   - A key in the code says its level, not its modifiers:
     `{ code: "KeyR", mod: true }`, `{ code: "ArrowRight", mod: true,
     more: true }`. So does an App's key in its manifest. A key written
     with plain modifiers, as the browser's `Ctrl+T`, stays as written.
   - The window makes the keys real once, when it reads them: Banda's
     with the mod, then the Person's lines over them. Two actions on one
     key is a Problem at the `mod` line, and the first in the key sheet
     keeps the key.
   - Banda cannot see what the desktop holds. The key sheet is where the
     Person finds out: a key the desktop took runs nothing.

3. **What Alt did, the mod does.**
   - The mouse: move a Pane, size it, drag the view, move the bar's
     widgets (ADR 0025, decision 5; ADR 0064). The page's root says
     `data-mod` while the mod is held, for a browser's page to let the
     mouse through.
   - A browser's page and a Visual give the window every key with the
     mod, as they gave it the Alt keys (ADR 0013, decision 5). Main
     reads the mod from the look.
   - A terminal's program: one more and a Banda key hands the program
     that key without the one more (ADR 0005, decision 10). With Alt,
     `Ctrl+Alt+W` gives the shell `Alt+W`, as now; with Ctrl+Alt,
     `Ctrl+Alt+Super+W` gives it `Ctrl+Alt+W`. A key of that level that
     Banda binds itself stays Banda's. With a mod that does not hold
     Alt, the program has every Alt key already.
   - A key matches the modifiers held, exactly. Banda's `ctrl` is Ctrl,
     not ⌘, and on Linux Super is never Ctrl. "Ctrl, or ⌘ on a Mac"
     stays for an App's own keys that are written so, as the browser's.

4. **Every key shows as it is pressed; "Mod" is never written to the
   Person.**
   - One function names a key from its real modifiers. On Linux and
     Windows: `Ctrl+Alt+Super+Shift+R`, in that order. On a Mac:
     `⌃⌥⇧⌘R`, in Apple's order, with ← → ↑ ↓ and ↩.
   - Tooltips, the bar, the sidebar, the Pane menu, the Banda menu and
     its key sheet, Settings and the Problems name a key by its action's
     id, from the keys in force; none writes a key into its text. A test
     fails on `Alt+` in the window's strings.
   - An action with no key shows none.

5. **`keys.toml` holds keys as they are pressed too.**
   - `[binds]` lines name real keys: `"Ctrl+Alt+M" = "column.maximize"`.
     The file has no `Mod+`.
   - Changing the mod in Settings rewrites the Person's lines that hold
     the old one, after showing them. A key to an action moves to the
     new mod. A `none` that freed a key of the old mod for a Pane goes,
     as that key is no longer Banda's. "Keep as they are" leaves them.
   - The mod changed by hand: the window names each line that still
     holds the old one, as a Problem at its line.

6. **`Ctrl+Alt+Shift+K` stays no file's, whatever the mod** (ADR 0005,
   decision 11). It brings back Alt and Banda's own keys until
   `keys.toml` changes, so a mod the desktop takes can always be mended.
   With the mod Ctrl+Alt it is the mod, Shift and K, and no action has
   that key.

## Consequences

- ADR 0005, decision 10: Alt is Banda's mod until the Person picks
  another. "On a Mac the mod is Cmd" goes, as ⌘ alone is refused. The
  window never told left Alt from right; this ADR leaves that as it is.
  Decision 11: `keys.toml` holds `mod`.
- ADR 0025, decision 5, and ADR 0064: the mouse holds the mod.
- ADR 0013, decision 5: a page gives the window the keys with the mod.
- ADR 0017, decision 9: the key sheet names keys as decision 4 says.
- `GLOSSARY.md`: Mod.
- Built in five PRs:
  1. One name for a key, `⌃⌥⇧⌘` on a Mac; the eleven strings by action
     id; the test against `Alt+` in the window's strings. It needs
     nothing else, and fixes the strings `keys.toml` leaves behind.
  2. `mod` in `look/src/keys.rs` and the contract, with its Problems.
  3. Levels in the code and the manifests; the keys made real, with the
     clashes; exact modifiers.
  4. The mouse, the pages, the Visuals and the hand-on hold the mod. An
     end-to-end test: with `mod = "Ctrl+Alt"`, `Ctrl+Alt+R` steps the
     column's width and `Alt+R` reaches the shell.
  5. Settings › Keys: the mod, the keys as they read, the lines moved.
