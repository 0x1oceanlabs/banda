---
status: accepted
date: 2026-11-03
---

# Banda keeps its problems, and shares them only when asked

On 2026-11-02 Banda's window drew only its glass desk, and did so on every start. An Agent had opened a browser with `open_pane` and args the browser Pane could not read. Its title threw, React took the whole page down, and the engine kept the args (fixed in #285). No part of Banda had recorded the problem anywhere:

- The page's error reached no file. To read it, the window had to be started again with `--remote-debugging-port`, and Playwright attached to it.
- The engine logs to stderr only (`tracing_subscriber::fmt`, `engine/src/main.rs`). Started from a desktop file, that output goes nowhere.
- Electron's crash on quit (SIGTRAP) left only a core dump in `systemd-coredump`, and a notice from Omarchy.

How Omarchy turns a crash into a report, read in its skill `diagnose-crash` (`/usr/share/omarchy/default/agents/skills/diagnose-crash/`):

- A notice "Process crashed: Click to diagnose with AI" starts the Person's agent with the skill.
- An issue is only for a verified bug. The Person sees the exact title and body and says yes first. The agent searches the issues first, closed ones too: a match that was closed as fixed is a regression.
- With no `gh` signed in, the agent does not install or sign it in. It hands the text over.

What PostHog takes, from its docs on 2026-11-03:

- Events go as JSON by HTTPS POST to `https://us.i.posthog.com/i/v0/e/` or `/batch/`, with the project's token, `event`, `distinct_id` and `properties` ([capture API](https://posthog.com/docs/api/capture)).
- `"$process_person_profile": false` stores an event with no person profile, under a random `distinct_id`.
- A problem is the event `$exception`, with `$exception_list` (each with `type`, `value` and `stacktrace.frames`) and an optional `$exception_fingerprint` that groups them ([manual error tracking](https://posthog.com/docs/error-tracking/installation/manual)).
- The project setting "Discard client IP data" stores no IP. GeoIP enrichment still reads the IP before it is dropped, unless the GeoIP transformation is turned off too ([data storage](https://posthog.com/docs/privacy/data-storage)).

The law, as far as it bears on this. It is not legal advice:

- An IP address is personal data under the GDPR (CJEU, C-582/14 Breyer, 2016).
- Storing an ID on the device for analytics needs consent in the EU, and a box ticked in advance is not consent (CJEU, C-673/17 Planet49, 2019).

What developers say of telemetry: Audacity met an outcry in 2021 for telemetry added without asking. Go proposed telemetry on by default in 2023, and after the discussion made it opt-in.

Roma, 2026-11-03:

- PostHog, in the US, where Roma's company has its account.
- The Person turns sharing on at first run, on a step of its own.
- "So that it is beautiful and respectful to the Person."
- No IP is kept: "there is no need to keep it".
- The repository opens (ADR 0038), so a Person's issue can go to it.
- The usage summary carries the system's language. The first-run funnel waits, as issue #314.
- The modules are `problems` and `sharing`.

## Decision

1. **A Problem is kept on the machine, by the module `problems`.**
   - A Problem is something that broke in Banda itself, not in the Person's work. A Turn that failed is not a Problem.
   - It comes from wherever Banda runs:
     - in the page: `window.onerror`, unhandled rejections, a tile's error boundary and the registry's guard (#285);
     - in the window's main process: its errors, and Electron's crash dumps from `crashReporter`, which uploads nothing;
     - in the engine: its panics.
   - The engine keeps them in its state folder, one record each, with a fingerprint: a hash of the error's type and its top frames in Banda's code. The same fault gives the same fingerprint on every machine, so it is counted once.
   - The engine and the window also write their logs to files there, kept by size.
   - `banda problems` lists them. `banda problems report <id>` writes one Problem's report: Banda's version, channel and system, the Problem, the last lines of the logs, and the shape of the workspaces with no args.
   - Settings shows the Problems, the newest first, each with where it broke, Copy report and the logs' folder. A dot marks the ones new since the section was last open.
   - A new Problem tells the Person, as a call does (ADR 0011) but silently (Roma, 2026-11-03: "a notification when there is a bug, so it gets fixed"). It shows a toast "Something broke in Banda" while the window is in front, or a system notification while it is not, and nothing while the desktop is quiet. A Problem that breaks again only counts. `problems = false` under `[notify]` in `look.toml` turns it off. Until step 3, its button is Details, which opens it in Settings.
   - `problems` sends nothing anywhere. The one exception is an issue the Person sends (decision 3).

2. **After two starts that broke, Banda offers to start without the workspaces.** A window that broke on what it restored, as on 2026-11-02, then opens empty. The workspaces stay in the engine, untouched, for the next start.

3. **An Agent looks into a Problem, and the Person sends the issue.**
   - A new Problem brings a Toast: "Something broke in Banda" with "Look into it". Nothing starts by itself: looking into it costs the Person's model.
   - "Look into it" opens a Thread with the Problem's report. The Banda skill's topic `problems` teaches the Agent the steps of Omarchy's skill: verify it is Banda's, search the issues by the fingerprint, closed ones too, and comment on a match rather than open a duplicate.
   - The Agent's tools are `problems` and `problem` to read, and `draft_issue` to propose a title and body.
   - The window then draws the draft as a card, "Send this report to Banda on GitHub?", with Send, Edit and Cancel. Sending is a command that needs `Decide`, so only the Person gives it. The yes is in Banda's code, not in the Agent's words (as in ADR 0029, decision 6).
   - With `gh` signed in, the engine files the issue. Without it, the browser opens GitHub's new-issue page with the title and body filled in.
   - The issue carries the fingerprint, and the issue template asks for it (ADR 0038, decision 5).

4. **`sharing` is the one part of Banda that sends anything anywhere.**
   - Its file `sharing.toml` has `problems = false` and `usage = false`, and Settings shows it (ADR 0016).
   - Nothing else in Banda calls PostHog. Since the source is open, anyone can check that.
   - It sends only from a released Banda, Stable or Dev. A run from a checkout, CI and the end-to-end tests never send, and `BANDA_SHARING=0` turns it off for one run.

5. **The Person is asked once, on a step of the first run of its own.**
   - "Help make Banda better?" offers two choices, "Send problem reports" and "Send usage counts". Neither is ticked, and there is one button, Continue: no "Accept all" and no buttons that push.
   - "See exactly what is sent" shows a real example of each event.
   - Banda never asks again. Settings is where the choice changes, with "Sent by Banda" and "New ID" beside it.

6. **Two events go, and the contract declares every field of each.**
   - **`$exception`**, for a Problem while `problems` is on, once per fingerprint, version and day:
     - its type and its message;
     - its frames, as Banda's files and lines, with no path outside the source;
     - Banda's version, channel and system.
   - **`day`**, while `usage` is on: one summary a day of the day before, about a kilobyte. The engine counts it from the events it already keeps (ADR 0002), from a list; it reads no other event, and no code to track anything is spread through Banda. It holds:
     - `version`, `channel`, `os`;
     - `locale` and the country in it, from the system's settings, such as `ru_UA`;
     - `threads`: the Threads started, by Harness;
     - `turns`: the number of Turns;
     - `panes`: the Panes opened, by kind;
     - `spaces` and `workspaces`: how many there are.
   - What never goes: a Thread's title or words, prompts, answers, paths, addresses, a Space's name, git, the time of day, the IP.
   - `docs/sharing.md` lists every event and field. It is written from the contract, as `engine/skill/modules.md` is, so it cannot drift.

7. **Nothing tells who or where the Person is.**
   - The `distinct_id` is a random UUID, made when the Person turns sharing on and erased when they turn it off. Turned on again, sharing gets a new one, so no history joins up.
   - Every event carries `"$process_person_profile": false`.
   - The PostHog project discards client IPs and has its GeoIP transformation turned off, so not even a city is derived. The country comes from the locale the Person chose.

8. **What is sent is kept on the machine first.** "Sent by Banda" shows each event's exact JSON, written before it goes. An event that cannot go waits, and is dropped after seven days.

9. **The frames can be read.** The release workflow uploads the page's source maps to PostHog, and the engine is built with line tables (`debug = "line-tables-only"`), so a Rust backtrace names its files and lines by itself.

## Consequences

- ADR 0038's README says "Banda sends nothing anywhere". It now says: nothing, unless the Person turns sharing on.
- PostHog holds Banda's token. It is public by design: anyone can send events with it, but no one can read them.
- A Person whose Agent has no `gh` still sends an issue, by hand, in the browser.
- Problem reports and the usage counts stay apart. Each is the Person's own choice, and each can be turned off on its own.

## Steps

1. **`problems`**: the record and its fingerprint, the logs in files, catching problems in the page, main and the engine, `crashReporter` with no upload, `banda problems`, and the Problems in Settings (decision 1).
2. **Starting without the workspaces** after two starts that broke (decision 2).
3. **The Agent's report**: the Toast, the skill's topic, the tools, the draft's card and Send, and the issue template's field (decision 3).
4. **`sharing` and problem reports**: the module and its file, the first run's step (a mock for Roma first), "Sent by Banda", `$exception`, and the source maps (decisions 4–9).
5. **The usage summary `day`** (decision 6).

Later: the first-run funnel, as its own step (#314).
