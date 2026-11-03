---
status: accepted
date: 2026-11-03
---

# The bar shows the servers started in Banda

ADR 0024, decision 5.3, planned `terminal.ports`: the ports that programs started in a Space's terminals listen on (`:5173`), "as Agents often start a dev server unseen". A click opens `http://localhost:<port>` in a browser Pane in that Space. Roma, on 2026-11-03, asked to build it after the bar's widgets (ADR 0043, step 2).

**An Agent's server is not a terminal's.** An Agent runs programs through its Harness, never in a terminal (`GLOSSARY.md`), so the dev server it starts is a child of the Harness's process. The terminal module's processes alone would miss the servers the widget is most for.

**What T3 Code does** (commit `c8a601c0`, `apps/server/src/preview/PortScanner.ts`, read on 2026-11-03):

- It lists the sockets that listen on a loopback or wildcard address: with `lsof -iTCP -sTCP:LISTEN -P -n -F pcn` on macOS and Linux, from `/proc/net/tcp` and `/proc/net/tcp6` and each process's `fd` on Linux without `lsof`, and with `netstat -ano` on Windows. IPv4 and IPv6 on one port are one server.
- **It shows only the servers it started.** A terminal's are its shell's descendants. An Agent's carry `T3CODE_THREAD_ID` in their environment, which the Harness's process was started with and every program it starts inherits. So a server stays known after the shell that started it exits, and another program's server on the machine is never listed.
- It never sends a request to a server it found, as HTTP bytes break servers that speak something else.
- It looks every 3 seconds while a window listens, and says only what changed.
- Its list has, for each server, `localhost:<port>`, "Agent" or "Terminal" and the program's name. A click opens it in its browser; ⌘-click or Ctrl-click in the Person's browser.
- "Stop server" sends SIGTERM to the server's process group, then SIGKILL after 3 seconds. It first looks again that the server is still its own, and never stops a group that holds T3 Code, an Agent's CLI or a terminal's shell.

Roma looked at a mock of the widget and its list on 2026-11-03, and decided: the servers started in Banda, as T3 Code finds them; the port's number on the bar; every Space's; and a Stop, as T3 Code's.

## Decision

1. **A server is a program started in Banda that listens on a loopback or wildcard address**: `127.0.0.1`, `::1`, `0.0.0.0` or `::`. One bound to another address is not shown, nor one Banda did not start.

2. **What Banda starts carries its Space.**
   - A terminal starts its program with `BANDA_SPACE=<Space ID>` and `BANDA_TERMINAL=<terminal ID>` in its environment.
   - A Harness's process for a Space starts with `BANDA_SPACE=<Space ID>` (ADR 0040: a Thread's hosts are keyed by Space and Harness). The Harness's own process for the machine carries none.
   - Every program they start inherits them: an Agent's `pnpm dev`, a shell's `vite &`. A server is a Space's when its process carries that Space's ID; a terminal's when it carries `BANDA_TERMINAL` too, and otherwise an Agent's.
   - A program that empties its environment, or a daemon that drops it, is not found. That is the price of never listing another program's server.

3. **The terminal module finds them.** It is the module of the programs on this computer in a Space.
   - On Linux, from `/proc`: the sockets in `LISTEN` in `/proc/net/tcp` and `/proc/net/tcp6`, the process that holds each through `/proc/<pid>/fd`, its environment in `/proc/<pid>/environ`, and its command line, named as a terminal's header names a program (`front.rs`: `pnpm dev`, not `node /usr/bin/pnpm dev`).
   - On macOS, from `lsof -iTCP -sTCP:LISTEN -P -n -F pcn`, and the environments from `ps -E -ww -o pid=,command= -p <pids>`.
   - Windows is not now, as the terminal module is not yet built there.
   - It looks every 3 seconds while a window listens, once for every Space, and says only what changed. It sends nothing to a server it found.

4. **`terminal.ports` and `terminal.stop_server`.**
   - `terminal.ports`, a stream of a Space: its servers, each its port, its process, its program, and whether a terminal or an Agent started it. It needs `Read`.
   - `terminal.stop_server`, with the port and the process: it looks again that the server is still the Space's, then sends SIGTERM to the server's process group, and SIGKILL to what is left after 3 seconds. A group whose leader the engine started itself, as a Harness's process or a terminal's shell, is never stopped as a group: only the server's own process is. It needs `Run`, as a terminal's input does.

5. **The widget `terminal.ports` shows the port's number**, on the bar's right (ADR 0024, decision 2): `:5173`, and with more `:5173 +2`, in the bar's muted text. The first is the one that came first. It draws nothing while no Space has a server.
   - The line on hover lists them: "localhost:5173 · localhost:3000 · localhost:6006".
   - It counts every open Space's servers, as the counts in the middle count every Space's Threads (ADR 0035).
   - A click opens its list, "Servers":
     - a row for each, in the order they came: a globe, `localhost:<port>`, under it "Agent" or "Terminal" and the program (`Terminal · pnpm dev`), and its Space's badge;
     - a click on a row opens `http://localhost:<port>` in a browser Pane in its Space, right of the focused one (`browser.open`); a Ctrl-click, ⌘-click on macOS, opens it in the Person's browser;
     - a square "Stop server" shows on the row under the pointer, in `--destructive`, and is `terminal.stop_server`.
   - Banda's `[bar] right` gets it after `workspaces.aside`.

**Not now.** Servers on Windows; an Agent's server known by its Thread, as T3 Code's are (a Harness's process serves every Thread of its Space); a page's title or icon; servers a Space's file names, as T3 Code's `previewUrl`; opening a server by itself as it starts; an Agent tool that lists them.

## Consequences

- ADR 0024, decision 5.3, is this ADR's: the servers are found by what Banda started, not by the terminal's processes alone.
- The terminal module reads every process's sockets and environment on the machine, its own user's: `/proc` on Linux, `lsof` and `ps` on macOS. It keeps nothing of them but the servers.
- The Harness library sets the Space in a Harness's environment, so it knows a Space's ID at its start (ADR 0040, decision 6).

## Steps

Each step is its own PR.

1. This ADR.
2. The engine: the environment of terminals and Harnesses, the servers found on Linux and macOS, `terminal.ports` and `terminal.stop_server`.
3. The widget, its list, opening and stopping, and `[bar] right`.
