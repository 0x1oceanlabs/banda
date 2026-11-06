---
name: keys
description: Banda's keys, shortcuts and keybindings - bind, free or reset a key for the Person with the keys_* tools or `banda keys`, move the mod, and tell them what changed and how to undo it.
---

# Keys

Every key Banda or an App answers is an action's, and the Person's own
keys are lines of `keys.toml` over Banda's (ADR 0071). Change them with
the `keys_*` tools of `banda mcp`, or `banda keys` in a terminal: they
write the file as the Person's editor would, and refuse a line Banda
would not take, saying why.

Only the Person binds a key that acts as them, one that sends words to an
Agent or runs or opens something outside Banda, as `thread.new` with
`ask`: write no such line in `keys.toml`, by a tool, a command or an edit,
and give them the line instead (ADR 0083).

## When the Person asks for a key

"Put the column's full width on Alt+M", "a new terminal on
Ctrl+Alt+Return", "my Alt is AeroSpace's, move Banda to Ctrl+Alt":

1. Find the action by its title in `keys_list`; never guess an id.
2. Bind it with `keys_bind`: with the args it takes, and in its scope's
   table for an action of a scope (the topic `modules` lists each
   module's scopes). In a scope's table a key may be held with no mod;
   in a field's scope, as the composer's, not one the field would type.
3. Tell the Person what changed, as the tool said it, and that
   `keys_reset` with the same key undoes it. Ctrl+Alt+Shift+K brings
   Banda's own keys back until keys.toml changes.

When it refuses, say why, and offer what would work: the action's right
id, the args it takes, another key. When it refuses a key as only the
Person's to bind, give them the line, for them to add to `keys.toml`
themselves.

## A key the desktop may hold

Banda's keys hold the mod, Alt unless `keys.toml` moved it. A system's
tiling may take Alt or Super first (AeroSpace, i3, Hyprland, Rectangle),
and then the key never reaches Banda. When the Person names such a
desktop, or a key bound does nothing, say so, and offer another key or
the mod: `keys_mod` with `Ctrl+Alt` moves every Banda key, and the
Person's lines with it.
