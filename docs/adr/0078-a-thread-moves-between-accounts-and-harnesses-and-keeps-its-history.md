---
status: accepted
date: 2026-11-06
---

# A Thread moves between accounts and Harnesses, and keeps its history

Roma has two Claude Max accounts and Codex. When one Claude account runs out, the Thread stops with "You can try again after 14:20". Every Thread on that account stops with it. Today the only way on is a new Thread on another entry, which starts from nothing.

What Banda has:

- A second account is a second Harness entry with its own configuration folder (ADR 0003 decision 4, ADR 0055 decision 1).
- A Thread's Harness is chosen when it starts, and stays (ADR 0006 decision 1).
- A Thread keeps its Harness's session as evidence: `Evidence {harness, session}`. A process of another entry opens a new session.
- Banda keeps every item of a Thread in the Project's log (ADR 0002). That log is the history a Thread can take anywhere.

Evidence: [the research](../research/2026-11-06-accounts-and-switching.md) covers T3 Code read from its code, Claude Code, Codex, ACP, OpenCode, Cursor, Amp, Conductor and the account switchers. Its part 4 is a spike of one Claude session continued on two accounts. The mockups are in Roma's `~/Banda/artifacts/accounts/`:

- `accounts-v1.html`: the picker, the limit card, the divider and Add account;
- `accounts-v2-mark.html`: the account's mark;
- `accounts-v3-palette.html`: the colours.

Roma, 2026-11-06:

- Switching is manual only, for now.
- A Thread moves to another Harness in the same Thread.
- Sessions are Banda's, not the Harness's folders: store C.
- API keys come in two levels, the Harness's own sign-in first.
- The mark is the pill (C).
- The palette has four colours, the fourth graphite.
- A new Thread starts on the default account, with a warning when that account is spent.
- "Move all" stays.
- The key is `Mod+Shift+↑/↓`.

## Decision

The points Roma decided are marked _decided_.

1. **An account is one sign-in of a Harness.**
   - In `harnesses.toml` an account is an entry with `of = "<harness>"`. It takes that Harness's program, adapter and CLI, and adds its own `name`, folder and kind. An entry without `of` is a Harness, and its own default account.
   - An existing second entry (Banda's adapter with its own `CLAUDE_CONFIG_DIR` or `CODEX_HOME`) is read as an account of that Harness. The settings Pane offers to write the `of`.
   - **Kinds:**
     - `subscription`: signed in through the Harness's own sign-in (ADR 0004).
     - `api`: the Harness's own API-billed sign-in: Claude Code through Anthropic Console, `codex login --with-api-key`. The Harness keeps the key.
     - `gateway`: a base URL, such as OpenRouter or LiteLLM, and a key.
   - A new account gets a folder Banda makes: `~/.local/share/banda/accounts/<id>/`. Add account also lists the folders already signed in on this computer, such as `~/.claude_second`, to take as they are.
   - **A gateway's key is the only secret Banda keeps.** It goes in the machine's `secrets`:
     - the system keyring where there is one;
     - a 0600 file on a host with no screen;
     - or a reference such as `op://` or `pass`.

     The Harness asks for it with `banda secret get <account>`, Claude Code's `apiKeyHelper` and Codex's `auth.command`, so the key never sits in a file or in an environment. The window can write a key and never read it back. ADR 0004 gains this one exception: a key the Person typed into Banda.

2. **A Thread runs on an account, and moves** (_decided_). This replaces ADR 0006 decision 1.
   - Each Turn records its Harness, account and model.
   - The Thread's current account is a setting of the Thread, as its model is.

3. **The sessions are Banda's** (_decided_).
   - **Claude Code.** The carried adapter gives the Agent SDK a `sessionStore` that the engine keeps, in the Project. Any Claude account continues a Thread's session, on this computer or, later, on another host.
   - **One adapter process per account.** The account's `CLAUDE_CONFIG_DIR` is set in that process's environment, never inherited from Banda's own (the spike's trap, research part 4).
   - **Codex.** An account's folder is a shadow of the shared `CODEX_HOME`: every entry is linked except `auth.json`, `auth.lock` and `models_cache.json`, as T3 Code does. A resume that fails with `invalid_encrypted_content` is retried once without the encrypted reasoning.
   - `Evidence` names a session by its store (the Harness), not by the entry. `continued_by` asks whether the store matches.

4. **Moving to another account of the same Harness is one click.**
   - The model picker lists the Harness's accounts under the effort slider. Each row has its fullest window as a thin bar, or its reset time when the account is spent.
   - A move continues the same session. Only the prompt cache and the hidden reasoning are lost. There is no confirmation.
   - While a turn runs, it finishes on the old account, and the next turn starts on the new one. A line above the composer says so.
   - The Thread shows a divider: "Claude · Work → Personal · same session". Its hover says the first turn reads the Thread without the cache.

5. **Moving to another Harness is a handoff, in the same Thread** (_decided_).
   - The new Harness starts its own session and receives the history from Banda's log: the first request and the newest messages, up to about 16k tokens. Tool calls go as text.
   - It is told that the rest can be read through `banda` (ADR 0019).
   - The picker confirms this once per Thread, saying what goes and what does not: the reasoning, the cache, the tools' state.
   - The divider unfolds what went, what was left out, and what did not go.
   - Going back to a Harness the Thread used before continues that Harness's own session, and sends only what it missed.
   - Codex's own Claude importer may replace the plain text for Claude → Codex later. That is not part of this ADR.

6. **A usage limit is a pause, not a failure.** The turn's red failure becomes a card. It names the account, the window and the reset, and says the turn goes on where it stopped. It offers:
   - **Continue on the account of the same Harness with the most room.** This is the main button: no loss.
   - **The other Harness**, through the confirmation in decision 5.
   - **Wait until the reset**: ADR 0074's snooze until then (PR 630's "Snooze until"). The Thread then retries the turn by itself.
   - **⋯**:
     - the API account, with the price of a turn;
     - "Move all N Threads of Work to Personal";
     - "Accounts…".

   Each way on continues the stopped turn (`agents.retry`) on the new account.

7. **Banda never moves a Thread by itself** (_decided_).
   - Every move is the Person's click or key. That keeps within each vendor's "ordinary, individual use" (research part 3).
   - "Move all" (_decided_) is in the card's ⋯ and in the limits widget's popover, beside a spent account. It is still one click by the Person.
   - Whether an Agent may move its own Thread is not decided here.

8. **A new Thread starts on the Harness's default account** (_decided_). If that account is spent, the chip shows the warning dot and its popover names the reset. Banda does not pick another account for it.

9. **The account's mark is a pill** (_decided_).
   - The pill is a dot in the account's colour and the first letter of its name, on a pale ground of the same colour. The letter takes the text's colour.
   - It stands after the Harness's logo wherever the account's name is not written: the composer's chip and the sidebar's rows.
   - Where the name is written (the picker, the divider, the limit card) the dot alone shows. Charts and legends keep the dot.
   - Two accounts of one Harness with the same first letter get two letters. `mark = "…"` in the entry overrides it.

10. **Four account colours** (_decided_). They replace `--account-1…5` (ADR 0055 decision 4).

    | Slot | Colour | Light | Dark |
    |---|---|---|---|
    | 1 | violet | `#8557c8` | `#a072e6` |
    | 2 | rose | `#ad3272` | `#c54987` |
    | 3 | green | `#17a750` | `#1eab53` |
    | 4 | graphite | `#424242` | `#b7b7b7` |

    - Blue, yellow, orange and red stay with what they mean: working, near a limit, out, needs you, and Claude's logo. Banda's blue accent stays the focus's (ADR 0075).
    - Every pair is apart for colour-blind reading (ΔE ≥ 8.9) and for normal vision (≥ 15.7), and each colour is at least 13 from the status colours. This was checked with the dataviz validator against `#fff` and `#141417`.
    - Graphite has no chroma on purpose. No fifth vivid colour fits: each one tried came within ΔE 14 of the others.
    - A fifth account and later take the colours again from the first. Their letter still tells them apart. An account's colour can be picked in Add account and in its ⋯.

11. **`Mod+Shift+↑` and `Mod+Shift+↓` move the Thread to the previous or next account of its Harness** (_decided_). They are the actions `thread.account.previous` and `thread.account.next` (ADR 0071).

## Consequences

- ADR 0006 decision 1, ADR 0055 decisions 1 and 4, and ADR 0004 change as above.
- `GLOSSARY.md` gets **Account** ("one sign-in of a Harness: a subscription, an API key or a gateway"). The Thread entry changes: "Its Harness is chosen when it starts and stays with it" becomes "it runs on an account of a Harness, and may move to another".
- The Project's store holds Claude sessions, so a Thread's size on disk grows by its transcript. The Harness's own folder keeps its copy too, swept by `cleanupPeriodDays`.
- `sessionStore` is `@alpha` in the Agent SDK. A change in it is a carried-adapter change, tested in CI (ADR 0059). If it goes away, a Claude account move falls back to the handoff of decision 5.
- The usage limit's card builds on PR 630's snooze offer.

## Steps

Each step is its own PR. Window steps follow the mockups.

1. This ADR and the research.
2. **The engine's accounts:** `of`, `kind`, `mark` and colour in `harnesses.toml`; reading existing second entries as accounts; hosts per account with their own `CLAUDE_CONFIG_DIR` or `CODEX_HOME`; each Turn records its account.
3. **Claude's store:** the carried adapter's `sessionStore` on the engine, `Evidence` by store, and moving between Claude accounts.
4. **Codex's shadow homes** and moving between Codex accounts.
5. **The handoff** to another Harness: the budgeted history, `banda` to read the rest, the divider item, and going back with only what was missed.
6. **The window:** accounts in the picker, the pill and the four colours, the divider, the confirmation and the keys.
7. **The limit card:** the ways on, "Move all", and the widget's action, on top of PR 630.
8. **Add account:** subscription, API key and gateway, the folders found, the machine's `secrets`, and `banda secret get`.
