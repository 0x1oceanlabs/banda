---
status: proposed
date: 2026-11-03
---

# A module from elsewhere is a folder: its views are pages in a frame, and its tools come from an MCP server

Only Banda's own modules exist (ADR 0001, decision 10). ADR 0005 shaped
the contract that modules from elsewhere would get (decisions 12 and 13).
ADR 0022 put them under "not now" (decision 7): a process that speaks the
engine API, installing one, loading its window part, and marking it as not
from Banda. On 2026-11-03 Roma said it is time to build them ("у нас это
было изначально, пришло время это воплотить") and gave two cases:

- **Platon's game.** Roma and Platon asked an Agent for a small game for
  two. It wrote one HTML page, and Banda's browser opened it from
  `file://` (which works only because of issue #345). Roma asked to keep it
  as a module, open it again later, share it, and have someone else install
  it.
- **A client's system.** A company has its own program, such as a CRM,
  with its own sign-in, its own database and its own MCP server. A module
  for it is installed in Banda. The company's people then work with the
  program through Agents, and the module draws its own views, such as
  cards and a board, in React. Roma: "просто хочу заложить правильную
  архитектуру для этих модулей". The client case is an example, not a
  product being built now.

Roma also wants a catalog of such modules later, and Agents that work with
them.

The research note on hackable modules
([2026-11-01](../research/2026-11-01-hackable-modules.md)) found that:

- almost no desktop plugin system sandboxes its plugins' code;
- a frame with a different origin, talking JSON-RPC over `postMessage`,
  is now the standard for UI from elsewhere, as MCP Apps (spec
  2026-01-26), which Claude, ChatGPT, VS Code and Goose host;
- what an Agent writes works best against a small, documented contract,
  with a check that names each mistake.

What Banda has already:

- a Visual runs in a sandboxed frame on an origin of its own and wears
  the look's variables (ADR 0037, decision 4);
- `banda mcp` is the one MCP server every Agent reaches, and its tools
  come from the modules (ADR 0019);
- the Banda skill grows by topics from each part's `skill/` folder
  (ADR 0012);
- the window builds its Panes, actions, Watches and menu sources from the
  modules' declarations (ADR 0022);
- the kernel has a machine scope for modules that belong to no Space
  (ADR 0025, ADR 0040).

On 2026-11-03 Roma saw this ADR's shape as two Visuals and said "в целом
хорошо". The points below are that shape, made concrete. Each stays his
to change.

## Decision

1. **A module from elsewhere is a folder with a `module.toml`.**
   - What the folder holds:

     ```
     zorepad/
       module.toml       who it is, and what it offers
       views/            built web pages: its Panes and cards
       skill/            topics for Agents, as ADR 0012 has them
     ```

   - The folder arrives built. Banda runs no `npm` and no compiler on it.
   - Its `module.toml` holds what ADR 0022 gives every module: `id`,
     `name`, `about` and `version`. It adds `author` and `contract`, the
     version of this contract it is written for. It also says what Banda
     compiles in from its own modules' code, since this module has none:

     ```toml
     id = "zorepad"
     name = "Зорепад"
     about = "A game for two: catch the stars with a basket."
     version = "0.1.0"
     author = "Roma"
     contract = 1

     [[panes]]
     kind = "game"                    # the Pane kind zorepad.game
     title = "Зорепад"
     icon = "star"
     view = "views/game/index.html"

     [[actions]]
     id = "zorepad.play"              # in the Banda menu and keys.toml
     title = "Play Зорепад"
     opens = "game"

     # For a module with tools (decision 4):
     # [mcp]
     # url = "https://crm.example.com/mcp"
     # command = ["example-crm-mcp", "--stdio"]

     # The web addresses its views may load, none when left out:
     # [views]
     # web = ["https://cdn.example.com"]
     ```

   - The same registries take both kinds of module. Ours declare in code,
     and a module from elsewhere declares in its TOML. Nothing is built
     twice, and ADR 0005's rule holds: no module of ours takes a path that
     a module from elsewhere lacks, except through a counted unstable
     mark.
   - **The id** is lowercase letters, digits and `-`, with no dot, since
     dotted ids are routes (ADR 0022, decision 4). It is unique on the
     machine, and that includes our ids: a second module with an id already
     there is refused at install. A module's Pane kinds, actions and tools
     start with its id.
   - **`contract`** is a whole number, starting at 1. Banda says which
     numbers it reads (`banda modules --contract`), and refuses a module
     written for another, saying which it would need.
   - `banda settings schema module.toml` prints every key, and the check
     (decision 8) names a wrong one by its line.

2. **Its views are pages in a frame, as a Visual is.**
   - A view is a web page from the module's `views/` folder.
     - The window serves it at `app://<id>.module/…`, a host of its own.
     - Its origin is therefore apart from Banda's page (`app://banda`),
       from the Visuals (`app://visuals`) and from every other module.
   - The frame says `sandbox="allow-scripts allow-forms allow-same-origin"`.
     - The pair is safe here only because the origin differs, which is
       MCP Apps' own rule.
     - So the page keeps its own storage, as `localStorage` and
       IndexedDB, from one day to the next: the game's best scores, a
       CRM's cache.
   - Its Content Security Policy is the manifest's:
     - its own files;
     - the web addresses `[views] web` names, and none when it is left
       out, as MCP Apps denies by default.
     - It has no Node, no reach into Banda's page, and no files of the
       computer.
   - It wears the look:
     - The window passes the look's CSS variables into the frame (the
       ones a Visual gets), with light or dark and the glass.
     - It passes them under MCP Apps' standard names too, so an App made
       for another host follows the look as well.
     - It passes each change again, as the theme changes.
   - It may be written in anything. React with `@banda/ui` is the way we
     give:
     - `@banda/ui` goes to npm, the same shadcn blocks and tokens our
       Panes use, so a view looks like ours.
     - ADR 0005's "Panes are React with `@banda/ui`" holds, inside a
       frame.
   - A view shows in two places:
     - as a Pane of the kind `<id>.<kind>`, which the workspaces keep as
       any Pane;
     - as a card in a Thread, when a tool's result names it (decision 4).
   - A frame cannot draw outside its tile, and cannot drag a Pane. What a
     view needs from the window, it asks over the bridge (decision 3). The
     contract grows there, not around it.
   - Our own modules stay compiled into the window: they are built and
     checked with it.

3. **A view talks to Banda over one bridge, in MCP Apps' words.**
   - The bridge is JSON-RPC over `postMessage`, with MCP Apps' methods
     (spec 2026-01-26):
     - `ui/initialize` answers the host's context:
       - the look's variables;
       - the locale;
       - for a Pane, its args and its Space;
       - for a card, its tool call and its result.
     - `tools/call` calls its own module's tools, and no other's.
     - `ui/message` puts words into a Thread's composer: the card's own
       Thread, or the one beside the Pane. The Person sends them, so a page
       never makes an Agent act by itself.
     - `ui/open-link` opens an address in Banda's browser.
   - What MCP Apps lacks is Banda's own, under `banda/`:
     - `banda/pane.update` sets its Pane's title and args, so a restart
       opens the same deal again;
     - `banda/pane.open` opens another of its module's Panes beside it.
   - The window reads a message only from that module's own frame, and
     checks it before it acts (ADR 0037, decision 4).
   - `@banda/module`, on npm, gives the bridge as typed calls.
   - So an MCP App made for Claude or ChatGPT runs in a Banda view as it
     is. A view that keeps to MCP Apps' words runs in their hosts too.

4. **Its tools come from an MCP server.**
   - `[mcp]` names one server:
     - `url`: a server on the web, over Streamable HTTP;
     - `command`: a program on this computer. The engine starts it in the
       module's folder, with the Person's rights, and speaks to it over
       stdio.
   - The engine is the MCP client of these servers, in the module
     `modules` (decision 6). It connects, lists the server's tools and
     calls them.
   - Agents get the tools through `banda mcp` (ADR 0019), named
     `<id>_<tool>` as the browser's are (`browser_tabs`):
     - An Agent's call goes through the kernel's decision as any tool
       does.
     - A tool the server marks `readOnlyHint` needs `Read`. Any other
       tool needs `Write`.
     - When an Agent asks before acting stays the Harness's decision,
       under its Thread's mode (ADR 0005, decision 13).
   - The tool list follows what is installed and on. `spaces.tools`
     changes, and `banda mcp` tells the Harness with
     `notifications/tools/list_changed`.
   - A tool's result passes as MCP gives it: text, images and structured
     content.
     - Some tools name a UI resource (`_meta.ui.resourceUri`, a `ui://`
       address on its server). Such a result shows in the Thread as a card
       in the frame (decision 2). The engine reads the resource from the
       server, and the window serves it on the module's own origin.
     - So the Agent's work and the view the Person needs stand in one
       place, as in MCP Apps' hosts.
   - MCP Apps' visibility holds:
     - a tool marked for `model` is the Agents';
     - a tool marked only for `app` is for the module's views alone, and
       never reaches an Agent.
   - A module with no `[mcp]` has no tools, as Зорепад.
   - Why MCP, and not a protocol of our own shaped as the `methods!`
     table:
     - The programs that need Banda already have MCP servers, or their
       makers already know how to write one.
     - What MCP lacks is events, reading a Space's Threads, and acting as
       a Participant. It waits until a module needs it, with an ADR of its
       own. Until then a module's server writes nothing into Banda's
       records: a tool call is recorded as the Agent's.

5. **Banda signs in for the module, and keeps the secret.**
   - A server on the web signs in by MCP's authorization: OAuth 2.1 with
     PKCE, from the server's protected-resource metadata.
     - The engine runs it.
     - The sign-in page opens in Banda's browser, with the Person's
       profile, so a company's single sign-on finds its cookies.
     - It comes back to a loopback address the engine listens on.
   - A server that takes a key instead: the Person types the key once,
     in the module's row in the settings.
   - The secret is kept in the system's keyring (Secret Service on Linux,
     Keychain on macOS):
     - never in a file, in a Space or in a log;
     - an Agent never sees it, and neither does a view: a view's
       `tools/call` goes through the engine, which adds the token.
   - Signed out, or with a token that ran out:
     - the module's tools answer as refused, saying how to sign in;
     - its row in the settings says "Sign in".
   - One account per module on a machine. Several come when someone needs
     them.

6. **The module `modules`, of the machine, installs them and runs them.**
   - Its methods name no Space (ADR 0025, ADR 0040):
     - `modules.list`, `modules.install`, `modules.remove` and
       `modules.link`;
     - `modules.sign_in` and `modules.sign_out`;
     - `modules.call`, a view's call of its own tool.
   - Where things live:
     - An installed module's folder is in `~/.local/share/banda/modules/<id>/`.
       Each channel keeps its own, as it keeps its data (Banda Dev in
       `banda-dev`).
     - Which modules are on is in `~/.config/banda/modules.toml`. The
       Person writes it, an Agent with `banda settings set`, and the
       settings Pane in its Modules section, with the file under it.
   - `banda modules` (ADR 0022) lists them with ours. Each says
     `from-banda = false`, and `linked` when it runs from a folder of its
     own.
   - A Pane whose module is off or gone stays in its place. It says so,
     and offers to turn the module on or install it again.
   - Its `skill/` topics join the Banda skill while it is on. They are
     read from its folder when it is installed, not when Banda is built,
     and each topic is marked as that module's.
   - Its `[[actions]]` are in the Banda menu and the key sheet, and
     `keys.toml` binds them by id. An action `opens` one of its Panes.
     Other kinds of action come when a module needs one.

7. **Only the Person installs a module, and sees first what it gets.**
   - Any way in shows a card in the window:
     - `banda modules install <zip, folder or git URL>`, from the CLI or
       from an Agent;
     - a module's file opened with Banda.
   - Nothing is installed until the Person presses Install. An Agent may
     offer a module, never install one.
   - The card says, in plain words and from the manifest alone:
     - its name, author and version, and that it is not from Banda;
     - its views, in a frame, and the web addresses they load;
     - its tools for Agents, and how many;
     - the server it connects to;
     - for a `command`, that it runs a program on this computer with the
       Person's rights.
   - An update that adds a web address, a program or tools shows the card
     again, with what is new.
   - It stays open like Linux (ADR 0005, decision 13):
     - a `command` program is not sandboxed, and the card says so;
     - the frame is what keeps a view apart, not a gate on what a module
       may do.

8. **A module is shared as its folder: a zip or a git repository.**
   - `banda modules pack <id or folder>` writes `<id>-<version>.zip`, with
     `module.toml` at its root.
   - A git URL installs its tag `v<version>`, or its default branch when it
     has none.
   - Making one:
     - `banda modules new <id>` writes a folder to start from: a
       `module.toml`, one view in React with `@banda/ui` (on Vite), and a
       skill topic.
     - `banda modules check <folder>` names each mistake as
       `path:line:column`, as `banda settings check` does.
     - `banda modules link <folder>` turns it on from where it is, after
       the Person's yes, as an install. It loads its views again as their
       files change.
   - An Agent makes one the same way, by the skill topic `making-modules`.
     So "make us a game" ends as a module, not a loose file.
   - A Visual can become a module: "Keep as module" in its menu writes a
     folder with one Pane, its page, and links it.

9. **A catalog comes later, on the same folders.**
   - A catalog is a git repository with one entry per module: its id, its
     git URL, its version and the sha256 of its zip.
   - Ours is `0x1oceanlabs/banda-modules`. A Person adds others, as a
     company's own, in `modules.toml` (`catalogs = […]`).
   - The Banda menu gets a source, Modules, and the settings Pane's
     Modules section searches the catalogs. An install from either goes
     through decision 7.
   - Marks for the modules we have checked come with the catalog.

## Consequences

- **ADR 0005, decision 12, changes.** A module from elsewhere gives its
  tools through an MCP server, not a process on the engine API, and its
  Panes are React with `@banda/ui` inside a frame. Decision 13 holds.
  Decision 14 holds: `banda mcp` stays the one MCP server that Agents
  reach, and the engine is a client of the modules' servers.
- **ADR 0022 changes.**
  - Decision 1: a module from elsewhere declares its Panes and actions
    in its `module.toml`.
  - Decision 7: its "not now" becomes this ADR's steps. Loading window
    parts at run time stays out: a module from elsewhere has views in
    frames, not a window part.
- **ADR 0001, decision 10:** modules from elsewhere come now, on contract 1.
- **ADR 0037:** its frame, how it is served and the rules on what a frame
  says are shared with views. A tool's card is a view in the same frame.
- The kernel's tool list stops being fixed at start: it follows the
  modules that are installed and on.
- A Participant stays a Person or an Agent (`GLOSSARY.md`). A module's
  server acts in Banda only through an Agent's call.
- Words for `GLOSSARY.md`, as their behaviour is built: module from
  elsewhere, view, catalog. _Avoid_: plugin, extension, app. The entry
  for Module drops "plugin … later".
- `docs/architecture.md` gets the module `modules`, the views and where
  installed modules live.
- Issue #345: a page of the Person's opens as a module's view, not from
  `file://`.

## Steps

1. **This ADR.**
2. **A module with a Pane.** The module `modules`: `module.toml` read and
   checked, `~/.local/share/banda/modules`, `modules.toml`, and
   `banda modules link`, `check` and `--contract`. A view served at
   `app://<id>.module`, in its frame, with its actions and skill topics.
   Зорепад is the first module from elsewhere: kept in the repository as
   an example, and run by the window's tests.
3. **The bridge.** `@banda/module`, `ui/initialize` with the look passed
   live, `banda/pane.update` and `banda/pane.open`, and `ui/open-link`.
   `@banda/ui` goes to npm.
4. **Tools from a program.** `[mcp] command`, `modules.call`, the tools in
   `banda mcp` with `tools/list_changed`, rights from the tools' hints,
   and `tools/call` from a view. A fake MCP server runs in the tests.
5. **A server on the web.** `[mcp] url`, OAuth in Banda's browser, a key
   typed in the settings, and the keyring.
6. **Cards in the Thread.** A tool result that names a UI resource shows
   as a view in the Thread, with `ui/message` into the composer.
7. **Installing and sharing.** `banda modules install` and `pack`, the
   card, updates that show what is new, and the settings Pane's Modules
   section. Mocks come first.
8. **Agents make modules.** `banda modules new`, the skill topic
   `making-modules`, and "Keep as module" on a Visual.
9. **Catalogs.** The index repository, the Modules source in the Banda
   menu, and search in the settings.
