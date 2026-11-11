---
name: banda
description: Banda is the workspace this Agent works in, a tiling window of Projects, Threads and Panes. Read it to know where things are and to change Banda for the Person, such as its look, its sidebar, or its keys, shortcuts and keybindings.
---

# Banda

Banda is a tiling workspace for working with Agents. If you run in one of
its Threads, you are one of those Agents, and the Person sees your work in a
Pane of Banda's window.

## Words

- **Project**: one body of work and its folder, any folder on this machine.
  Banda keeps its data and log outside it, in
  `~/.local/share/banda/projects/<id>/`.
- **Thread**: one session with a Harness in a Project. Each Thread has its
  own Agent.
- **Harness**: the agent program a Thread runs on, such as Claude Code or
  Codex.
- **Pane**: one tile of the window, such as a Thread or a terminal.
- **Workspace**: one screen of Panes. Its **Strip** lays them out in
  columns that scroll sideways.
- **Sidebar**: every Thread of every Project, at the window's left edge.
- **Bar**: the line across the window's top, with Banda's **Mark**, which
  says what the work calls the Person for.

## How to change Banda

Banda is changed through text files, the same way the Person changes it.

1. Read the topic for what you change, below.
2. Change one key with `banda settings set <file> <key> <value>`, as
   `banda settings set look.toml tile.border 3`, or take it out with
   `banda settings reset <file> <key>`: they keep every comment and other
   key, and refuse a value the file would not take. A Harness is named by
   its ID: `banda settings set harnesses.toml harness.codex.enabled false`.
   What a new Thread on a Harness starts with is agents.toml's `start`
   table: `banda settings set agents.toml start.claude.model '"opus"'`,
   and `plan` or any option the composer offers. `banda settings rename
   <file> <key> <to>` gives a key another name in its table. For more
   than a key, run one for each. They go through the engine, as the
   `settings_set`, `settings_reset` and `settings_rename` tools do: the
   settings folder is read-only to your programs, so never edit a file
   there by hand. The engine refuses, with the line to give your Person,
   what only they change: which Harnesses there are and what each runs
   (a `harness.<id>` entry whole, and its `id`, `command`, `args`, `env`,
   `cli`, `of`, `carried` and `record`), the `mode` a new Thread starts
   in, what Agents may do in the browser (browser.toml's `[agents]`),
   what Banda sends (sharing.toml), and this machine's name and icon
   (machine.toml). A key is bound with `banda keys bind`, as the topic
   `keys` says. A new file of the Person's own that no command writes, a
   sidebar preset or a theme, you write in your Project, and give your
   Person the line that copies it into their settings folder. Every key
   is optional: set only what changes.
3. Check it: `banda settings check`, or `banda settings check <file>` for
   a new file, prints `path:line:column: problem`
   for each mistake, and nothing when all is well. `banda settings schema
   <file>` prints every key a file may hold, with what it does.
4. Tell the Person what you changed, and how to undo it.

The window applies each save at once. A broken file leaves the last good
state in force, and the bar names the file and the line.

Never touch credentials, a Harness's own configuration, or a Project's data
in `~/.local/share/banda/projects/`; the files a message keeps there are
yours to read.

Only the Person binds a key that acts as them, one that sends words to an
Agent or runs or opens something outside Banda, as `thread.new` with
`ask`: write no such line in `keys.toml`, by a tool, a command or an edit,
and give them the line instead (ADR 0083).

## Opening the Banda menu for the Person

`banda menu [route]` opens the Banda menu in the window, as Alt+Space
does: `banda menu actions` at its Actions, each with its key;
`banda menu project.<name>` in a Project, its Threads and a new one there;
`banda menu project.add` at "Add Project" (`project.add.folder` at its path
field, `project.add.new` at a new Project's name);
`banda menu views` at the sidebar's presets; `banda menu
settings.<section>.<row>` opens the settings Pane there. Other words
open it with them typed in, as a search. It exits 2 when the window is
not open, and always behind Banda's fence (see below), which keeps the
window out of your reach: tell your Person where to go instead, as
Alt+Space, then the route's words.

## Banda's engine

Banda's engine keeps the Projects and runs the Agents. On Linux it is a
service of the Person's session: closing the window leaves it and every
Agent running, and the next window, or any `banda` command, finds it, or
starts it when it does not run. `banda status` prints whether it runs,
since when, its build, and whether its fence holds; under your pass it
says so of the engine that gave it. Quitting Banda is the Person's: `banda stop`,
Quit Banda in the window and Ctrl+Q (outside a terminal Pane) stop the
engine and every Agent's turn, and `banda stop` refuses under your pass.

## Adding a folder as a Project

A Project is the Person's to add: when they ask for a folder to become
one, `banda menu project.add.folder` opens "Add Project" at its path
field for them, and you tell them the path. In their own terminal,
`banda project add <path>` adds it too. The folder is not changed:
Banda keeps the Project's data elsewhere.

A Project's name, pin and archive, and its removal, are the Person's: they
change them in the settings, which `banda menu settings.projects.<id>`
opens at that Project, or from the Project's menu in the sidebar.
So is its trust, `trusted` in `banda call projects.list`: while the Person
does not trust a Project, your Harness loads none of the settings, hooks or
MCP servers its folder names, only the Person's own. Add Project asks them
about a folder that looks foreign; later they trust it with "Trust
Project…" in the Project's menu, or in its settings. Only in a Project
they said they trust (`trust_said` in `banda call projects.list`) does
your shell get their GitHub token, as `GH_TOKEN`, and their SSH agent, so
`gh` and `git push` work behind the fence. In one trusted only as nothing
marked it foreign, it has neither: ask your Person to run `banda call projects.trust '{"project":"<id>","trusted":true}'`
in a terminal Pane, or to stop trusting it and trust it again in its
settings.
A Project whose folder is gone is listed `missing`, and every call into it
is refused until the Person locates the folder: `banda menu
project.locate.<id>` opens "Locate folder" for them.

## Behind the fence

On Linux your Harness, and every program you run, runs behind Banda's
fence where it holds (ADR 0083): Banda's own state and data are hidden,
its settings read-only, and you see only your Harness's processes. What
your Person has outside it is out of your reach too:

- the session's runtime folder, and with it the user's systemd
  (`systemctl --user`), the desktop's notices (`notify-send`), the
  compositor (`hyprctl`, `wl-copy`), the keyring, gpg's agent (signed
  commits), and a rootless Docker or Podman; the display, so a window
  runs only headless (`try.sh --hidden`);
- what needs another user's rights: `sudo`, `newuidmap`, `fusermount`,
  and so AppImages (`APPIMAGE_EXTRACT_AND_RUN=1` runs one) and sshfs;
- devices but the plain ones: no GPU, `kvm`, `fuse`, `tun` or sound;
- Banda's window: `banda menu` and `banda files` reach none.

What you start ends with your Harness, in the background too: a dev
server, a trial, `gh run watch`, a long build. Your Harness ends as the
engine restarts (each update of Banda does), after 30 minutes with no
turn unless what you started listens, and when your Person trusts or
stops trusting the Project, once the turn ends.

In a Project your Person said they trust, the SSH agent stays in reach,
so `git push` over ssh signs as they do. For anything else out of reach,
give your Person the command to run in a terminal Pane, which runs
outside the fence.
`banda status` says whether the fence holds; where it does not, as on
macOS and Windows, a new Thread starts Supervised.

## GitHub in a Project not trusted

When gh says your Person's GitHub token is invalid, git asks for a
GitHub password, or ssh says `Permission denied (publickey)`, your
Project has no GitHub token or SSH agent: an Agent gets them only in a
Project its Person said they trust. Never run `gh auth login` or `gh
auth logout` for it, and never tell your Person their sign-in is broken:
ask them to trust the Project in Banda.

## Driving the browser's tabs

Banda's `browser_*` tools open and drive tabs in Banda's browser, in
your Project's own profile, apart from the Person's: you see only the
tabs your Project's Agents opened, and those the Person lent your Thread.
Read `banda skill browser` before you use them.

## Showing the Person a Visual

Show a visual the Person asks for, and data with a trend or a
comparison, as a Visual in your Thread: lay the page out with
`preview_visual`, fix what its picture and console show, then show it
with `show_visual` and the height it answered. A visual already in a
file is shown by passing that file's HTML. Never start a server for
one, and never describe it after: say only what it doesn't. A picture
to post, send or use elsewhere is a `.png` file and its path, not a
Visual. Ordinary coding work needs neither tool.

## Putting off your Thread

When you wait on something slow, as CI or a long build, and have nothing
for your Person meanwhile, put off your own Thread with the `later` tool:
`after` is how long, as `30m`, `2h` or `1d`. It leaves their list until
then, and anything that needs them wakes it early, a question of yours
too; `wake` brings it back sooner, as when what you waited on came
early. It does not wake you or start a turn, so say in your reply when
to look again.

## Starting Banda from its own code

In a checkout of Banda, start its window with `scripts/try.sh --detach`
(with `--hidden` on Linux) and close it with `scripts/try.sh --stop`, as
its `AGENTS.md` says. `--detach` runs it in a session of its own, apart
from your process group, so it does not crash when your Turn's processes
stop (ADR 0086). Where your Harness runs behind Banda's fence, as on
Linux, the trial lives inside it: it ends when your Harness stops, and
your Harness is not let go for idling while the trial listens. Never
start it with a bare `electron .` or `pnpm start`, and never stop it by
killing its process group: send its main process SIGTERM.

## Where things live

`~/.config/banda/` (or `$BANDA_CONFIG`) holds what belongs to this machine.
Banda Dev keeps it in `~/.config/banda-dev/`, a Banda built from a checkout
in `~/.config/banda-local/`, as their data and state too:

| File | What it sets |
|---|---|
| `look.toml` | the theme, colours, corners, gaps, motion and sounds |
| `themes/<name>/` | the Person's own themes |
| `sidebar.toml` | how the sidebar arranges Threads |
| `sidebars/<name>.toml` | the Person's own sidebar presets |
| `browser.toml` | where the browser's tabs are, and its search |
| `agents.toml` | what Enter does with a message written while the Agent works |
| `keys.toml` | the Person's keys, `[binds]`: `"Alt+M" = "column.maximize"`, or `"none"` to free a key; `mod`, the keys held for every Banda key, `"Ctrl+Alt"` where the desktop holds Alt; Ctrl+Alt+Shift+K brings Banda's own back. Bind with `banda keys` or the `keys_*` tools: the topic `keys` |
| `harnesses.toml` | the Harnesses Threads start with |
| `machine.toml` | this machine's name and icon, as every window shows it; `banda machine` prints them |
| `schemas/` | each file's JSON Schema, written by Banda for editors |

## Accounts through the CLI

Use the existing Agent pass. Do not drop `BANDA_TOKEN`, edit credentials,
or prepare a connection script for the Person (ADR 0104).

```sh
banda account list                        # one JSON object a line, with its role
banda account list --of claude --enabled --field id
banda account list --kind gateway | banda account status -
banda account discover
banda account connect claude --id claude-work --name Work --folder /absolute/profile
banda account add codex --id codex-work --name Work
banda account status codex-work
banda account rename codex-work Personal
banda account enable codex-work
banda account disable codex-work
banda account default claude-work
banda account fallback codex-work
banda account fallback # clear it
banda account remove codex-work
```

Each command is a filter: stdout holds only its result, one JSON value a
line, and nothing for a change that answers nothing. A refusal goes to
stderr as `{"error": {"code", "message"}}` and exits 1. `list` narrows by
`--of`, `--kind`, `--enabled`/`--disabled` and `--role default|fallback`;
`--field` prints one field of each. `status`, `enable`, `disable` and
`remove` take `-` for IDs on stdin, bare or as `list`'s lines: each is
asked, and a refused one does not stop the rest.

The folder is on the engine's machine. Discovery includes Omarchy's
profiles, and does not prove they are signed in. Connecting preserves the
existing credentials; Add creates a private, empty profile. IDs stay;
names can change. The same folder cannot be connected twice.

For sign-in, use `banda account login ID --way WAY`, with the way from
`account status` (omit it if there is only one). It returns a login ID.
`banda account login-status LOGIN` reads its progress and terminal output;
`banda account login-input LOGIN CODE` submits one line when needed.
For Codex on a remote engine, `--way device-code` uses its own device
login: the output gives the verification URL and one-time code for the
Person to open on their computer.
The Person completes the provider's browser step. Do not ask them for a
password or copy credentials. `banda account login-cancel LOGIN` cancels.
Once done, `banda account login-finish LOGIN` refreshes the Account; ask
`banda account status ID` again to confirm who signed in. A successful
program exit alone is not proof. A login lasts at most ten minutes, and
only one runs for each Account. These commands print JSON and refuse
unknown Accounts, unsupported ways and invalid changes.

A gateway account (OpenRouter, LiteLLM) and an API key are the Person's to
add: in Settings → Agents → Add account, or in their own terminal with
`banda account gateway claude --id ID --url URL` and
`banda account api-key ID` (Codex), which read the key from stdin. Never
ask for a key in a chat, and never run `banda secret get`: it is for the
account's own Harness.

Removing an Account moves its Threads to the current default after their
active Turn. Choose another default before removing that one. Removal
keeps history, the old session source and profile folders; it does not
sign out. An Account's old ID stays reserved for its sessions.
