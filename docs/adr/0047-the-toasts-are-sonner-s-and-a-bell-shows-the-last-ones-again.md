---
status: accepted
date: 2026-11-04
---

# The toasts are Sonner's, and a bell shows the last ones again

ADR 0011 gave the window its own toasts: at most three cards at the top right, a count of the rest, held while the pointer is over them. It kept no inbox: the sidebar keeps the Threads that call. A toast that went away was gone, and so was a call told by a system notification while the window was behind.

On 2026-11-04 Roma asked for the notifications to be a module where they can be seen again, on shadcn's toasts, Sonner, "so there are groupings and the rest". He looked at mocks of a list under a bell and of a Pane and said: build it from Sonner, not by hand; no Pane of its own; "just show the last ones", with the same design. The bell is only a button, with no count. The module's widget can be hidden. How other modules tell of their things waits until Roma has used it, "so there is no overload".

**Decision.**

1. **The window's toasts are Sonner's** (`@banda/ui/components/sonner`, shadcn's component, in Banda's tokens).
   - Sonner draws them, stacks them, opens the stack under the pointer, holds them there, and lets a swipe close one. Banda writes none of that.
   - What a toast says, and when and where it shows, stays ADR 0011's (decisions 1 and 2): `done` 5 s, `failed` 8 s, `asking` 12 s; never for what the Person looks at; a toast or a system notification, never both.
   - A toast's id is its call's key, so a Thread's new call replaces its toast, as before.
   - Three show at once (`visibleToasts`). The rest wait in the stack, and the "more in the sidebar" button goes.
   - A call's toast has one button, Open or Answer. A Problem's keeps Look into it and Details (ADR 0039).
   - Sonner's own key to reach the toasts, `Alt+T`, is off: the Person's keys are `keys.toml`'s.

2. **A bell shows the last toasts again, and Banda keeps no list of its own.**
   - The `notifications` module has one widget, `notifications.recent`: a bell, a button only.
   - A click shows the last five toasts again, the newest first, as Sonner's stack, opened, with the same cards and buttons. They stay until the bell is clicked again, `Esc`, or a click elsewhere.
   - They come from what Sonner keeps itself (`toast.getHistory()`). A call told by a system notification while the window was behind goes there too, without a toast in the window, so the bell shows it as well.
   - That history lives while the window does. After a restart the bell shows one toast: nothing since Banda started. What still calls stays in the sidebar and on the Mark (ADR 0011, decision 2).

3. **The bell is a widget like any other** (ADR 0024). It stands on the bar's right by default, and a `[bar]` without `notifications.recent` hides it. The toasts stay either way.

4. **Only calls and Problems toast for now.** A module's own way to toast, as servers, git or updates would, waits until Roma has decided how it stays quiet enough.

**Consequences.**

- ADR 0011, decision 2: the toasts are Sonner's, and the count of the rest is gone. Decision 1 stays.
- `app/web/src/calls/Toasts.tsx`, `toast.ts` and `useToasts.ts` go; `useCalls` and the Problems' news call Sonner.
- The window has a module with no engine part: `modules/notifications`, its window part `@banda/notifications-pane`.
- The order of work, each step its own PR:
  1. **The toasts are Sonner's.**
  2. **The `notifications` module and its bell.**
