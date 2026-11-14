# Decisions

An ADR records one decision that is hard to undo, or that binds more than
one part. This page says when to write one, and lists every ADR by
subject, with whether it still binds.

## When to write one

Write an ADR for:

- a protocol, or a message between parts;
- a format kept on disk;
- a border: who may import, name or call whom;
- a right: what a Person, an Agent, an App or a machine may do;
- a rule that more than one part follows.

Everything else has its own place:

| What | Where it goes |
| --- | --- |
| A step of the work, or the order of the steps | The PR, and the plan's issue |
| How one part looks or behaves | The PR, the part's `README.md`, and its tests |
| Why a bug happened | The PR that fixes it |
| A plan | An issue |
| Evidence, with its source and limits | [`docs/research/`](../research/) |

A change that contradicts a **standing** ADR needs a new ADR first. The
new one names the decisions it changes, and its PR changes their rows
here.

## How to add one

1. Take the next free number. A number missing below is in an open PR,
   or was never merged: `gh pr list --search "docs(adr)"`.
2. Name which principle or story of
   [what we build](../what-we-build.md) it serves.
3. Add its row to the subject's table below, in the same PR.

An old ADR is not rewritten. Its row says what happened to it.

## The index

A row has one of four states:

- **standing**: it binds. The note names the decisions a later ADR
  changed, and what is not built yet.
- replaced: a later ADR took its place. Read that one.
- done: it recorded a step, or how one part looks or behaves, and that
  is built. The code and its tests say it now, and a change to it is an
  ordinary PR.
- proposed: Roma has not accepted it.

A session reads the standing ADRs of the subject it changes, and no
others.

### Kernel

The engine, its store, the contract, and where data lives.

| ADR | It says | State | Note |
| --- | --- | --- | --- |
| [0001](0001-one-engine-a-small-kernel-and-modules.md) | One engine owns the work; a small kernel and modules; windows only show | **standing** | changed by 0005, 0026 (5), 0003 (7), 0082 (3, 8), 0062 (modules become Apps) |
| [0002](0002-how-the-engine-writes-and-keeps-the-work.md) | How the engine writes and keeps the work | **standing** | decision 10 replaced by 0003; changed by 0082 (2), 0085 (6), 0003 (9), 0083 (1) |
| [0014](0014-the-contract-is-written-once-in-rust.md) | The contract is written once, in Rust | **standing** | changed by 0082 (1, call renamed query), 0062 (3) |
| [0026](0026-a-space-is-added-from-any-folder-as-a-project-is-in-t3-code.md) | A Space is added from any folder, as a project is in T3 Code | **standing** | Space renamed Project by 0069; lists follow kernel facts by 0127; Git URL (7) not built |
| [0046](0046-a-thread-starts-in-no-space-and-may-become-one.md) | A Thread starts in No Space, and may become a Space | **standing** | decision 2's grouping replaced by 0053; named No Project since 0069 |
| [0069](0069-a-space-is-called-a-project-and-the-person-archives-a-thread.md) | A Space is called a Project, and the Person archives a Thread | **standing** | decision 5 changed by 0096; Archive is a tab, not a shelf, by 0098 |
| [0086](0086-the-engine-is-the-machine-s-and-outlives-the-window.md) | The engine is the machine's, and outlives the window | **standing** | decision 1 amended by 0097; decision 6 built in 0119; Windows login start not built |

### Borders

Access, the fence, and how parts talk.

| ADR | It says | State | Note |
| --- | --- | --- | --- |
| [0032](0032-an-agent-sees-other-spaces-panes-when-its-person-lets-it.md) | An Agent sees other Spaces' Panes when its Person lets it | **standing** | decision 3 amended by 0062, 0065; decision 4 replaced by 0082; sees_others fate open |
| [0082](0082-parts-talk-in-four-kinds-of-message-and-every-hop-checks-access.md) | Parts talk in four kinds of message, and every hop checks access | **standing** | no home host or Person scope (0101); 11-14, 17 amended by 0124; also 0096, 0105, 0106 |
| [0083](0083-banda-keeps-its-own-state-out-of-an-agents-reach-and-only-the-persons-gesture-acts-as-the-person.md) | Banda keeps its own state out of an Agent's reach, and only the Person's gesture acts as the Person | **standing** | decision 1 suspended by 0115 (fence off); 7 amended by 0123; 1, 6, 8 by 0124 |
| [0084](0084-a-project-may-run-in-an-environment-of-its-own.md) | A Project may run in an environment of its own | **standing** | only step 1 built (the port, local adapter); boxes and isolation wait, by 0123 |
| [0115](0115-the-fence-is-off-until-it-is-designed-whole.md) | The fence is off until it is designed whole | **standing** | suspends 0083 decision 1 until a new ADR turns the fence on |
| [0123](0123-the-door-comes-with-the-session-that-follows-the-person-and-isolating-agents-waits.md) | The door comes with the session that follows the Person, and isolating Agents waits | **standing** | decisions 2, 4 amended by 0124 |

### Machines

Several machines, their doors, and what one draws of another.

| ADR | It says | State | Note |
| --- | --- | --- | --- |
| [0081](0081-banda-runs-on-several-machines-and-banda-cloud-only-connects-them.md) | Banda runs on several machines, and Banda Cloud only connects them | **standing** | 1, 9, 12 amended by 0101; 2-5, 8 by 0124; 12 by 0095; Cloud not built |
| [0095](0095-a-machine-names-itself-a-name-and-an-icon-and-no-colour.md) | A machine names itself: a name and an icon, and no colour | **standing** | decisions 1, 2, 9 amended by 0097; 7 by 0105, 0106 |
| [0097](0097-a-machine-stays-awake-while-its-agents-work-and-says-its-battery.md) | A machine stays awake while its Agents work, and says its battery | **standing** |  |
| [0101](0101-machines-are-peers-and-there-is-no-home-host.md) | Machines are peers, and there is no home host | **standing** | decision 7 amended by 0105 and 0106; 6 by 0120; 5 reworded by 0127; sync unbuilt |
| [0105](0105-honest-when-away-what-the-person-sees-while-a-machine-is-away-and-what-may-wait-for-it.md) | Honest when away: what the Person sees while a machine is away, and what may wait for it | **standing** | decisions 3, 5 amended by 0124; H5e rule amended by 0106 |
| [0106](0106-another-machine-s-panes-run-on-its-engine-and-this-device-only-draws-them.md) | Another machine's Panes run on its engine, and this device only draws them | **standing** | law 6 widened by 0124; decisions 3 and 9 amended by 0120 |
| [0116](0116-a-thread-moves-to-a-project-on-another-machine-and-the-device-carries-it.md) | A Thread moves to a Project on another machine, and the device carries it | **standing** | untouched; 0124 promises a later ADR for moving a Thread by the engines |
| [0120](0120-what-stage-2-left-for-another-machine-goes-by-the-roads-it-built.md) | What stage 2 left for another machine goes by the roads it built | **standing** | partly built: port forward and place_asked not in code yet |
| [0124](0124-every-client-reaches-every-machine-by-one-road-at-its-door-by-its-own-key.md) | Every client reaches every machine by one road: at its door, by its own key | **standing** | built through SE5; old ssh road stays until every machine has the door |

### Apps

Apps, their manifests, and the SDK.

| ADR | It says | State | Note |
| --- | --- | --- | --- |
| [0022](0022-a-module-declares-itself-in-its-code-and-a-short-module-toml.md) | A module declares itself in its code and a short module.toml | **standing** | module.toml became app.toml by 0062; changed by 0082 (1), 0071 (3), 0085 (1, 5) |
| [0062](0062-banda-is-a-kernel-a-platform-and-apps-built-on-one-sdk.md) | Banda is a kernel, a platform and Apps built on one SDK | **standing** | decisions 9, 13, 17, 18 amended by 0101; 4 and 14 by 0126 (proposed) |
| [0085](0085-apps-are-disposable-and-their-data-is-durable.md) | Apps are disposable, and their data is durable | **standing** | only decision 8 built; rename to threads, export, purge and move not built |
| [0126](0126-an-app-an-agent-writes-is-a-folder-and-a-worker-runs-it.md) | An App an Agent writes is a folder, and a worker runs it | proposed | amends 0062 decision 4 once accepted; apps.install already in code |

### Agents

Threads, turns, Harnesses, accounts, and what an Agent may do.

| ADR | It says | State | Note |
| --- | --- | --- | --- |
| [0003](0003-claude-code-and-codex-in-a-thread.md) | Claude Code and Codex in a Thread | **standing** | changed by 0004, 0043 (4), 0103 (6), 0006, 0083 (9, 10), 0082 (11) |
| [0004](0004-signing-in-to-a-harness-in-the-ways-it-offers.md) | Signing in to a Harness in the ways it offers | **standing** | decision 5 changed by 0043; key accounts added by 0078; decision 2 was temporary |
| [0006](0006-a-thread-is-a-session-with-no-agent-to-manage.md) | A Thread is a session, with no Agent to manage | **standing** | decision 1 replaced by 0078; changed by 0102 (2), 0083 (3) |
| [0012](0012-the-banda-skill-is-a-module-that-grows-by-topics.md) | The Banda skill is a module that grows by topics | **standing** | MCP hand-over of the core changed by 0037 decision 7 |
| [0018](0018-a-turns-life-is-one-state-machine.md) | A turn's life is one state machine | done | built as rules::next and one writer in the agents engine |
| [0019](0019-an-agent-works-with-threads-as-a-person-does.md) | An Agent works with Threads as a Person does | **standing** | changed by 0037 (3), 0083 (2), 0032, 0109 (5); 0062 gateway for 1 not built |
| [0027](0027-a-thread-is-edited-from-a-message-and-forked-from-a-reply-as-in-t3-code.md) | A Thread is edited from a message and forked from a reply, as in T3 Code | **standing** | decisions 1, 3, 4 amended by 0103 for sub-agents |
| [0037](0037-an-agent-shows-a-visual-in-its-thread-as-in-t3-code.md) | An Agent shows a Visual in its Thread, as in T3 Code | **standing** | decision 8's app://files moved to Files by 0073 |
| [0040](0040-the-harnesses-are-the-machine-s-and-the-threads-are-a-space-s.md) | The Harnesses are the machine's, and the Threads are a Space's | **standing** | decisions 1, 3 amended by 0082; decision 6 by 0084 |
| [0057](0057-an-agent-says-what-its-done-toast-tells.md) | An Agent says what its Done toast tells | **standing** |  |
| [0059](0059-banda-carries-the-adapters-and-the-person-brings-the-agents.md) | Banda carries the adapters, and the Person brings the Agents | **standing** | decision 1 amended at 0062 step S1; 0084 adds the case of a box |
| [0074](0074-the-person-snoozes-a-thread-until-a-time-or-until-it-is-done.md) | The Person snoozes a Thread until a time, or until it is done | **standing** | Snooze is Later, a tab, by 0098 (decisions 1, 6); decision 2 changed by 0096 |
| [0077](0077-the-person-names-a-thread-and-its-harness-s-small-model-suggests-the-name.md) | The Person names a Thread, and its Harness's small model suggests the name | **standing** | decision 2 amended by 0118; 5 and 6 changed by 0087; seen moved by 0096 |
| [0078](0078-a-thread-moves-between-accounts-and-harnesses-and-keeps-its-history.md) | A Thread moves between accounts and Harnesses, and keeps its history | **standing** | decisions 8, 9 replaced and 6, 10 amended by 0093; 4, 5 amended by 0103 |
| [0093](0093-an-account-has-an-emblem-the-person-picks-and-a-new-thread-has-a-fallback-account.md) | An account has an emblem the Person picks, and a new Thread has a fallback account | **standing** | replaces 0078 decisions 8, 9; extended to the CLI by 0104 |
| [0096](0096-seen-and-archive-are-thread-data-on-its-host.md) | Seen and archive are Thread data on its host | **standing** | decisions 4 and 8 changed in place on 2026-11-09 |
| [0103](0103-a-harness-s-sub-agents-work-in-their-thread-and-a-crew-shows-beside-it.md) | A Harness's sub-agents work in their Thread, and a Crew shows beside it | **standing** | built; Banda only shows sub-agents and Crews, stops none (amended inside) |
| [0104](0104-agents-manage-accounts-through-the-engines-account-contract.md) | Agents manage Accounts through the engine's Account contract | **standing** | decision 4 and Delivery amended by 0108; discovery extended by 0105 (Omarchy) |
| [0105](0105-omarchy-s-installed-harnesses-and-accounts-are-discovered.md) | Omarchy's installed Harnesses and Accounts are discovered | **standing** | built; account IDs and the [omarchy] settings keys are kept on disk |
| [0108](0108-an-account-has-one-door-on-its-own-machine.md) | An Account has one door, on its own machine | **standing** | amends 0104 decision 4; built as accounts/ in harnesses |
| [0109](0109-banda-sets-no-limits-on-agents-and-a-person-s-stop-always-ends.md) | Banda sets no limits on Agents, and a Person's Stop always ends | **standing** | decision 4, the Stop that ends after a minute, not built yet |
| [0118](0118-a-new-thread-is-named-once-after-its-first-turn.md) | A new Thread is named once, after its first turn | done | amends 0077 decision 2 |
| [0122](0122-an-agent-knows-which-machine-its-person-writes-from.md) | An Agent knows which machine its Person writes from | **standing** |  |

### The Thread

The Thread's Pane and the Message box, as the Person sees them.

| ADR | It says | State | Note |
| --- | --- | --- | --- |
| [0010](0010-the-thread-pane-reads-as-t3-codes.md) | The Thread Pane reads as T3 Code's | done | decision 5 replaced by 0058; 8 amended by 0094; edit and fork came with 0027 |
| [0015](0015-the-composer-is-a-prompt-editor-as-in-t3-code.md) | The composer is a prompt editor, as in T3 Code | done | its look changed by 0031 |
| [0031](0031-the-composer-is-a-quiet-card-as-in-t3-code.md) | The composer is a quiet card, as in T3 Code | done | decisions 3, 6 since changed by 0114; Ultracode label by 0103 |
| [0051](0051-thread-web-links-open-in-banda.md) | A Thread's web links open in Banda | done |  |
| [0058](0058-the-thread-reads-as-a-quiet-document.md) | The Thread reads as a quiet document | done | decisions 4 and 8 amended by 0103 |
| [0063](0063-paths-notes-and-a-right-click-work-in-the-thread.md) | Paths, notes and a right click work in the Thread | done | decision 6 Run amended by 0106 |
| [0091](0091-the-thread-is-built-from-entries-and-lines-each-in-a-file-of-its-own.md) | The Thread is built from entries and lines, each in a file of its own | done | code layout of the Thread Pane: entries, lines, context; a border test holds it |
| [0094](0094-a-thread-opens-where-what-the-person-has-not-seen-begins.md) | A Thread opens where what the Person has not seen begins | done | three scroll rules, each held by a window test |
| [0114](0114-a-new-thread-says-whom-it-writes-to-and-where-and-the-message-box-says-who-and-how.md) | A new Thread says whom it writes to and where, and the Message box says who and how | done | start phrase, who and how pickers, agents.toml [models]; amends 0031 decisions 3, 6 |

### The window

The Tiling, the sidebar, the bar, the menu, the keys, Settings, and the client.

| ADR | It says | State | Note |
| --- | --- | --- | --- |
| [0005](0005-a-hackable-tiling-workspace.md) | A hackable tiling workspace: one list of actions, calm tiles, modules on an open contract | **standing** | changed by 0025 (3, 5), 0026 (6), 0098 (8), 0024 (9), 0068 (10), 0062 (12, 13) |
| [0008](0008-the-sidebar-is-arranged-by-a-file.md) | The sidebar is arranged by a file: presets, defaults, and the Person's own keys | **standing** | sidebar.toml stays; rows, states, presets (4, 5) replaced by 0098; view menu moved by 0067 |
| [0009](0009-banda-sounds-when-the-work-calls.md) | Banda sounds when the work calls for its Person | done | played by the notifications module since 0056 |
| [0011](0011-banda-calls-its-person-where-they-look.md) | Banda calls its Person where they look | **standing** | changed by 0087, 0096 (1), 0048, 0056 (2), 0086 (3, 6), 0079 (5) |
| [0016](0016-settings-is-a-window-that-edits-the-files.md) | Settings is a Pane that edits the files | **standing** | built as a Pane; decision 5 changed by 0083; start defaults moved by 0040 |
| [0017](0017-alt-space-opens-the-banda-menu.md) | Alt+Space opens the Banda menu: one place to find and run everything | done | decision 3 changed by 0067 and 0098; sources (step 5) built by 0022 |
| [0020](0020-the-windows-main-process-is-written-in-effect.md) | The window's main process is written in Effect | **standing** | its rules are in AGENTS.md; bridge table added by 0028 |
| [0024](0024-the-bar-is-quiet-and-modules-put-widgets-on-its-right.md) | The bar is quiet, and modules put widgets on its right | **standing** | changed by 0043 (4, 5.2), 0044 (5.3), 0064 (4), 0087 (3), 0035 (middle), 0076 (5.4) |
| [0025](0025-the-workspaces-live-in-the-engine-and-the-mouse-works-them-as-niris.md) | The workspaces live in the engine, and the mouse works them as niri's | **standing** | changed by 0062, 0101 (1), 0065 (columns), 0079, 0102 (flow), 0052, 0054 (overview) |
| [0028](0028-the-desktop-bridge-is-one-table.md) | The desktop bridge is one table | **standing** | decisions 1, 4 changed by 0089: the table lives in client/desktop |
| [0035](0035-the-bar-s-middle-counts-who-waits-and-who-works.md) | The bar's middle counts who waits and who works | done | decision 3's order changed by 0087; now the bar widget sidebar.counts |
| [0048](0048-the-toasts-are-sonner-s-and-a-bell-shows-the-last-ones-again.md) | The toasts are Sonner's, and a bell shows the last ones again | done | decision 2 dropped and telling moved to the notifications module by 0056 |
| [0053](0053-no-space-threads-follow-the-sidebar-preset.md) | No Space Threads follow the sidebar preset | done | changed 0046 decision 2; No Space is called No Project since 0069 |
| [0054](0054-the-selected-pane-keeps-its-frame-through-the-overview-zoom.md) | The selected Pane keeps its frame through the overview zoom | done | changed 0025 decision 7 |
| [0056](0056-the-notifications-module-tells-the-person.md) | The notifications module tells the Person | **standing** | decision 1: who is told moves to the host per 0062 and 0081, not moved yet |
| [0064](0064-the-bar-s-widgets-move-with-alt.md) | The bar's widgets move with Alt | done | Alt here is the mod since 0068 |
| [0065](0065-columns-group-the-deck-moves-to-alt-t-and-an-agents-panes-are-its-group.md) | Columns group, the Deck moves to Alt+T, and an Agent's Panes are its Group | **standing** | decision 9 changed by 0079, 0087 and 0102; decision 7 extended by 0134 |
| [0066](0066-the-pane-header-is-banda-s-with-a-capsule-and-the-pane-menu.md) | The Pane header is Banda's, with a capsule and the Pane menu | **standing** | decision 4 changed by 0077; decision 6 header in the manifest partly built |
| [0067](0067-the-sidebar-s-foot-holds-settings-keys-theme-and-view.md) | The sidebar's foot holds the settings, the keys, the theme and the view | done | decisions 3 and 4 (header, foot) amended by 0098 decisions 19 to 21 |
| [0068](0068-the-mod-is-the-person-s-and-every-key-shows-as-it-is-pressed.md) | The mod is the Person's, and every key shows as it is pressed | **standing** | decision 2: the look makes the keys real since 0071 |
| [0070](0070-a-project-has-a-sign-found-in-its-folder-or-picked-by-hand.md) | A Project has a sign, found in its folder or picked by hand | done | sign kept by the engine in project.json |
| [0071](0071-every-key-is-an-action-s-and-the-person-an-agent-and-an-app-bind-it-alike.md) | Every key is an action's, and the Person, an Agent and an App bind it alike | **standing** | decision 2 changed by 0087; 0127 lets an Agent run actions, not only bind |
| [0079](0079-the-flow-is-free-row-or-solo-and-alt-u-follows-the-sidebar.md) | The Flow is free, a row or solo, and Alt+U follows the sidebar | done | Flow built; solo changed by 0102, 0127; Flow split by 0087; its menu moved by 0098 |
| [0087](0087-the-window-holds-the-areas-the-tiling-the-panes-and-here-is-their-context.md) | The Window holds the areas, the Tiling the Panes, Apps fill them, and Here is their context | **standing** | 1, 10 amended by 0101; 12 by 0096; placing built by 0110, 0127; plan unfinished |
| [0089](0089-desktop-web-and-phone-share-one-client-core.md) | Desktop, web and phone share one client core | **standing** | decision 6 changed by 0096, 0101; 2, 9 amended by 0106; 8 by 0101, 0103 |
| [0098](0098-the-sidebar-is-the-persons-inbox-of-their-agents-work.md) | The sidebar is the Person's inbox of their Agents' work | **standing** | amended in place 2026-11-12 to 14: no search, no New Thread; decision 3 by 0107 |
| [0099](0099-the-mark-says-whose-turn-it-is-and-what-the-agent-does.md) | The Mark says whose turn it is and what the Agent does | **standing** | decisions 2, 3, 11 amended by 0103; 10 by 0107; 4 by 0117 |
| [0102](0102-in-the-row-and-solo-a-project-has-its-own-workspace-and-free-workspaces-hold-the-rest.md) | In the row and solo, a Project has its own workspace, and free workspaces hold the rest | **standing** | decisions 3.2, 3.3, 4 changed by 0134 (own Group goes); placing carried out by 0110 |
| [0110](0110-where-a-pane-opens-is-one-rule-in-the-workspaces-module.md) | Where a Pane opens is one rule, in the `workspaces` module | **standing** | open question answered by 0134; decision 10 carried on by 0127 |
| [0127](0127-the-window-shows-and-asks-and-each-thing-has-one-place.md) | The window shows and asks, and each thing has one place | **standing** | six rules in docs/window.md; decision 6 intent and per-device arrangement not built yet |
| [0134](0134-a-thread-s-group-holds-what-its-thread-opens-and-the-person-s-keys-open-beside-it.md) | A Thread's Group holds what its Thread opens, and the Person's keys open beside it | **standing** | changes 0102 decisions 3, 4 and 0065 decision 7; BANDA_PANE not built yet |

### One App each

The browser, the terminal, Files, Git, pull requests, problems, usage.

| ADR | It says | State | Note |
| --- | --- | --- | --- |
| [0013](0013-the-browser-is-chromium-in-a-pane.md) | The browser is Chromium in a Pane, for the Person and every Agent | **standing** | changed by 0029 (3), 0083 (2, 7), 0060 (8), 0068, 0071 (5), 0088 (1) |
| [0029](0029-an-agent-drives-a-tab-with-banda-s-own-tools-beside-its-thread.md) | An Agent drives a tab with Banda's own tools, beside its Thread | **standing** | decision 1 reversed by 0083, pages to host by 0062; dialogs 0060; handoff card 0049 |
| [0034](0034-development-is-modules-in-panes-beside-the-thread-as-in-t3-code.md) | Development is modules in Panes beside the Thread, as in T3 Code | **standing** | decision 5 replaced by 0073; 2 amended by 0082; 3 by 0083, 0084; steps 7, 9 not built |
| [0039](0039-banda-keeps-its-problems-and-shares-them-only-when-asked.md) | Banda keeps its problems, and shares them only when asked | **standing** | telling goes through 0056's notifications; first-run funnel not built |
| [0043](0043-the-bar-shows-how-much-of-the-limits-is-spent-and-a-pane-counts-the-usage.md) | The bar shows how much of the limits is spent, and a Pane counts the usage | **standing** | decision 2: host reads the token (0062, 0082); decisions 5, 6 changed by 0055 |
| [0044](0044-the-bar-shows-the-servers-started-in-banda.md) | The bar shows the servers started in Banda | **standing** | decision 3 amended by 0084 for isolated Projects |
| [0047](0047-the-terminal-has-its-own-file-and-writes-in-jetbrains-mono-off-linux.md) | The terminal has its own file, and writes in JetBrains Mono off Linux | done | terminal.toml, JetBrains Mono shipped, box glyphs drawn |
| [0049](0049-the-handoff-card-sits-at-the-foot-of-the-page.md) | The handoff card sits at the foot of the page | done |  |
| [0055](0055-the-limits-widget-has-looks-and-usage-counts-by-account.md) | The limits widget has looks, and Usage counts by account | done | decision 1 accounts and decision 4 colours changed by 0078 and 0093 |
| [0060](0060-the-browser-owns-its-page-dialogs.md) | The browser owns its page dialogs | done | amended 0013 no-preload rule and 0029 decision 3; before-unload left out |
| [0061](0061-agents-can-request-bounded-browser-screenshots.md) | Agents can request bounded browser screenshots | **standing** |  |
| [0073](0073-files-is-a-finder-with-quick-look-for-any-folder.md) | Files is a Finder with Quick Look, for any folder | **standing** | decision 9 amended by 0103; 5, 10, 13 by 0106; 10 by 0120 |
| [0076](0076-a-thread-s-pull-requests-are-watched-and-the-bar-shows-whose-turn-it-is.md) | A Thread's pull requests are watched, and the bar shows whose turn it is | **standing** | links, reader and widget built; Auto-fix watch not built yet |

### Look

Themes, glass, tokens, Banda UI, and motion.

| ADR | It says | State | Note |
| --- | --- | --- | --- |
| [0007](0007-the-look-a-palette-from-omarchy-and-the-tiles-in-one-file.md) | The look: a palette from Omarchy, and the tiles' gaps, borders and motion in one file | **standing** | changed by 0080 (2, 7), 0075 (8), 0088 (9), 0100, 0083 (10); step 6 dropped |
| [0023](0023-a-glass-desk-that-banda-draws-and-tiles-that-float-over-it.md) | A glass desk that Banda draws, and tiles that float over it | done | glass source changed by 0030; tile opacity and gaps by 0075 |
| [0030](0030-the-glass-is-the-systems-on-macos-and-windows-and-banda-draws-it-on-linux.md) | The glass is the system's on macOS and Windows, and Banda draws it on Linux | **standing** | decision 1 extended by 0111 (density measured over the wallpaper) |
| [0036](0036-shadcn-on-glass-is-the-texts-own-colour-thinned.md) | shadcn on glass is the text's own colour, thinned | done | values are now the defaults of 0080's glass tokens |
| [0052](0052-the-overview-takes-the-desk-s-material-and-theme.md) | The overview takes the desk's material and theme | done |  |
| [0075](0075-three-themes-macos-omarchy-and-banda-each-bring-their-shape.md) | Three themes, macOS, Omarchy and Banda, each bring their shape | done | decisions 2, 6, 7 changed by 0080, itself amended by 0100 |
| [0080](0080-a-theme-extends-another-and-says-little-and-every-client-draws-the-same-tokens.md) | A theme extends another and says little, and every client draws the same tokens | **standing** | 1, 4, 8, 9, 10, steps amended by 0100; 1 by 0101; 6, 7 by 0113 |
| [0088](0088-motion-runs-on-the-compositor-and-content-takes-its-size-once.md) | Motion runs on the compositor, and content takes its size once | **standing** | 1, 2 amended and 9 replaced by 0117; 11 amended by 0101; later steps not built |
| [0100](0100-the-look-splits-in-three-and-each-platform-has-a-banda-theme-that-follows-it.md) | The look splits in three, and each platform has a Banda theme that follows it | **standing** | decisions 1, 2, 5 amended by 0101; 8 by 0111; theme.css not built yet |
| [0107](0107-a-working-mark-takes-the-group-plate-s-blue-muted.md) | A working Mark takes the Group plate's blue, muted | done |  |
| [0111](0111-the-desk-s-density-is-measured-over-the-wallpaper-banda-draws.md) | The desk's density is measured over the wallpaper Banda draws | done | Linux only; amends 0100 decision 8 and adds to 0030 decision 1 |
| [0113](0113-banda-ui-is-one-vocabulary-the-window-and-every-app-draw-with.md) | Banda UI is one vocabulary the Window and every App draw with, and a check holds it | **standing** | check and names built; catalogue page and the SDK parts (decision 12) not built yet |
| [0117](0117-what-loops-forever-steps-twelve-times-a-second.md) | What loops forever steps twelve times a second | **standing** | supersedes 0088 decision 9; changes the gates of 0088 and 0099 |

### Release

Shipping, updates, the licence, and banda.so.

| ADR | It says | State | Note |
| --- | --- | --- | --- |
| [0033](0033-banda-ships-as-stable-and-dev-for-linux-and-macos.md) | Banda ships as Stable and Dev, for Linux and macOS | **standing** | decisions 3, 4 replaced by 0092; 6 amended by 0121; 8 by 0059; updates 0119 |
| [0038](0038-banda-is-open-source-under-apache-2-0.md) | Banda is open source under Apache-2.0 | **standing** |  |
| [0041](0041-banda-updates-itself-and-says-so-on-the-bar.md) | Banda updates itself, and says so on the bar | replaced | by 0119 (updates module); widget by 0072 and 0131 |
| [0045](0045-banda-dev-updates-now-from-the-bar.md) | Banda Dev updates now, from the bar | done | Dev's Update now; waits for Threads since 0072, moved by 0119 |
| [0072](0072-the-update-names-its-version-waits-for-the-threads-and-says-it-updated.md) | The update names its version, waits for the Threads, and says it updated | done | decisions 1, 4, 5 changed by 0092; 3 by 0106; 5 by 0131; moved by 0119 |
| [0092](0092-every-merge-is-a-banda-dev-banda-is-promoted-from-it-once-a-day-and-one-number-names-both.md) | Every merge is a Banda Dev, Banda is promoted from it once a day, and one number names both | **standing** | decision 12 (updates) moved to the engine by 0119 |
| [0119](0119-each-machine-updates-its-own-banda-in-one-updates-module.md) | Each machine updates its own Banda, in one `updates` module | **standing** | decisions 2, 3, 7 amended by 0131; Mac app part built by 0121 |
| [0121](0121-a-mac-s-banda-updates-its-app-through-brew-until-it-is-signed.md) | A Mac's Banda updates its app through brew, until it is signed | done | temporary: goes once the Mac app is signed with a Developer ID |
| [0128](0128-banda-so-is-a-static-astro-site-on-vercel-drawn-with-banda-ui.md) | banda.so is a static Astro site on Vercel, drawn with Banda UI | **standing** | decision 4 replaced by 0130; 1 amended by 0133; 3 set aside for home by 0129 |
| [0129](0129-banda-so-s-home-is-a-gallery-wall-and-a-night-desk.md) | banda.so's home is a gallery wall and a night desk | done |  |
| [0130](0130-vercel-builds-banda-so-from-the-repository-root.md) | Vercel builds banda.so from the repository's root | done | decision 2 narrowed by 0133 |
| [0131](0131-updates-are-one-quiet-list-and-banda-update-is-a-program-of-its-own.md) | Updates are one quiet list, and `banda-update` is a program of its own | **standing** | amends 0119 and 0072; step 4, the app's own update, not built yet |
| [0133](0133-banda-so-counts-its-visits-with-vercel-and-builds-from-what-it-reads.md) | banda.so counts its visits with Vercel, and builds only from what it reads | done | Vercel Web Analytics; build list narrowed to files the site reads |
