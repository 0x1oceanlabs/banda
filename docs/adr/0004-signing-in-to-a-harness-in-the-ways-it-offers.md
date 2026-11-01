---
status: accepted
date: 2026-11-01
---

# Signing in to a Harness in the ways it offers

This ADR changes ADR 0003, decision 4. Claude took it on 2026-11-01 while
building step 6 of that ADR, under Roma's instruction to finish the
integration as in T3 Code. Roma can reverse it. The evidence is in
[the terminal and sign-in note](../research/2026-11-01-terminal-and-sign-in.md).

**Context.** ADR 0003 has the Thread open a terminal Pane with
`claude auth login` or `codex login`. Two facts came later:

- ACP lets a Harness say how it signs in: its auth methods.
  - Claude Code's adapter offers ways in a terminal to a client that
    declares it runs terminals. Each way is the adapter's own program with
    arguments of its own.
  - Codex's adapter offers no way in a terminal. When asked
    (`authenticate`), it signs in by itself in the browser and keeps the
    tokens.
  - T3 Code's ACP route reads the same methods.
- Running T3 Code's prebuilt Ghostty WASM in a window awaits Roma's
  decision, so the terminal Pane is not there yet.

**Decision.**

1. **The Thread offers the ways the Harness declares.**
   - The engine declares that it runs terminals.
   - A way in a terminal is the Harness entry's own program. The way's
     arguments go after the entry's, and the way's environment goes over
     the entry's, so an entry's own config folder gets the account.
   - A way the Harness does by itself is a button: the engine asks the
     Harness to sign in (`agents.sign_in`).

2. **Until the terminal Pane is there, a way in a terminal is a line to
   run.**
   - The Thread shows the line, with Copy.
   - The Person runs it in a terminal of their own, then says they signed
     in.
   - Once the Pane is there, it runs the line in place. The program
     ending with code 0 then says it instead of the Person.

3. **After a sign-in, the engine lets go of every process of that Harness
   entry**, in every Space, as ACP has a client start the Harness again.
   - Each process reads the account when it next starts.
   - A turn that runs keeps its process until it ends.
   - The failed turn goes again (`agents.retry`).

4. **A sign-in writes nothing to the Space.**
   - The account belongs to the Harness on this computer, not to the
     Space's work.
   - The command asks the Harness during the call, and its receipt keeps
     the answer, so the same command sent again does not sign in again.
   - It skips the outbox: a sign-in waits on a Person, and a retry after a
     restart would open a browser that nobody asked for.

5. **The rest of ADR 0003, decision 4, stands.**
   - Tokens never pass through Bandaso.
   - Bandaso reads none of the Harness's credential files.
   - A second account is a second entry, with its own config folder.

**Consequences.**

- A Harness that declares no way to sign in gets the advice "Sign in from a
  terminal, then try again."
- Asking for the ways (`agents.account`) starts the Harness's process in
  the Space. That is the process its next turn uses.
