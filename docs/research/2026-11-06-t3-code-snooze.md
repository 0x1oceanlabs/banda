# How T3 Code snoozes a Thread

How T3 Code puts a Thread away until a time, and what Banda takes from it
(ADR 0074).

- **Source:** the T3 Code desktop app, version 0.1.7, as installed on
  2026-11-05: its bundle `resources/app.asar`, unpacked with
  `npx @electron/asar extract`. The client is `apps/server/dist/client/`.
- **How:** read-only, from the built and minified code and its strings. Nothing
  of T3's was changed. The names below are its fields and strings; the
  minified function names change with every build, so they are left out.
- **Mockup:** `snooze-v1.html`, made with Roma on 2026-11-05 (in Roma's
  `~/Banda/artifacts/snooze/`).

## 1. What a snooze is

- The server keeps it on the Thread: `snoozedUntil`, `snoozedAt` and
  `lastSnoozeWakeAt`, with the events `thread.snoozed` and
  `thread.unsnoozed`. Every client and the Agent's tools see the same snooze.
- The commands are `thread.snooze {threadId, snoozedUntil}` and
  `thread.unsnooze {threadId, reason: "user"}`.
- An Agent snoozes a Thread with its `t3_thread_organize` tool:
  `snooze` with `snoozedUntil`, or `unsnooze`.
- A snooze takes off a pin and a settle: a Thread is in one place only.
- An older server says "This environment's server does not support snoozing
  yet."

## 2. When it is snoozed, and when it wakes

Whether a Thread is snoozed now is worked out from the Thread, not kept:

- It is snoozed while `snoozedUntil` is later than now and nothing calls the
  Person.
- **Calls the Person, and wakes it early:** an approval that waits, a question
  that waits (`hasPendingUserInput`), a runtime request, a subagent that waits,
  a guest's message, or a failure after `snoozedAt`.
- **A turn that ends does not wake it.** A Thread at work can be snoozed. It
  keeps working out of sight and sleeps until its time.
- The moment it woke is the end of the snooze, or the moment of the call.
- **When it cannot be snoozed:** while something calls ("Respond to the
  pending request before snoozing it."), and for two minutes after the
  Person's own message, while that turn starts.

## 3. Presets

- The settings hold up to 8. Each one is `{kind: "after", minutes}` or
  `{kind: "at", day, time}`, where the day is `today`, `tomorrow` or a weekday.
- The five defaults: after 60 minutes, after 180 minutes, today at 18:00,
  tomorrow at 9:00, Monday at 9:00.
- One whose time has passed is left out. Two that fall on the same minute show
  once. They are sorted by time.
- The labels are worked out: "In 1 hour", "This morning", "This afternoon" or
  "This evening" for today, "Tomorrow", "Next week" for Monday, "Next Friday"
  a week away, or the weekday. The menu shows each label with its time:
  "Tomorrow (9:00)", "Next week (Mon 9:00)".
- **Custom…** opens a dialog: "Snooze for" an amount in minutes, hours or days,
  or a date from a calendar and a time. Its link "Edit snooze options" opens
  Settings › Threads.

## 4. What the Person sees

- **The Thread's menu:** "Snooze ▸" with the presets and "Custom…". On a
  snoozed Thread, "Wake thread" instead.
- **The sidebar:** a section "Snoozed" between Working and Settled, with its
  count. A Thread can be dragged onto it.
- **The Thread itself:** a line "Snoozed, 2h left" with a button to wake it.
  After it wakes, "Woke from snooze" with "Dismiss". That line stays until the
  Person visits the Thread or a new turn ends. Time left is written short:
  `45m`, `3h`, `2d`.
- **A toast** "Snoozed" with Undo. A snooze whose time has passed is refused:
  "That snooze time has passed. Choose a…".

## 5. A usage limit

- A turn that stops at a usage limit offers to snooze the Thread until the
  limit resets, and to resume by itself then (`limitRecovery: {runId,
  resetAt, autoResume, snooze}`).
- The settings can do both by themselves for every such Thread:
  `snoozeLimitedThreads` and `autoResumeLimitedThreads`, both off by default.

## 6. What Banda takes, and what it does its own way

ADR 0074 has the decisions. In short:

- **Taken:** a snooze kept by the engine and seen by every window and Agent;
  waking early on what calls; refusing to snooze what calls; the presets and
  their rules; the shelf; the line in the Thread; Undo; snoozing until a usage
  limit resets.
- **Banda's own:** one picker everywhere with the time typed into it (`2h`,
  `fri 14`, `завтра 10`) in place of a dialog; "When it's done", which wakes
  the Thread when its turn ends; a message from the Person wakes it; snoozing
  closes its Panes, as archiving does; the presets in `sidebar.toml`.
