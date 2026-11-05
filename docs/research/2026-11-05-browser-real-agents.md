---
date: 2026-11-05
---

# Browser instruction and real Agent validation

Step 6 ([PR #546](https://github.com/0x1oceanlabs/banda/pull/546)) changed Banda's `browser` skill from a CDP-first explanation to the
built-in browser tools and the read → act → check workflow. The trials used
normal Banda Threads, the shipped ACP adapters, existing Harness sign-ins and
their default models. The driver supplied Person decisions; it did not make
browser tool calls for the Agents.

Only a disposable local HTTP fixture was used. There were no real accounts,
purchases, messages, public posts or external website writes. The fixture's
passwords/card numbers were fake test data. Banda's root/data/state/config were
isolated under `/tmp/banda-browser-step6-trial`; no account files, tokens or full
Harness journals are part of the proposed repository report.

## Evidence and outcome

| Run | Harness-reported active model | Elapsed (Playwright) | Actual browser tool calls | Outcome |
|---|---|---:|---:|---|
| Claude baseline | `opus` alias; exact Claude model version unconfirmed | 5.0 min | 56 | Partial: core scenarios passed; the first driver omitted the real Resume click |
| Codex baseline | `gpt-6.1-sol` | 4.1 min | 67 | Passed strict page-state and final resumed-snapshot oracles |
| Claude after protected-field fixes | `opus` alias; exact Claude model version unconfirmed | 1.8 min | 25 | Passed focused field/key/image/handoff/settings/Stop/resume oracles |
| Claude after native zoom capture fix | `opus` alias; exact Claude model version unconfirmed | 38.8 s | 6 | Passed one-image native zoom 1.25 follow-up with both independent canvas codes |

Times include startup and Person-driver waiting and are not a model speed benchmark.

No model was selected or changed by the runner. The IDs above are taken from
`ThreadView.offer.options` (`model.value`), rather than inferred from the outer
coding agent. All runs used `full_access` mode and retained default model
options; this does not test the Harness's supervised mode.

Tool counts (actual Thread tool items, excluding skill/discovery):

| Tool | Claude baseline | Codex baseline | Claude focused | Claude zoom image |
|---|---:|---:|---:|---:|
| `browser_tabs` | 4 | 4 | 3 | 1 |
| `browser_open` | 2 | 2 | 1 | 1 |
| `browser_navigate` | 5 | 5 | 0 | 0 |
| `browser_snapshot` | 17 | 29 | 8 | 2 |
| `browser_act` | 23 | 23 | 10 | 0 |
| `browser_wait_for` | 1 | 1 | 0 | 0 |
| `browser_screenshot` | 3 | 2 | 2 | 2 |
| `browser_handoff` | 1 | 1 | 1 | 0 |

The two baseline runs exercised all eight tools. Both Agents read the new
browser skill through Banda before acting. The focused follow-up deliberately
did not repeat navigation and delayed waits. The final image-only follow-up made
one successful screenshot call plus the initial disabled-setting refusal; it
did not repeat actions, waits or handoffs.

Evidence directories:

- Claude baseline: `/tmp/banda-browser-step6-trial/claude/`
- Codex baseline: `/tmp/banda-browser-step6-trial/codex/`
- Claude focused: `/tmp/banda-browser-step6-trial/claude/after-fields-fix/`
- Claude zoom image: `/tmp/banda-browser-step6-trial/claude/after-zoom-fix/`

Each contains `thread.json` (typed Thread items/turns), `evidence.json` (fixture
HTTP/action events and Person decisions), UI screenshots and a visible Thread
transcript. The fixture profiles retain their own generated image files. These
local artifacts may contain synthetic test values and account-directory paths;
only the summary and reproducible runner should be checked in.

## What the real Agents demonstrated

- Empty tab listing, opening a tab beside the Thread, site permission refusal,
  ending the turn and continuing on the Person's actual Once answer.
- Address navigation, back, forward, back and reload; opening another tab from
  a link and identifying it in `browser_tabs`.
- Fill/type/End/select, double-click, hover, drag, scroll and a delayed-text wait.
  The server independently observed `Trial-agent`, `courier`, double-click,
  hover, drag, delayed completion and the Bottom button click in both baselines.
- A deliberately stale ref was refused; the Agents took a fresh snapshot and
  continued without another control route.
- Alert accepted, confirm dismissed and prompt accepted with `real-agent`.
  Server state independently recorded `true`, `false`, and `real-agent` outcomes.
- An attempted fake password fill was refused. The Agents used handoff and
  ended the turn. A Person driver filled the fake password and pressed Done;
  Banda resumed the same Thread and its next read succeeded.
- The pre-denied host's snapshot was refused. Turning tools off refused
  `browser_tabs` in an existing session; re-enabling restored access.
- Person Stop prevented the next page action. With the corrected driver, the
  actual Let drive again click allowed a final real snapshot in both the Codex
  baseline and the Claude focused run. The initial Claude baseline's final
  snapshot remained stopped because the first driver had skipped that click;
  its original completion-marker-only Playwright result is not accepted as a
  product pass. The driver and oracles were corrected before the other runs.
- Screenshot opt-in was enforced. Image tool items carried real JPEGs and the
  Agents read random canvas codes absent from accessibility text: Claude
  `1855`, Codex `6316`, and focused Claude `4184`. The focused run returned a
  single native viewport image, 644 × 900, with protected fields visibly masked.
  In the last native-zoom follow-up, the Agent correctly read independent codes
  `VISUAL=5426` at the top and `CORNER=7258` fixed to the bottom-right, without
  changing zoom/scroll or using another data route. The 644 × 900 JPEG was
  45,464 bytes, showed both complete viewport edges once and retained black
  password/card masks. The driver asserted both random codes, and a separate
  inspection of the saved JPEG confirmed the image itself.

The focused run attempted fill `1234` and press `Shift+A` once each on a numeric
card field, textarea card field and rich editable with known password
autocomplete. All six returned protected-field refusals and the fixture
recorded no protected mutations. Normal Fill `Trial`, End, Shift+A produced
exactly `TrialA`. Snapshot tool text contained none of the seven synthetic
protected values (native input, numeric, textarea, rich editable and iframe
cases). The Agent visually confirmed masks in both iframe fields.

The Person driver's fake password operation changed the field without focusing
it. The Agent's suggestion that the focus marker might be stale after this is
therefore not evidence of a product focus bug.

## Findings and corrections

The independent source/deterministic review identified protected-field gaps in
numeric spinbutton masking, textarea values, iframe snapshots, rich editable
values, and modified-key/deep-focus handling. A short synthetic CVV also
corrupted refs when redaction replaced text across the whole line; value-only
redaction now preserves role/name/ref metadata. Product fixes were validated by
focused deterministic regressions and the real Claude follow-up above. The
live baseline alone did not discover or reproduce every source-review issue;
those evidence types must remain distinct. The field fixes are in
[PR #548](https://github.com/0x1oceanlabs/banda/pull/548).

Both baseline Agents accurately noticed a tiled screenshot. This was a test
driver artifact, not a confirmed product defect: host `page.setViewportSize`
applied emulated host metrics to smaller native guest surfaces. Removing it
and using only native `BrowserWindow.setContentSize` produced the clean
focused image. Codex's running host override was cleared after its first
screenshot. Do not present the baseline tiling as an unfixed browser bug.

A separate real product defect at native page zoom 1.25 was confirmed: a CDP
clip mixed CSS and native guest dimensions and could crop the viewport. The
fix ([PR #551](https://github.com/0x1oceanlabs/banda/pull/551)) uses native PNG capture only in Banda's private per-tab relay for viewport
screenshots. Playwright installs the masks first; a mandatory two-animation-frame
paint barrier precedes native copy, avoiding a previous unmasked compositor
frame. The production barrier runs in an isolated world so page scripts cannot
replace its animation-frame or Promise globals. The resulting image remains bounded to 1280 × 1280 physical pixels and
1 MiB before base64. The Person's public CDP endpoint and full-page CDP behavior
are unchanged.

The parent MCP E2E checks passed twelve combinations (DPR 1/2 × zoom
1/1.25/0.8 × scroll 0/120), checking four viewport corners and the password
mask. The existing screenshot/settings test also checked the iframe mask.
An independent Playwright → production-relay fixture separately passed twelve
combinations with a fresh document and unique color stamp before each shot,
including both top-level and iframe masks. Its first comparison had incorrectly
relied on a preceding masked frame; the corrected native-first test exposed
the need for the paint barrier and then passed with it. These are
deterministic checks, not twelve paid Agent runs. The final real Claude
follow-up on the zoom-fix desktop then passed at native zoom 1.25 with both
independent canvas codes and the masks visible in the image. No further paid
runs were needed.

## Scope and remaining limits

These runs used Linux with the pinned Electron 45.1.0 and Playwright 1.64.1.
The DPR cases emulate native backing scales; they are not macOS/Windows or
physical-device validation.

The parent validation independently ran the complete original 22-test browser
suite, then all 24 tests on the zoom-capture branch, plus the protected-field
regressions on their own branch and `scripts/check.sh --no-window`. The final
isolated-world paint barrier also passed the three image E2Es with the page's
own animation-frame global deliberately replaced. This covers UI/layout, isolation,
CDP, extensions/blocker fixtures, overlays and detailed behavior. These are not
real-model coverage merely because the real Agent trials passed.

The trials did not install arbitrary Chrome Web Store extensions or use public
websites, real credentials, purchases, actual OS dialogs or external account
permissions. A page hidden behind another tab can lack an Electron capture
surface; the screenshot refusal asks the Person to show it. `beforeunload`
remains the separately documented limitation. No access gate was bypassed to
make a test pass.

Stop was pressed before the requested delayed wait began in both baseline and
focused scenarios. Next-call denial and subsequent resumption are verified;
interrupting an already running `browser_wait_for` is not verified here.

## Agent proposals, not confirmed defects

- Expose whether a masked field is empty or filled without revealing its value,
  so an Agent can verify a Person's handoff completion.
- Consider a convenient scroll-to-top/bottom operation. The current scroll
  direction moves one screen; ref scrolling also worked.
- Make the literal localhost exceptions clear: `trial.localhost` still asks,
  while bare localhost/127.0.0.1 do not.
- Check the small article typo reported in an alert description (`a alert`).
- Consider discoverability of a handoff on a background tab. The Person can
  select its tab; preserving focus is intentional, and no auto-focus change is
  justified by these trials alone.
- For future fixtures, expose accessible outcome text for hover/double-click/
  drop rather than requiring a screenshot. The test server already verified
  those effects; the lack of visible feedback was a fixture limitation.
- Add a dedicated interruption-during-wait trial if that guarantee is required.

The source review also suggested three unconfirmed concurrency probes: site
permission revoked or navigation during an asynchronous snapshot; Person input
during an Agent action; and navigate/wait initialization on a load-time dialog.
These are follow-up test ideas, not established failures from this trial.

## Reproduction

Use the opt-in runner under `app/desktop/trials`, excluded from the default E2E
configuration and disabled whenever CI is set. Build the selected worktree's
engine and desktop first; the runner retains normal Harness authorization.

```sh
env -u ELECTRON_RUN_AS_NODE -u APPIMAGE -u APPDIR \
  BANDA_REAL_BROWSER_TRIAL=1 BANDA_TRIAL_HARNESS=codex \
  pnpm --filter @banda/desktop exec playwright test -c trials/playwright.config.ts
```

Use `BANDA_TRIAL_HARNESS=claude` for the other Harness. Focused follow-up:

```sh
env -u ELECTRON_RUN_AS_NODE -u APPIMAGE -u APPDIR \
  BANDA_REAL_BROWSER_TRIAL=1 BANDA_TRIAL_HARNESS=claude \
  BANDA_TRIAL_MODE=focused BANDA_TRIAL_RUN_LABEL=after-fixes \
  BANDA_TRIAL_DESKTOP=/absolute/path/to/fix-worktree/app/desktop \
  pnpm --filter @banda/desktop exec playwright test -c trials/playwright.config.ts
```

Completion requires actual page state, matching random image digits, no leaked
synthetic protected values, no protected mutations and a successful final
resumed snapshot. A model's completion marker or assertion alone is insufficient.

Image-only zoom follow-up (one successful MCP image, with the opt-in refusal
also checked):

```sh
env -u ELECTRON_RUN_AS_NODE -u APPIMAGE -u APPDIR \
  BANDA_REAL_BROWSER_TRIAL=1 BANDA_TRIAL_HARNESS=claude \
  BANDA_TRIAL_MODE=image BANDA_TRIAL_ZOOM=1.25 \
  BANDA_TRIAL_RUN_LABEL=after-zoom-fix \
  BANDA_TRIAL_DESKTOP=/absolute/path/to/zoom-fix-worktree/app/desktop \
  pnpm --filter @banda/desktop exec playwright test -c trials/playwright.config.ts
```

The two random codes are rendered only into canvas pixels and are not in the
accessibility text or Agent prompt. Their expected values are held by the
fixture driver; the Agent read them only through the MCP image. The image run
used native window bounds, with no host viewport emulation, and native guest
zoom set by the Person driver.
