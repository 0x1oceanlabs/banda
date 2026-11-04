# Browser page dialogs — step 4g mockup

2026-11-04. Approved centered placement under ADR 0029; implemented under ADR 0060.

The mockup keeps a page's dialog centered in the page area of its browser
Pane, below the toolbar. Roma chose this placement on 2026-11-04. The site is named separately from the page's message, which
is plain text. Only that page is blocked. Switching tabs leaves its
pending dialog in place; the pending tab has an attention dot. Other
Panes and browser chrome remain usable.

- Alert: the message and OK.
- Confirm: the message, Cancel and OK.
- Prompt: the message, the supplied default text, Cancel and OK. An empty
  submitted string differs from cancelling.
- Before unload: browser-owned wording, Stay and Leave. The page cannot
  supply a custom message for this kind.

The demo's scenario and actor selectors are review controls outside the
product. Choosing Agent simulates the same answer the tool will make;
it does not call a Harness or a site.

## Contract

`browser_act` gains explicit dialog accept and dismiss actions; accepting
a prompt may carry text. Snapshots and action results report the pending
dialog's kind, message and prompt default even while the page is blocked.
A dialog has an ID: each reply names it, so a late reply cannot answer a
new dialog. Before-unload remains a mockup only: Electron requires a synchronous answer
and replaying a cancelled navigation would be unreliable (ADR 0060).

A reply after the Person answered returns a conflict and asks
for a fresh snapshot. Only the first answer wins.

The Person can always answer in the Pane. An Agent can answer only when
it may drive that tab, subject to the existing site gate, Stopped and
handoff rules. The tool descriptions retain the existing requirement to
hand final purchases, public posts and other personal steps to the Person;
an ordinary JavaScript confirm does not determine that policy.

Main owns pending dialogs and their lifetime; the Pane only displays them
and sends answers over the bridge. CDP clients and Banda must share one
pending dialog, and a page close or an interrupted connection must not
leave an orphaned wait. Tests must cover both answers, prompt cancellation
versus an empty value, tab switching, stale IDs and the race between a
Person and an Agent. Native Electron dialogs must not also appear.

Sources: current `modules/browser/desktop/src/drive.ts` dialog tracking,
`modules/browser/engine/src/lib.rs` `Shown.dialog`, and ADR 0029 decisions
3 and 6 and build step 4g. The mockup records the agreed design. The Electron end-to-end test in
`app/desktop/e2e/browser.spec.ts` verifies the implemented alert, confirm
and prompt behavior; before-unload remains a proposal.
