---
status: proposed
date: 2026-11-11
---

# A Project's access is whom it is trusted as, and where it runs

_A draft. It would amend ADR 0083 (decision 1: the fence as the floor for
every Project, and which mode a new Thread starts in; decision 5: the
Project's trust), and it builds on ADR 0084 (the box and the Isolated
switch). The evidence is in
[the research](../research/2026-11-11-project-access/README.md), with its
mocks._

Today six things say what an Agent may do, and they are chosen in five
places: the fence, a Project's `trusted` and `trust_said`, the Isolated
switch that is not built, a Thread's mode, and `sees_others`. Two
questions are mixed in them. How much an Agent asks is the mode, the
Harness's own, for one Thread. What an Agent reaches is the rest, a wall,
for a Project. One leaks into the other: the fence's state picks the mode
a new Thread starts in.

Roma, on 2026-11-11 (translated): the fence "still has to be worked out,
and matched with the permissions in the composer's input, so that all is
in one place". Then three things to hold together:

- "A Project opened in Docker for more isolation, by choice: for one I do
  not trust, or just as a development environment."
- "On my computer, in Banda, there must be an Agent I trust, that may do
  anything on the computer, with all rights."
- "Is Banda for code or for work? I write code, but not all my clients
  do; some just work, and there will be more of them, and I cannot make
  different systems." They install Banda themselves. "This fence must be
  easy to set up, because there will be those who write code too."

## Decision

### Two questions, kept apart

1. **The mode is a Thread's, and access is a Project's.** The mode stays
   what it is: how much the Harness asks, in the composer's shield.
   Access is what the Project's Agents reach. Nothing of one decides the
   other: a new Thread starts in the mode its Person set for its Harness
   in Settings → Agents, whatever the fence.
2. **Access is two choices.** **Trust**: As me, Trusted, or Not trusted.
   **Runs**: On this computer, or Isolated. The Person never chooses the
   fence: it is how Banda keeps what Trusted and Not trusted say.

### Trust

3. **As me.** The Project's Agents are the Person on this computer: no
   fence, every program, the keyring, `sudo`, Docker, and Banda itself.
   Any Project may have it, and only by its Person's choice for that
   Project: it is never a default, and never what Banda picks. It does not
   go with Isolated: a box is not this computer.
4. **Trusted.** As a folder of the Person's own is today: their files,
   programs and network, behind the fence where it holds, so Banda's own
   data stays out of reach. `trusted` and `trust_said` become this one
   answer: a Project trusted gets what its folder names for a Harness, and
   the keys of decision 7.
5. **Not trusted.** What the folder names for a Harness (`.claude/`,
   `.codex/`, `.mcp.json`) is not loaded, no key is handed over, and the
   folders where keys are known to lie are hidden from its Agents. This
   last part is help, not a wall: the list is never whole, and its Agents
   still read the Person's other files and reach the network. The wall for
   code the Person did not write is the box.

### Runs

6. **Isolated is ADR 0084's box.** Its Agents see the Project's folder and
   nothing else of the computer. It has two uses, and one switch: code the
   Person does not trust, and a Project's own environment. A box of a
   Project not trusted has its network closed but for what its Person
   allows (ADR 0084, decision 10).
7. **Keys follow from the two choices. There is no third.**

   | | On this computer | Isolated |
   |---|---|---|
   | As me | all the Person has | — |
   | Trusted | the Person's ssh-agent and GitHub token, as today | only this Project's git, through the door |
   | Not trusted | none; the known key folders hidden | none |

   On the computer a trusted Agent reads the Person's key files anyway,
   so a narrower grant there would promise what it cannot keep. In a box
   no key lies on disk, and what comes through the door is all there is.

### One place

8. **One card, the same everywhere.** A Project's settings have the card
   **Access**: the two rows, each choice with a line that says what it
   means, and under them what the Project's Agents get. The composer's
   shield shows the Thread's mode and, under it, the Project's access in
   one line that opens the card. Settings → Access has the same two rows
   as the default for new Projects, and every Project with its access,
   changed in place. The same is a line in a settings file and a command
   of `banda`, for those who write code.
9. **Only the Person changes access.** An Agent's pass is refused, as it
   is for trust today.
10. **The first run asks one question, in plain words**: "Where may your
    Agents work?" "Only in the folders I open" makes new Projects
    Isolated; "On this computer, as I do" makes them run on the computer.
    Both are Trusted. A folder that looks foreign still asks as it is
    added, and where a box can be made, Enter there is Not trusted and
    Isolated.
11. **Where the fence does not hold, the card says so.** On a computer
    with no fence, Trusted cannot keep Banda's own data out of an Agent's
    reach, and its line says that it is as As me there. Banda draws no
    level it does not have.

### Words

12. **As me, Trusted, Not trusted; On this computer, Isolated.** The
    Person does not read "fence" in the window. Each has one icon, the
    same in the card, the shield, Add Project and the sidebar: a person, a
    shield with a check, a shield with a question mark, a laptop, a box.
    No level has a colour: none of them calls.

## Why

- **The field keeps the two apart.** Claude Code: "`/sandbox` is not a
  permission mode. Permission modes decide whether a tool call runs and
  whether you are prompted first, while the sandbox restricts what a Bash
  command can access once it runs." Codex names them the same way.
- **One system, two people.** Anthropic made two products: Claude Code
  asks, for people who can judge a command; Cowork is a VM that is always
  on, for people who cannot. Its own rule is to match the isolation to
  whether the user can judge the actions. Here it is one card with another
  default: Trusted on the computer is Claude Code's way, Isolated is
  Cowork's.
- **No limits of Banda's own** (ADR 0109). The walls are the fence and the
  box; As me is the Person's to choose, and Banda does not ask twice.
- **Honest levels.** A planted prompt made Claude read
  `~/.aws/credentials` and post them out in 24 of 25 tries, in Anthropic's
  own exercise. That is a Project not trusted on the computer, so the card
  says what that level does not do, and offers the box.

## Consequences

- A Person's own folder works as today, with no new question.
- The box becomes the main way for most people who will use Banda, not a
  later extra for foreign code. It has to be made with nothing to
  install: a person who does not code has no Docker. How, on each system,
  is not decided here.
- An Agent of a Project that is As me is its Person in Banda too: what it
  reads may turn it against the whole computer. That is the price of the
  choice, and why it is never a default.
- Behind the fence Docker, the keyring and the session's services do not
  work. A Project that needs them has As me or a box. If most of a
  developer's Projects end up As me, Trusted is not earning its place:
  this is to be looked at on real Projects.
- `sees_others` (ADR 0032) is not folded in here; whether As me takes its
  place is open.

## Open

1. How a box is made without Docker, on Linux, macOS and Windows, and
   what it costs. The first run's question (decision 10) cannot be honest
   before it.
2. What a Harness needs inside a box to sign in and to work, beyond what
   ADR 0084 says.
3. Which folders count as "where keys are known to lie" (decision 5).
4. What an Agent of a Project not trusted may do to other Threads of its
   Project: today any Agent's pass may stop, resume or edit them.
5. The settings file and the command's name (decision 8).

## Plan

Not ordered into steps yet: the box comes first, and its research is
next.
