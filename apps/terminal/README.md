# Terminal

The terminal App: a program on a PTY in the engine, drawn by Ghostty in
its Pane. [The architecture](../../docs/architecture.md#terminal) is the
map this page is one part of. A change to this App changes this page in
the same PR.

## What it does

- **A Terminal is a program on a PTY** in the engine, run as the Person:
  their shell in the Project's folder, or a program with its arguments,
  never a shell line, such as a Harness's sign-in. It starts in the
  Project's environment (ADR 0084), as does every server run in it. It
  needs the Run right, and it belongs to its Project. The window chooses
  its ID, so a Pane names its terminal before the engine answers
  (`terminal.open`). Opening one whose program ended runs the program
  again.
- **What it printed stays in memory**, the newest 2 MB, never in the log: a
  screen repaints megabytes, and the program ends with the engine anyway.
  The bytes become text as they come, a character split between reads
  whole.
- **A window watches it through a stream** (`terminal.watch`): the screen
  so far first, then what it prints and the size a window gives it, then
  how it ended. Every window that opens it sees the same screen, and a
  window that falls behind gets the whole screen again.
- **A window back after a reconnect goes on from what it drew**
  (`terminal.watch {after}`, #1236; ADR 0106, law 4). The screen and each
  piece of output say how much of the terminal's output they reach
  (`Drawn`: the history's run, and a count of its pieces). The contract's
  session asks a stream again with what its caller says then
  (`Engine.stream`, its params as a function), so the Pane asks with what
  it drew by then. The terminal answers `resumed`: what the window
  missed, which may be nothing, and its size and its end, with no screen
  again. What it missed is old, so the Pane types none of the screen's
  answers to it, as for a snapshot. A place the history no longer keeps,
  one it never reached, or another run's (a terminal opened again under
  its ID) gets the whole screen as before, and so does a window of an
  engine older than this.
- **Typing waits at most 5 seconds** for a program that does not read.
- **A close stops what the program started too.** The program leads a
  session and a process group of its own. While it runs, a close sends the
  group a hangup and a request to stop, then a kill a second later; a
  shell passes the hangup on to its jobs. A close ends every watch.
- **It says how many of a Project's terminals run a program in front**
  (`terminal.running`), and again as that changes: one the shell put in
  front, as `vim` or `cargo build`, or the program a terminal was opened
  with, until it ends. A shell that waits for what is typed runs none.
  The count comes from the looks that name a shell's header, so it costs
  no polling of its own. It is there so a machine's update can wait while
  one runs, as it waits for a Turn (ADR 0106, decision 4).
- Its methods are the `methods!` table in `apps/terminal/engine/src/lib.rs`.
- **Its Pane** (`apps/terminal/pane`) draws a terminal with Ghostty:
  T3 Code's adapter over `libghostty-vt` compiled to WebAssembly,
  vendored in `client/ghostty`, on a canvas in the window's colours.
  - Opened from the menu, it starts the Person's shell, and starts it
    again when its engine lost it and has not restarted since. Under a
    new boot of the engine it says Ended and waits for "New shell here"
    (ADR 0106, decision 4).
  - Closed, it stops its shell (`PaneKind.closed`). Closed while its
    machine is away, it says "Closes on arc once it is back": the close
    waits on this device (`client/core/src/left.ts`), beside the messages
    that wait, counted in the pill's "· N waiting", across a restart of
    the window, for 7 days. Once arc's engine is open again under the boot
    the shell ran under, the main window lets go of it there before
    anything new goes; under another boot it is dropped, as the shell
    ended with it.
  - Another Pane that started a program opens it on that terminal, as a
    sign-in does: `{kind: "terminal.terminal", args: {terminal, title,
    shell: false, done}}`. `done` is a list of commands the Pane sends
    once the program ended with code 0, in order, each only once the one
    before went through, as `a && b` does. Each says where it runs: a
    Project, or with none, the machine (ADR 0040, decision 5). Its ID keeps
    each once only. Then the Pane closes.
  - It sends what the Person types one call after another, as the engine
    runs calls side by side.
  - Closing the Pane closes its terminal. Moving it to another column or
    workspace draws it again and does not.
