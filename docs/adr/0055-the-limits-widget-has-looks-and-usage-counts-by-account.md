---
status: accepted
date: 2026-11-04
---

# The limits widget has looks, and Usage counts by account

ADR 0043 made the widget `harnesses.limits` a ring filled with the
fullest window of every Harness, and planned the Usage Pane after T3
Code's page. A Person often has several accounts: a second account is a
second Harness entry with its own configuration folder (ADR 0003,
decision 4; ADR 0043, decision 1). With two Claude Code accounts, one
spent and one with room, the ring said 100% while work could go on.

Roma looked at mocks of the widget, its popover and the Pane on
2026-11-04 (`artifacts/usage-concept/v4.html` in the brand workspace),
and decided:

- no ring; the widget has looks the Person picks, and the icon is the
  default;
- the account is what the popover and the Pane show, each with its own
  colour;
- the charts are shadcn/ui's, with an area or bars view for Cost and
  Tokens;
- the design is minimal: few frames, room for the charts.

## Decision

1. **An account is a Harness entry, named by who is signed in.**
   - `Limits` gets `email`, the address the account is signed in with,
     when the Harness gives one. Claude Code: `oauthAccount.emailAddress`
     in its `.claude.json` (in the entry's configuration folder, or
     `~/.claude.json` for the default one), read by main with the token
     (ADR 0043, decision 2); it is no credential, and is sent nowhere.
     Codex: `account.email` of `account/read`.
   - The account's name is the entry's `name` in `harnesses.toml`, as
     today: a Person names a second entry `Work`.
   - **Two entries signed in to the same account share its limits**, as
     they are one subscription. `Limits` gets `also`, the other entries'
     IDs, and only the first enabled entry is listed; the popover shows
     it once. Usage is not merged: it counts each journal folder already
     (ADR 0043, decision 6).

2. **The widget shows how much room there is, in a look the Person
   picks.**
   - Its share is that of the account with the most room of each Harness,
     and of these the fullest: with Claude Code `Work` spent and
     `Personal` at 74%, and Codex at 12%, it is 74%. This replaces the
     fullest window of every Harness (ADR 0043, decision 5).
   - When an account is spent while another of its Harness has room, a
     dot in `--warning` marks it.
   - `[limits] look` in `harnesses.toml` picks it:
     - `icon` (the default): a gauge, in the bar's muted text, `--warning`
       from `warn` and `--destructive` at 100%;
     - `meter`: a thin bar and the share;
     - `number`: the share alone;
     - `providers`: each Harness's share, `Claude 74% · Codex 12%`.
   - Its context menu picks the look too, and writes it to the file.
   - It still draws nothing while no Harness has limits, and is dimmed
     while the last read failed and is older than half an hour.

3. **The popover lists the accounts.** For each, by Harness: a dot in
   its colour, its name, its Harness and plan; its session and weekly
   windows as thin bars with the even-pace mark and the share; "back in
   1h 12m" when it is spent, or "most room" on the one of its Harness
   that has the most. The pace warning stays (ADR 0043, decision 5).
   At its foot, today's tokens and API estimate, and "Usage", which opens
   the Pane.

4. **The Usage Pane is filtered and drawn by account.**
   - Each account has a colour, fixed in the order of `harnesses.toml`:
     the chart's first categorical colours, checked for colour-blind
     reading. Turning an account off does not repaint the others.
   - A row of accounts under the tabs turns each on or off; the sums,
     charts and tables count only those on.
   - **Limits**: a section per account, with its email and plan; each
     window's share in large type, its bar with the even-pace mark,
     "Ahead of pace", "On pace", "Under pace" or "Out", and its reset.
   - **Cost** and **Tokens**, with 24 hours, 7, 30 or 90 days: the sum in
     large type, a chart of each day (each hour for 24 hours) stacked by
     account, by account with its share, and by model. Tokens also part
     input, cache read, cache write and output, and the cache's hit rate.
   - The chart is an area or bars, a toggle beside it; each tab keeps its
     own, Cost an area and Tokens bars by default.
   - The charts are shadcn/ui's `chart` component on Recharts, in
     `@banda/ui`, with its tooltip: the day, each account's value and the
     total.

5. **The look is quiet.** No frames around sections, no chips; a section
   is parted by a line, an account is named by its dot. Tabs underline.

## Consequences

- ADR 0043, decision 5 (the ring, the fullest window) and the Pane's
  layout in decision 6 are this ADR's. Its other decisions stand.
- `@banda/ui` gets Recharts and shadcn/ui's `chart`.
- `[limits]` gets `look`; the settings Pane shows it from the schema.
- `GLOSSARY.md`: **Limit** says the widget shows the room left of the
  best account of each Harness.

## Steps

Each step is its own PR.

1. This ADR.
2. The engine: `email` and `also` in `Limits`, `[limits] look`.
3. The widget's looks and the popover.
4. The Usage Pane, with the chart component.
