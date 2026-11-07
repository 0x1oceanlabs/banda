---
status: accepted
date: 2026-11-03
---

# The bar shows how much of the limits is spent, and a Pane counts the usage

ADR 0024, decision 5.2, planned `agents.limits`: how much of each Harness's usage limit is spent, on the bar's right. Roma, on 2026-11-03, asked to start the widgets with it: "we can take after Omarchy and T3. T3 goes very deep, a whole system that counts usage. We can take that as a separate module, a Pane, and a simple widget as Omarchy's, with quick stats."

**What Omarchy does** (4.0.0.alpha, `shell/plugins/agents` and `bin/omarchy-agent-usage-*`, read on 2026-11-03):

- A collector per provider writes a JSON file; the widget only reads the files.
  - Claude: it reads Claude Code's access token from `~/.claude/.credentials.json` and asks `GET https://api.anthropic.com/api/oauth/usage` with `anthropic-beta: oauth-2025-04-20`. It never renews the token.
  - Codex: it starts `codex app-server` and asks `account/rateLimits/read`; Codex reads its own sign-in.
- It reads every 15 minutes, as Anthropic readily answers 429. It keeps the last good answer with when it was read, and a window whose reset has passed comes back at 0%.
- The bar shows one icon and no number; it turns urgent from 90%. Its panel has a row per window: the name, a meter, the time to the reset. The share is only in the tooltip.

**What T3 Code does** (commit `c8a601c0`, read on 2026-11-03):

- It keeps two things apart:
  - **limits**, a share used per window of a subscription, read from the providers: Claude through the Agent SDK's `get_usage`, Codex through the app-server;
  - **usage**, tokens and cost, counted from the Harnesses' own session journals on the machine and priced from LiteLLM's table, shown as an API estimate.
- A limit's bar has a mark where even spending would be by now, and says "Ahead of pace", "On pace" or "Under pace".
- Its Usage page has Limits, Cost and Tokens, over 24 hours to 90 days: a large figure, a row per provider, a chart a day, and a table by model.

**What Banda has now.** The Claude adapter passes `_claude/rateLimit` on a turn, and the engine keeps only its reset, and only once the limit is reached (`failure.rs`). Codex's limits never reach Banda: `codex-acp` keeps them to itself. The bar has no widgets yet: `defineModule` has no `bar` list (ADR 0024, step 2).

**A third way for Claude was tried.** Claude Code's CLI answers the `get_usage` control request on its stream-json input, the Agent SDK's way, without a turn: the CLI reads its own sign-in, and the answer is the same as the OAuth endpoint's. Anthropic marks the request as experimental.

Roma looked at a mock of the widget, its popover and the Pane on 2026-11-03, and decided:

- Claude's limits come from the token in its file, as Omarchy reads them.
- The widget is only a ring.
- The share is what is spent, not what is left.
- The Pane counts from the machine's journals, as T3 does.

## Decision

1. **The limits are the machine's, and the module `harnesses` reads them** (ADR 0040). They belong to a Harness entry, not a Space: a second account is a second entry with its own configuration folder (ADR 0003, decision 4), so each entry has its own limits.
   - A read gives, per entry: the plan (`Max 20x`, `Pro`), the windows, when it was read, and why the last read failed, if it did.
   - A window has an ID, a kind (`session`, `weekly`, `monthly` or `other`), a label (`Session`, `Weekly`, `Weekly · Fable`), the share spent from 0 to 100, when it resets, and how long it lasts.

2. **Claude Code's limits come from its own sign-in.**
   - Banda reads the access token where Claude Code keeps it: `claudeAiOauth.accessToken` in `.credentials.json` under the entry's configuration folder (`CLAUDE_CONFIG_DIR`, by default `~/.claude`) on Linux and Windows, and the Keychain item `Claude Code-credentials` on macOS. The Keychain asks the Person once to let Banda read it.
   - It asks `GET https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer`, `anthropic-beta: oauth-2025-04-20` and a timeout of 10 seconds, and follows no redirect.
   - **The window's main reads it and asks, not the engine** (amended at step 3, 2026-11-04). The engine holds no TLS of its own, and main reaches the network as sharing's posts do (ADR 0039, decision 8). The engine asks main with the entry's folder and gets back what Anthropic answered, with the plan the sign-in names, and never the token. So a read of Claude Code's limits waits for an open window. A folder other than `~/.claude` has its own Keychain item on macOS, `Claude Code-credentials-` and the first 8 hex digits of the folder's SHA-256. _Amended again at ADR 0062's step S1, 2026-11-07: the engine reads it on its host and asks, as no client reads the host's disk (ADR 0062, decision 3). It asks with the system's certificates and proxy, follows no redirect, and needs no window._
   - `five_hour` is `Session`, `seven_day` is `Weekly`, and each entry of `limits` with a model in its scope is that model's week (`Weekly · Fable`). `utilization` is already a share out of 100.
   - **The token is read for that one request.** Banda keeps it nowhere, writes it in no log or Problem (ADR 0039), sends it nowhere else, and never renews it: Claude Code renews its own sign-in as it runs.
   - An expired token keeps the last limits and says "Claude Code renews its sign-in on its next turn". A 401 says the sign-in expired. A 429 keeps the last limits and waits 15 minutes.
   - **This changes ADR 0003, decision 4, and ADR 0004, decision 5.** "Banda reads none of the Harness's credential files" becomes: Banda reads one, Claude Code's access token, for its limits only. Tokens still never pass through Banda to anything else, and Banda keeps none.
   - The CLI's `get_usage` was weighed and not taken. It stays the way to go if Anthropic changes the endpoint.

3. **Codex's limits come from its app-server.** The engine starts the entry's `codex app-server`, with its CLI and its `CODEX_HOME`, and asks `initialize`, then `account/rateLimits/read`, and `account/read` for the plan when the limits name none, each with a timeout of 8 seconds. It stops the process after. Codex reads its own sign-in. A window of 300 minutes is `Session`, of 10,080 `Weekly`. An account signed in with an API key has no limits.

4. **The limits are read every 15 minutes while a window listens**, and also:
   - as the engine starts;
   - after `harnesses.account_changed` (ADR 0040), as the account may be another;
   - when a window asks, as its popover opens, but no more than once a minute for each Harness.

   The last read is kept in the machine's store, with when. A window whose reset has passed shows 0% until the next read. A failed read keeps the last one, and says how old it is and why.
   - `harnesses.limits` answers them. `harnesses.limits_changed`, on the machine's log, says whose changed, and the window asks again.
   - It is a tool too (ADR 0019), so an Agent knows how much is left before a long task.

5. **The widget `harnesses.limits` is only a ring**, on the bar's right (ADR 0024, decision 2).
   - The ring fills with the share spent of the fullest window of every Harness, in the bar's muted text. It is `--warning` from 80% and `--destructive` at 100%.
   - It draws nothing while no Harness has limits: none signed in, an API key, or reading turned off.
   - It is dimmed while the last read failed and is older than half an hour.
   - The line on hover says every window in short: "Claude Code: Weekly 74% used, resets in 2d 17h · Codex: Weekly 4% used".
   - A click opens its popover:
     - for each Harness, its logo, its name and its plan;
     - a row for each window: its label, a bar with a mark where even spending would be by now, the share spent, and the time to its reset, "back in 2h 14m" once it is spent;
     - under a Harness whose week runs faster than the week goes, when it runs out at this pace: "At this pace the week runs out Thu 00:00, a day before it resets";
     - today's tokens, prompts and Threads, once the Pane counts them (decision 6);
     - when they were read ("Read 2 min ago") or why the last read failed, and "Usage", which opens the Pane.

6. **The Pane `harnesses.usage`, "Usage", counts it all**, as T3 Code's page does.
   - **Limits, Cost and Tokens**, and for the last two a period: 24 hours, 7, 30 or 90 days.
     - Limits: a card for each window, with the share spent in large type, the bar with its mark, "Ahead of pace", "On pace", "Under pace" or "Out", and when it resets.
     - Cost: the sum in large type, named an API estimate, which is what the tokens would cost through the API and not what the plan costs; a row for each Harness with its share and its sessions; a chart of each day by Harness; and a table by model.
     - Tokens: the same in tokens, parted into input, cache read, cache write and output.
   - **It counts from the Harnesses' own session journals on this machine**, every session, in Banda or not:
     - Claude Code: `projects/**/*.jsonl` under its configuration folder, the lines of the assistant with `message.usage`, each counted once by `message.id` and `requestId`, since every part of a message repeats it;
     - Codex: the `token_count` events under `CODEX_HOME/sessions`, whose input already holds the cached part.
   - It reads each file from where it last stopped, and keeps the sums by day, Harness and model in the machine's store, for 92 days.
   - **The prices are a table Banda carries**, made from LiteLLM's at build time and new with each release. A cost a journal records is taken over it, and a model with no price says "Unpriced". Nothing is fetched to price them, so nothing new leaves the machine (ADR 0039).
   - The popover's "Usage" opens it, and the action `harnesses.usage` from the Banda menu.

7. **`[limits]` and `[usage]` in `harnesses.toml` change them**, as the file is the module's (ADR 0040). Every key is optional:

   ```toml
   [limits]
   read = true    # false: Banda reads no token and asks for no limits
   every = "15m"  # how often, while a window listens
   warn = 80      # the share the ring turns --warning at

   [usage]
   read = true    # false: Banda reads no session journals, and the Pane counts nothing
   ```

   The settings Pane shows them from the schema (ADR 0016).

**Not now.** A number beside the ring, or a ring for each Harness; T3's reset credits and their "Use reset"; going on with another Harness when one runs out, or going on by itself at the reset; the limits of several machines summed; the cost of each Thread in the Pane; Harnesses other than Claude Code and Codex.

## Consequences

- ADR 0024, decision 5.2, is this ADR's. Its widget is `harnesses.limits`, not `agents.limits`.
- ADR 0003, decision 4, and ADR 0004, decision 5, read one credential for the limits (decision 2).
- `GLOSSARY.md` gets **Limit** and **Usage**; **Sign-in** says that Banda reads Claude Code's token for its limits.
- A Turn that fails on a limit could take its reset from the limits once they are read. That is not this ADR's work.

## Steps

Each step is its own PR.

1. This ADR.
2. The bar's widgets: `bar` in `defineModule`, and `left`, `center` and `right` in the look's `[bar]`. The counts become the first widget of the middle, and the update the first of the right (ADR 0024, step 2).
3. The engine reads the limits: Claude Code and Codex, kept with when, `harnesses.limits` with its tool and its event, and `[limits]`. It waits for the module `harnesses` (ADR 0040, step 3).
4. The widget and its popover, as the mock of 2026-11-03 shows them.
5. The engine counts the usage: the journals of both Harnesses, the sums, the price table, and `[usage]`.
6. The Usage Pane, and today's line in the popover.
