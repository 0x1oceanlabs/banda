---
status: accepted
date: 2026-11-10
---

# Omarchy's installed Harnesses and Accounts are discovered

Roma asked that opening Banda on Omarchy show the installed Harnesses and
Accounts already configured there, without connecting each by hand. This
extends ADR 0003's two built-in Harnesses and ADR 0104's profile discovery.

## Decision

1. On Linux with `/usr/share/omarchy`, the engine supplements its Harness
   list with Omarchy's existing Claude Code and Codex Accounts. It reads
   only their display-safe registries under
   `$XDG_STATE_HOME/omarchy/agents/accounts` (by default `~/.local/state`).
   A folder is a candidate, not proof of sign-in; the Harness reports that.
2. The primary Account keeps the built-in Harness's ID. Additional IDs are
   `omarchy-<harness>-<account>`, stable across renames. Their display names
   come from Omarchy. Each process receives its own profile variable; no
   credential is copied and Omarchy's active Account is not changed or
   followed for a running Thread.
3. Installed OpenCode and Oh My Pi use their native `acp` commands. Pi is
   offered only when its `pi-acp` adapter is installed. A lazy mise shim is
   not an installed program. Discovery installs nothing and runs nothing.
   The registry supplies no programs, arguments or arbitrary environment.
4. Explicit entries in `harnesses.toml` win, including disabled entries,
   names and profiles. An existing Account using the same folder is not
   duplicated. `[omarchy] enabled = false` disables discovery. Discovery
   writes neither Banda's settings nor Omarchy's files. The first explicit
   edit materializes the discovered entry through the settings writer.
   Removing one records its ID in `[omarchy] excluded`, so it does not
   reappear; a subsequent explicit entry overrides that exclusion.
5. Account registries are read again when the list is requested. Removed
   Accounts stop being offered for new Threads; running processes retain
   their existing Account. Invalid metadata is ignored. Other operating
   systems keep the existing behaviour.

## Validation

Fixtures cover multiple Accounts, refresh and removal, disabled and manual
entries, invalid metadata and folders, native ACP programs and opt-out.
The trial window verifies the discovered choices using isolated settings.
