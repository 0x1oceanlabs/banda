---
status: accepted
date: 2026-11-04
---

# The terminal has its own file, and writes in JetBrains Mono off Linux

The terminal is T3 Code's adapter over Ghostty's `libghostty-vt`, drawn on a canvas (`app/ghostty`). Its font is the look's `[font] mono`, `monospace` by default, which `banda look` asks fontconfig for (ADR 0007, decision 6). On 2026-11-04 Roma asked for a terminal "without glitches, with fonts that work well on Linux and on the Mac", and for its own settings file, "so that people can edit everything with Agents".

What was wrong:

- On a Mac the generic `monospace` becomes Andale Mono, when Homebrew happened to bring fontconfig (#438), or Chromium's own fixed font. Neither is a terminal font.
- On Linux at a screen scale such as 1.6 a cursor left lines behind: rows sat between screen pixels. PR #452 fixes it.
- Box-drawing and block glyphs (`│ ─ ┌ █ ▀ ▄`) come from the font, so at a row height of 1.35 the lines of a TUI, such as Claude Code's and Codex's frames, break between rows.
- A cell is as wide as the font's `M`, 7.2 px at 12 px, so the backgrounds of cells side by side meet on half a pixel, and leave a seam.

**Decision.**

1. **On Linux the terminal writes in the system's monospace; on macOS and Windows in JetBrains Mono, which Banda ships.**
   - On Linux people choose their terminal's font on purpose, so the generic `monospace` stays fontconfig's, as ADR 0007 has it: Omarchy's font on Omarchy.
   - Only Linux asks fontconfig. On macOS and Windows `monospace` is JetBrains Mono, so a fontconfig Homebrew brought changes nothing (#438).
   - Banda ships JetBrains Mono as Inter is shipped: variable, roman and italic, Latin and Cyrillic, OFL 1.1, from `@fontsource-variable`, under its name there, `JetBrains Mono Variable`, as Inter's is `Inter Variable`. It is there on every system, so `mono = "JetBrains Mono Variable"` names it on Linux too, and it is what `monospace` becomes wherever fontconfig answers nothing.
   - The plain font, not a Nerd Font's patched one: the patched one is several times the size and changes the metrics, and its Mono cut draws icons small. Icons come from Symbols Nerd Font Mono, which the adapter already ships as a fallback, as Ghostty and WezTerm do.
   - The code in a Thread and in a diff writes in the same `[font] mono`, so it follows.
   - The interface stays in Inter, shipped already (`sans = "Inter Variable"`).

2. **`~/.config/banda/terminal.toml` holds the terminal's settings.** The terminal module owns it, as the browser owns `browser.toml` (ADR 0016): a template with every default written out and commented, a schema, `banda settings check`, a section in Settings drawn from the schema, and `banda look` carries it as `files["terminal.toml"]`. A Person, or an Agent asked to, edits the file.

   ```toml
   #:schema ./schemas/terminal.schema.json
   # How Banda's terminal writes. Every key is optional.

   # The font: a font's name or a CSS list. Left out, the look's
   # [font] mono: on Linux the system's monospace, on macOS and
   # Windows JetBrains Mono. Missing icons come from Symbols Nerd Font.
   # font = "JetBrains Mono Variable"

   # The text's size, in pixels. Left out, three quarters of the
   # look's [font] size: 12 at 14.
   # size = 12

   # Whether -> => != and the like are drawn as one sign, as the font
   # draws them; each still takes its cells.
   # ligatures = true

   [cursor]
   # "block", "bar" or "underline", until a program asks for another.
   # style = "block"
   # Whether it blinks, until a program says.
   # blink = true
   ```

   - Ligatures are on, as in Ghostty.
   - These keys first. Scrollback, line height, copy on select and the shell wait until someone asks for them.

3. **The terminal draws box-drawing, block and braille glyphs itself, and a cell is whole screen pixels wide and tall.**
   - Lines, corners, blocks, shades and braille (U+2500–U+259F, U+2800–U+28FF), with the powerline triangles the adapter already draws, are filled from the cell's own edges, as Ghostty, Kitty and WezTerm do. A frame then joins across rows and columns in any font.
   - The cell's width is rounded to screen pixels too, as its height is since #452, and the text is spread to it by the canvas's letter spacing, so a line of text keeps to its cells.
   - Each is a `Banda:` change in the vendored adapter, noted in its README, until T3 Code has its own.

**Consequences.**

- ADR 0007, decision 6, `[font]`: a generic name is the system's choice on Linux only. The look's table gains `terminal.toml` beside `browser.toml`.
- `modules/terminal/module.toml` names `settings = ["terminal.toml"]`.
- The window ships one more font, about 200 KB.
- The adapter gains T3 Code's newer commits since its pin, starting with `d1049c44` (snapshot memory views), as its own PR.

## Steps

Each step is its own PR.

1. The cursor's lines at a fractional scale (#452).
2. This ADR.
3. JetBrains Mono shipped, and fontconfig asked on Linux only (closes #438).
4. `terminal.toml`: the template, the schema, `banda look`, the Settings section, and the Pane reading it: font, size, ligatures, cursor.
5. Box-drawing, block and braille glyphs drawn, and whole-pixel cell width. A before and after of Claude Code, htop and lazygit, shown to Roma first.
6. The adapter brought up to T3 Code's newest.
