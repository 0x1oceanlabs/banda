# Real browser Agent trial

These tests use real paid Harnesses and are excluded from the default E2E
configuration and refuse to run when CI is set. They retain the normal HOME
so the Harness uses its existing sign-in and defaults; Banda gets disposable
root, data, state and config folders. The
fixture is local, with fake secrets and no real transactions. No credentials
are read or printed by the runner.

The normal desktop typecheck includes this runner; it does not execute it.

Build the workspace and desktop first. Then run one Harness at a time:

```sh
env -u ELECTRON_RUN_AS_NODE -u APPIMAGE -u APPDIR \
  BANDA_REAL_BROWSER_TRIAL=1 BANDA_TRIAL_HARNESS=claude \
  pnpm --filter @banda/desktop exec playwright test -c trials/playwright.config.ts
```

Repeat with `BANDA_TRIAL_HARNESS=codex`. The Harness's configured default
model is retained. Expect up to ten minutes of real model work per run.
Evidence is saved under `/tmp/banda-browser-step6-trial/<harness>/`.
The driver answers site questions and handoffs as the Person; browser tool
choices and page interaction come from the Agent itself. A screenshot-only
random canvas challenge checks that an actual image reached the model.

The fixture covers Agent tools and their recovery paths. The normal
`e2e/browser.spec.ts` suite separately covers tab layout, extension popups,
the blocker, isolation, CDP, overlays and detailed UI behavior; do not report
those as real-model coverage unless a transcript demonstrates it.

For a focused follow-up after protected-field fixes:

```sh
env -u ELECTRON_RUN_AS_NODE -u APPIMAGE -u APPDIR \
  BANDA_REAL_BROWSER_TRIAL=1 BANDA_TRIAL_HARNESS=claude \
  BANDA_TRIAL_MODE=focused BANDA_TRIAL_RUN_LABEL=after-fixes \
  BANDA_TRIAL_DESKTOP=/absolute/path/to/fix-worktree/client/desktop \
  pnpm --filter @banda/desktop exec playwright test -c trials/playwright.config.ts
```

The focused fixture checks numeric and textarea card fields, a rich editable
with a known password autocomplete attribute, frame masks, protected fill and
key refusals, normal Shift+A, and handoff/Stop/resume. It asserts actual page
state and a successful post-resume snapshot rather than trusting a completion
marker. Build the chosen desktop and its engine before running.

Only native `BrowserWindow.setContentSize` sizes the test window. Do not add
`page.setViewportSize`: Electron propagates the host's emulated metrics into
guests whose native surfaces are smaller, creating artificial tiled captures.

For one targeted image/zoom follow-up, use `BANDA_TRIAL_MODE=image` and
`BANDA_TRIAL_ZOOM=1.25`, with a new run label and the chosen desktop override.
The Person driver applies native guest zoom; the Agent reads independent
random canvas codes at the top and at the fixed bottom-right corner. Both
must match, so a crop that happens to retain the top code cannot pass.
