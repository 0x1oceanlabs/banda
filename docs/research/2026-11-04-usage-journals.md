# Local Usage collector

Evidence and implementation limits for ADR 0043, step 5, 2026-11-04.

## Sources

- Claude Code: `projects/**/*.jsonl` under `CLAUDE_CONFIG_DIR`, default
  `~/.claude`. Assistant `message.usage` is deduplicated by session,
  `message.id` and `requestId`; the fullest repeated content block wins.
- Codex: `sessions/**/*.jsonl` under `CODEX_HOME`, default `~/.codex`.
  `session_meta` supplies the session and `turn_context` the model.
  `event_msg/token_count` cumulative `total_token_usage` is differenced
  across reads. Repeated totals add nothing; a reset starts a new series.
  Cached input is removed from ordinary input; reasoning is already in output.
- The shipped price snapshot is a filtered copy of [LiteLLM's table at
  fd4cef22eafaf5e1c18f3a5af6df252a16fa5cce](https://github.com/BerriAI/litellm/blob/fd4cef22eafaf5e1c18f3a5af6df252a16fa5cce/model_prices_and_context_window.json).
  Its MIT license is beside the snapshot. Refresh explicitly with
  `python3 scripts/usage-prices.py <full-commit-sha>` and format the JSON
  with Prettier. Ordinary builds and usage reads make no pricing request.

## Contract and limits

The API counts sessions, not Banda Threads. Prompt counts include user
messages, excluding Claude tool-result-only and metadata records. Claude
prompt rows have an unknown model because a prompt does not identify its
answer's model. Session counts overlap across model/day rows; the overall
count is distinct. Requests mean observed usage records, not an independently
verified count of provider network requests.

Only enabled Harness entries contribute. Entry environment overrides the
process environment, then conventional home directories apply. Entries
pointing at the same canonical folder count once, under the first enabled
entry. Changing the signed-in account within one folder cannot split its
historical usage by account: journals do not reliably record that identity.

Collection resumes from persisted byte offsets with Codex model and counter
state. Replacement/truncation detected by length, modification time, prefix
and offset-tail fingerprints resets that file. Arbitrary in-place middle
rewrites are outside the append-only journal assumption. Copied usage
records are deduplicated across files in the same source. Prompts lacking
stable IDs use file offsets, so edited copies may duplicate prompt counts.
Reads stop at 32 MiB per file per pass; incomplete final lines are retried;
lines exceeding 16 MiB report a read problem. Malformed complete lines are
skipped and reported. Errors never include journal content. Missing files
leave previously counted history until retention expires.

The machine stores per-record counters to deduplicate incremental reads
and derive UTC-day, Harness and model sums for an exact interval. It keeps
92 days, with queries up to 90 days. It does not store prompt/response
text. File paths, session IDs, model IDs and token counters remain local.
The Usage Pane and its popover summary are the separate step 6.

Costs are standard text-token USD API estimates, not subscription charges.
A finite nonnegative per-request `costUSD` or `cost_usd` takes precedence.
Otherwise exact model IDs use the bundled table, including supported long
context and one-hour cache-write rates. Unknown models or missing rates
increment `unpriced`; their unknown cost is not silently priced at zero.
Service tiers, negotiated discounts and tool charges are not inferred.
Prices are the release snapshot, not historical rates for each request.
