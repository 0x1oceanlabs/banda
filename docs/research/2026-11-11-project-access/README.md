# A Project's access: the fence, trust, the box and the composer's mode in one place

- **Date:** 2026-11-11.
- **For:** Roma, before [ADR 0112](../../adr/0112-a-project-s-access-is-whom-it-is-trusted-as-and-where-it-runs.md).
- **How:** read-only, no paid session. Banda at `ffe8a816`. Codex's docs
  (`developers.openai.com/codex/agent-approvals-security`,
  `learn.chatgpt.com/docs/permissions`) and source at `87b7bdb`. Claude
  Code's docs (`code.claude.com/docs/en/sandboxing`,
  `sandbox-environments`, `security`, `permission-modes`). Gemini CLI's
  `docs/cli/sandbox.md` and `trusted-folders.md`, VS Code's
  `workspace-trust.md` and `devcontainers/containers.md`, on their main
  branches. Anthropic's "How we contain Claude across products", read
  through a summary, not word by word.
- **Limits:** Docker Sandboxes and Cursor were not reached. How a box is
  made without Docker is not in this note: it is the next one.
- **Status:** research. It is evidence, not a decision.

## What Banda has today: six knobs

| What | Whose | Where the Person meets it | What it does |
|---|---|---|---|
| The fence | the machine's | nowhere; its state is in Settings → General | hides Banda's own state and keys from every Agent (ADR 0083, decision 1) |
| `trusted` | a Project's | Add Project's question, the sidebar's menu, the Project's settings | whether a Harness loads what the folder names: `.claude/`, `.codex/`, `.mcp.json` |
| `trust_said` | a Project's | the same card | gives its Agents the Person's GitHub token and ssh-agent |
| Isolated | a Project's | accepted in ADR 0084, not built | a box |
| The mode | a Thread's | the composer's shield; its default in Settings → Agents | Supervised, Auto-accept edits, Auto, Full access: the Harness's own modes |
| `sees_others` | a Project's | the Project's settings | its Agents see other Projects' Panes (ADR 0032) |

Two axes are mixed in them. **How much an Agent asks** is the mode: the
Harness's, for one Thread. **What an Agent reaches** is the rest: a wall,
for a Project. They are chosen in five places, and one leaks into the
other: the fence's state picks a new Thread's mode
(`apps/agents/engine/src/full_access.rs`, `unchosen`).

## What an Agent has of git and ssh today

- Handed over only in a Project the Person said they trust: `GH_TOKEN`,
  the Person's own gh token, and the Person's ssh-agent, with every key in
  it, towards every host (`docs/fence.md`).
- The fence hides only Banda's state and data, tmux, the session's runtime
  folders, X11 and the container managers' sockets; Banda's config and
  gh's are read-only (`engine/src/fence.rs`, `base`).
- So key **files** stay readable to every fenced Agent, in a Project not
  trusted too: `~/.ssh`, `~/.aws`, `~/.kube`, `~/.netrc`,
  `~/.config/gh/hosts.yml`.
- Banda can narrow ssh, by host, with an agent of its own in front of the
  Person's. It cannot narrow the Person's gh token: "this repository
  only" is a token the Person makes on GitHub.

## How others organise it

| | How much it asks | What it reaches | Trust in a folder | A container |
|---|---|---|---|---|
| Codex | approval policy | sandbox mode, the OS's; the network off by default | `trust_level` per project; untrusted "also disables project-local configuration" | its cloud's |
| Claude Code | permission modes; in Auto a classifier | `/sandbox`, off by default, shell commands only; reads stay wide | asked once per folder; project config loads only after it | "run the Claude Code process itself in a container, virtual machine, or the sandbox runtime" |
| Cowork | none: the boundary is always on | a VM with its own kernel; only the chosen folder mounted; an egress allowlist | — | the VM |
| Gemini CLI | approval | Seatbelt, a container, gVisor, LXC; off unless asked | trusted folders; untrusted = "safe mode" | one of its sandbox methods |
| VS Code | — | — | Workspace Trust, binary, a badge; restricted mode "disables agents" | Dev Containers: Reopen in Container, or Clone Repository in Container Volume for "an isolated copy" |

What the field agrees on:

1. **Two axes, named apart.** Claude Code: "`/sandbox` is not a
   permission mode. Permission modes decide whether a tool call runs and
   whether you are prompted first, while the sandbox restricts what a Bash
   command can access once it runs."
2. **The boundary replaces the prompt.** "With no prompts to catch
   mistakes, the isolation boundary you choose is what protects your
   system."
3. **Trust is one yes or no per folder**, asked once, and "no" turns off
   what the folder brings.
4. **A container is its own choice, with two uses**: a dev environment,
   and isolation of code that is not yours.
5. **"Do anything" exists everywhere**, as a choice named loudly.
6. **One named profile in place of switches** is where Codex goes
   (permission profiles, beta).

## How Anthropic contains Claude

- **Claude Code** is for people who can judge a command: it starts with
  questions, and the OS sandbox takes them away. Users approved about 93%
  of prompts; the sandbox cut prompts by 84%.
- **Cowork** is for people who cannot: a full VM, always on; only the
  folder the user chose; credentials stay in the host's keychain and the
  VM gets "a scoped-down, revocable, per-session token".
- Its rules: "Design for containment at the environment layer first, then
  steer behavior at the model layer." Match the isolation to whether the
  user can judge the actions. An allowlist is a grant of capability. "the
  weakest layer is the one you built yourself."
- Its own incidents: a repository's hooks ran before the trust prompt; a
  planted prompt made Claude read `~/.aws/credentials` and post them out
  in 24 of 25 tries; a file in the workspace uploaded data through an
  allowed domain.

## What this gave ADR 0112

- The two axes stay apart: the mode on the Thread, access on the Project.
- Access is two choices: whom the Project is trusted as, and where it
  runs. Keys follow from them: on the computer a trusted Agent reads the
  key files anyway, so a narrower grant is honest only in a box.
- One system for a developer and for a person who does not code, with a
  default of its own for each: Claude Code's way and Cowork's, on one
  card.
- A Project not trusted on the computer is safer, not safe: the box is
  the wall.

## The mocks

[`mocks/01-access.html`](mocks/01-access.html), drawn with the design kit:
the card (A, the pick; B, compact), its states (C), the composer's shield
(D), Add Project (E), a computer with no fence (F), the sidebar (G), the
first run (H) and Settings → Access (I). The UI is in English; the notes
are in Russian, as Roma reads them. Three icons the kit does not carry
yet (`user-round`, `shield-check`, `shield-question-mark`) are inline in
the page.
