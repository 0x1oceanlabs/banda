---
status: proposed
date: 2026-11-10
---

# Honest when away: what the Person sees while a machine is away, and what may wait for it

_Proposed on 2026-11-10; Roma accepts it. The short ADR of the roadmap's
"Honest when away" slice (stage 1, H5a to H5e). The roadmap asks for one
short ADR and one mock per stage
(`docs/research/2026-11-08-roadmap-in-slices.md`); this slice has enough
of Roma's calls to take its own. It holds his calls Q7 and Q8, the rules
H5a to H5d built and H5e's open questions. Once accepted, it amends ADR
0082 decision 16, ADR 0095 decision 7 and ADR 0101 decision 7. Code is
cited from main at `1464393e`; the plan is Roma's
`~/Banda/artifacts/two-machines/h5-plan.md`._

Roma works from a Mac and keeps his Agents on arc. Neither is home: the
machines are peers, and one that is away takes only its own Projects and
files away (ADR 0101, decision 7). ADR 0082 decision 16 decided that such
a machine fails fast, and that only what the Person chooses waits, in a
visible queue. This ADR says what the Person sees.

## Where it stood

Before H5, "away" was not honest:

- An act to arc while it was away waited with no end, then ran once arc
  was back: a Stop, an Allow or a retry minutes late (#950, #972, #923).
- A link that looked up but answered nothing, as a Mac asleep or a hung
  engine, showed live, and Send spun for minutes.
- The pill could say "arc is away" while Send said "Connecting", and
  away showed up to 60 s late (#948, #824).
- A stopped machine lost its rows (#989), and a toast for an arc Thread
  had no Allow or Deny (#737).

## Decision

1. **The Person sees one word, "away"** (Roma, 2026-11-10, Q7), whether
   the link is gone or arc answers nothing over a link that looks up. A
   machine shows live or away. "Stale" stays the word of the code and the
   ADRs (ADR 0082, decision 11). The pill keeps "arc is away · 2 min".

2. **A machine that is away or stopped keeps its rows, dim, as of when it
   was last heard** (Roma, 2026-11-10: Q8, and "as of" once on the
   label, not on each row; H5c, PR #1189, open). Each row keeps its
   words, its timers standing. The machine's label says once, not dim,
   what they are as of: "away · as of 14:02", "stopped · as of 13:51
   ▷ Start", with the day once it is not today; its tooltip, "arc has not
   answered since 14:02". One clock per Window drives the pill, the label
   and the rows (#988). When arc answers, the rows undim and what it
   wrote shows.

3. **One rule says whether the window reaches a machine** (H5a,
   `0ea95e01`): its state plus its engine being open. Send's tooltip says
   the pill's words; "Connecting to arc…" shows only while arc is live and
   its engine is not open yet. A machine live again wakes its engine, so
   Send turns on as the pill goes. ssh gives up after 10 s, and a silent
   link after about 20 s.

4. **Nothing goes later by itself** (H5b, `49e52c63`). An act to a
   machine that is not live is refused at once, with the machine named:
   "arc is away: Stop was not sent." One on its way when the machine goes
   may have gone through: "arc went away; Stop may have gone through."
   Neither is sent again once arc is back. A quick reconnect while arc
   stays live still resends with the same CommandId. Marks never queue
   (ADR 0096, decision 8).

5. **A machine that answers nothing is away** (H5c, PR #1189, open). The
   window pings another machine's engine every 15 s; two pings with
   nothing heard after them make it away, as does a connection its
   engine never opens. An act after 5 s of quiet pings first, and with
   nothing heard in 3 s it fails in decision 4's words. Anything the
   engine says brings it back. The `pong` carries the host's time. The
   window never pings its own machine's engine.

6. **An act goes to the machine that owns its Project** (H5d,
   `6ee8da05`), through one `KeptHosts.sessionOf(project, pane?)` in the
   core. A toast's Allow, Reject or Try again for an arc Thread goes to
   arc. A machine the window does not know or reach refuses at once; this
   machine's engine never stands in for it.

## Open questions

For Roma, over the mock in Roma's
`~/Banda/artifacts/two-machines/h5e-mock.html`.

- **Q1. Which acts may wait for "Send when back"?** _Decided by Roma on
  2026-11-10: as recommended._
  - _Recommended:_ only a message to a Thread already started. Every
    other act fails at once (decision 4): Stop, answers, Implement, Try
    again, Fork, Edit of a sent message, steer, withdraw, rewind, model
    and mode, adding an image or a file, Later and wake, rename and
    marks. A message with images waits too: each image went to arc as it
    was added (`agents.attach`), so the waiting message keeps only their
    ids. A new Thread's first words stay in its composer, as H5b does.
    Beyond the composer, another ADR may name an act the Person defers
    in its own words, which then waits as this message does: ADR 0106
    (stage 2) names closing a terminal Pane while its machine is away,
    "Closes on arc once it is back".
  - _Other:_ let more acts wait; but a Stop or an Allow that lands late
    does what the Person no longer means.
- **Q2. How does the Person choose to wait?**
  - _Recommended:_ in a started Thread, while the machine is away, Send
    itself reads "Send when back", with a clock. Its tooltip says "Sends
    once arc is back, until 14:42", and Enter does the same. It is the
    same while Banda is stopped on arc or arc runs another build: the
    message goes once arc is live, after Start or Update arc. A New
    Thread's Send stays off.
  - _Other:_ a "Send when back" link beside a Send that stays off: two
    controls, and Enter does nothing. Or only away waits, since a
    stopped machine or another build does not come back by itself.
- **Q3. Where does a waiting message show?**
  - _Recommended:_ at the end of the Thread, dim, in the look of the
    Thread's Queue: "Waits for arc · until 14:42", with Edit and Cancel.
    Edit opens it in place and keeps its time; Cancel puts its text back
    into the draft. The pill adds "· 1 waiting": it counts every message
    that waits for arc on this device, so each arc Pane says it. Nothing
    in the sidebar for now.
  - _Other:_ a sign on the sidebar's card too (ADR 0098); the pill says
    it already. Or the pill counts only its own Thread's.
- **Q4. How long does it wait?**
  - _Recommended:_ 10 minutes by default (ADR 0082, decision 16). A
    click on "until 14:42", or a right click on the message, opens "Keep
    for": 10 min, 1 hour, 1 day or 7 days, the most. The time counts from
    when Send was pressed, in the words of `clock()`, as Later's "until"
    has them: "until 15:32", "until Wed 14:32", "until Nov 17, 14:32".
  - _Other:_ one fixed time, with no menu.
- **Q5. What happens once its time has passed?**
  - _Recommended:_ it is not sent. Its text goes back into the draft,
    above anything new there, after a blank line, with a toast: "Not
    sent: arc was still away at 14:42." The toast has Open when the
    Thread is not on screen.
  - _Other:_ drop it with the toast alone, and the Person's words with it.
- **Q6. Does the queue survive a window restart?**
  - _Recommended:_ yes, kept on this device, per machine, for its time.
    Each waiting message keeps what its Pane needs before arc answers:
    the Thread's title, its Project and its Harness's name (#956). A new
    Thread's draft is kept too, which closes #838.
  - _Other:_ kept in memory only; quitting drops what waits.
- **Q9. Where do these answers live?**
  - _Recommended:_ in this one short ADR with the mock, the way the
    roadmap asks of a stage.
  - _Other:_ dated notes in ADR 0082 decision 16 and ADR 0095 decision 7
    alone.

## The rule for H5e, once accepted

- Only a message to a Thread waits (Q1), and what another ADR names as
  deferred by the Person in its own words (ADR 0106's terminal close).
- Its CommandId is fixed when it is queued, and every send of it uses
  that one, so the host runs it once (ADR 0082, decision 4).
- It carries `not_after` on its frame, in the host's time: this device's
  clock plus the offset from H5c's `pong`, or this device's clock alone
  while none was heard.
- The host looks up the receipt first: a resend of a command that ran
  gets its answer, never `expired`. Then, past `not_after` by its own
  clock and before the module runs, it refuses `expired` and keeps that
  as the receipt, so a resend gets `expired` too. `expired` is final.
- The client drops it past `not_after` by itself, as an older host
  ignores the field. That is the guard; the host's check is the backstop.
- When the machine is back (decision 3), what waits goes once, in the
  order queued, before anything new. One on its way when the machine goes
  again keeps waiting and goes again with the same CommandId: the Person
  chose to wait, so decision 4's "never sent again" does not apply.
- Such a message shows "may have gone through". It has no Edit and no
  Keep for, so what goes again is the same command. Past `not_after` it
  is dropped with "arc went away; your message may have gone through.",
  its text back in the draft.
- Any other message refused `expired`, or dropped, follows Q5.

## Plan

Each step is its own PR, after H5c (#1189) merges.

1. **H5e-1, Send when back.** A queue with a storage port in the core
   (`client/core/src/queue.ts`, new; a `useWaiting` hook), sent by
   `KeptHosts.take` as a machine is live again; `commandAt` with
   `notAfter` (`sdk/contract/src/engine.ts`); the frame's `not_after` and
   `Code::Expired` in `kernel/src/api.rs` and `error.rs`, checked in
   `kernel.rs` after `begin`, beside the access check, so a kept receipt
   answers first; Send, the waiting row and the draft in the agents pane
   (`Composer.tsx`, `session.ts`, `Queue.tsx`, `drafts.ts`); the pill's
   count (`client/web/src/window/named.tsx`). Tests: the kernel's
   `expired` with its receipt, and a late resend of one that ran getting
   its answer; the queue's resend and drop; an e2e that cuts arc, sends
   when back and sees one answer, and one past `not_after` by
   `page.clock` that is not sent.
2. **H5e-2, the queue survives a restart.** The queue kept on the device
   through the port, per machine, each message with its Thread's title,
   Project and Harness's name; "Keep for" with 1 hour, 1 day and 7 days
   in the row's menu; a new Thread's draft kept (`drafts.ts`, #838).
   Tests: the core's persistence, and an e2e with a reload.

The mock shows Send as "Send when back" under the pill, the waiting row,
"1 waiting" in the pill, the row's menu, the expired text back in the
draft and the row after a restart. H5e closes #838, and #950 with Q1; with H5b and H5c it ticks
#737's H5 box.

## What it amends

Once accepted, each with a dated note in place:

- **ADR 0082, decision 16.** The visible queue holds only a message to a
  Thread, and "send when back" is its Send. Past `not_after` its text
  goes back into the draft. The queue is kept on the device, per
  machine. The 10 minutes and the 7 days stand.
- **ADR 0095, decision 7.** In a started Thread, while the machine is
  away, stopped or on another build (Q2), Send is not off: it reads "Send
  when back", and the pill adds "· 1 waiting". A New Thread's Send stays
  off.
- **ADR 0101, decision 7.** "Send when back" keeps a message to a Thread,
  not any command, in the visible queue.

ADR 0082 decision 11 carries H5c's own note (PR #1189). ADR 0096
decision 8 stands: marks never wait.

## Consequences

- Nothing runs late that the Person did not choose, and what they chose
  shows with the time it gives up.
- A machine asleep or hung shows away within about 5 s of an act, or
  30 s idle, and its rows stay, dim, with their time.
- A waiting message may land minutes late, after another device moved
  the Thread on. It lands at the end, where the Person left it.
- The queue is this device's: one waiting on the Mac is not seen on the
  phone, and the Mac must be on to send it.
- Each other machine costs a ping every 15 s.
