---
status: accepted
date: 2026-11-12
---

# An Agent knows which machine its Person writes from

Roma, on 2026-11-12 (translated): "When I write from a remote machine,
can the Agent be told where I write from, which machine? And could that
be useful?" He agreed with the recommendations below and with how they
work ("I agree with your recommendations, and the UX is good").

**Where it stands.** A window on the Mac shows arc's Threads, and what
the Person writes there goes to arc's engine (ADR 0101, ADR 0106). That
engine cannot tell it from a message written in arc's own window:

- `agents.send` carries the Thread or Harness, the text, the images, the
  settings and `steer` (`apps/agents/engine/src/lib.rs`, `struct Send`).
- The kernel's `Caller` names the Participant, the Project a pass keeps
  it in, the Thread and what runs it (`kernel/src/access.rs`), and no
  device.
- The window knows both facts: its own machine's name
  (`useHereNamed`, ADR 0095) and whether the Thread is another
  machine's (the Pane's `args.host`, ADR 0106).

**Where it matters.** The Agent runs on the Thread's machine, and the
Person sits at another:

- A path the Person names, "look at `~/Downloads/shot.png`", is on their
  machine. The Agent reads arc's and answers about another file, or none.
- A machine's own settings, as `keys.toml` (`Scope::Machine`, ADR 0101,
  decision 3), change on the machine whose engine the Agent asks: arc's,
  while the Person looks at the Mac's.

## Decision

1. **The window says where it writes from.** `agents.send` takes `from`:
   the name of the window's own machine, as its engine names it, and
   `here`, whether that is the Thread's machine. A message queued while
   its machine is away (ADR 0105) carries it too. The window sends none
   before its own machine has first said its name; a message from the CLI,
   from another Thread's Agent or from an older window has none.

2. **The engine keeps it with the message, and what the session was
   told.** `agents_items` gets a column, `written_from`, and
   `agents_threads` one, `told_from`: the machine the Thread's session was
   last told of, as a prompt went to it. Only a Person's `from` is kept; an Agent's is dropped.
   The name is the Person's own words of their machine, cleaned as a
   window cleans it (ADR 0095, decision 2; the kernel's `clean_name`, as
   `cleanText`): no control, format or separator characters, at most 16
   characters.

3. **The Agent reads one line, and only when it changed.** Before the
   message, as the notices go (`effects.rs`, `prompt_of`), when its
   `from` is not the one its session was told of. A session told of none
   reads nothing of the Thread's own machine, as that is what an Agent
   assumes. So the order the prompts go in decides, not the order the
   messages were written in: a message steered ahead, withdrawn or run as
   a command tells nothing out of turn.
   - from another machine: "Your Person writes this from their machine
     "MacBook Pro", not from this one: a file or path they name is
     there, not here, and a setting you change here does not change
     theirs."
   - back on the Thread's machine: "Your Person writes this from this
     machine, "arc", again."
   - Not on a message the Harness runs as a command (`/` or a skill), as
     the notices are not.

4. **The Person does not see the line.** It is Banda's word to the Agent,
   as the line before another Thread's Agent's message is (ADR 0019,
   decision 4), and the Thread shows the message as it was written.

5. **Not now.**
   - What kind of device, desktop, a browser tab or a phone, joins `from`
     when Banda has a web or phone client (ADR 0089).
   - The Thread Pane says it, not every sender: the message a move carries
     to the Agent on the other machine (ADR 0116) and the browser's
     "tell the Thread" go without it, and the Person's next message from
     the Thread says it. Should more senders need it, the window says its
     machine once per connection, in its `hello`, and the kernel's
     `Caller` carries it, in place of the field.
   - No tool asks where the Person is: an Agent would not know to ask
     before it needs it.

## Consequences

- One column and one optional field: the Thread, its Pane and the
  Harness's system prompt do not change. A session that started on one
  machine and goes on from another learns it from the next message.
- A message steered into a running turn takes its line as a queued one
  does: both go through `prompt_of`.
- A session that starts afresh, as one its Harness could not pick up or
  a Thread handed to another Harness, was told of none. A fork's session
  goes on from its source's, so the fork keeps what the source was told.
  A rewind keeps it too: the line may be one message late, never wrong
  for long.
- The name goes in quotes as Rust quotes a string, so a `"` in it does
  not end it.
