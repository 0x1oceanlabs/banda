---
status: accepted
date: 2026-11-04
---

# The notifications module tells the Person

ADR 0011 let the window tell its Person of a call; ADR 0048 drew the toasts with Sonner and gave the `notifications` module a bell. The telling itself stayed in the window, `app/web/src/calls`: it found the news in the lists, played the sound, drew the toasts and the system notifications. The Problems' toast was the window's too. The module held only the bell.

On 2026-11-04 Roma looked at the flow and at seven styles of toast. He kept the line on the edge (ADR 0048), asked for every change proposed below, and for the notifications to be a module of their own, "by the UNIX architecture".

**Decision.**

1. **The window says what calls; the notifications module tells of it.**
   - The window keeps what is its own: the lists (ADR 0008), the Marks, the ringed Panes, the key that answers the first call, and where the Person looks.
   - The module, from its `start`, follows what calls in the lists (`WindowApi.lists`). It finds the news, gathers it for a moment, plays the loudest sound (ADR 0009), and tells of each call by a toast or a system notification, as ADR 0011 and `[notify]` say. A call that stops, or that the Person looks at, it takes back.
   - It asks the window, through `WindowApi`, only what the window knows: where the Person looks for a thing (`sight`, `watchSight`), how to go to it (`answer`), and the look's `[notify]` and `[sound]`.
   - The system notifications are the module's: its desktop part shows them, as the agents' and the browser's desktop parts do their own (ADR 0020).

2. **What tells, tells in plain data.** A notice is data, not code: a key, a kind (`done`, `asking`, `failed`), a title, its Space, a line, and its buttons, each an action by its id and args (`WindowApi.run`).
   - A module tells by running `notifications.tell` with one. The Problems do (ADR 0039), and the window's own calls are made into them.
   - Since a notice is data, the bell keeps the last five across a restart: ADR 0048, decision 2, no longer holds.
   - Others may tell this way. ADR 0048, decision 4, still asks that each be decided with Roma first, "so there is no overload".

3. **A toast says what it is and where, and answers there.**
   - Its title names the Space when the window has more than one: `Deploy docs · banda`.
   - A click anywhere on it does what its first button does: Open, or Answer.
   - A call that asks stays until it is answered or the Person looks at it; `done` still goes after 5 s, `failed` after 8 s.
   - A thing that calls says what may answer it, as buttons (`Listed.answers`): a Question with choices and no form shows them, Allow and Deny; a turn that failed for its sign-in shows Sign in, else Try again. A Question with a form shows Answer, which opens it.
   - The desktop's notification shows those buttons where it can (macOS); elsewhere a click opens the Thread.
   - `done` calls that come while a `done` toast shows join it: one toast, `2 Threads done`, a line each. A call that asks or failed is never joined.
   - The line on the edge stays.

**Consequences.**

- ADR 0011, decision 2, and ADR 0048: the telling moves from `app/web/src/calls` to `modules/notifications`. The window's toaster stays where it is drawn; the module calls Sonner.
- ADR 0048, decision 2: the bell's history is kept.
- `Listed` gets `answers`. `WindowApi` gets `sight`, `watchSight`, `answer` and `look`.
- The order of work, each step its own PR:
  1. **The module tells of the calls**, from the lists, through `WindowApi`; and of what another part tells it, `notifications.tell`, in plain data. The Problems tell through it: the window names no module's package.
  2. **The desktop's notifications are the module's desktop part.**
  3. **Every toast is a notice in plain data**, the calls' too, and the bell keeps the last five.
  4. **The toast**: the Space in its title, a click anywhere, a call that asks stays.
  5. **What answers a call**: `Listed.answers` from the agents module, in the toast and on macOS's notification.
  6. **`done` toasts join.**
