---
status: accepted
date: 2026-11-05
---

# Agents can request bounded browser screenshots

ADR 0029 step 5 adds screenshots as image content and a setting for tools.
Roma asked to implement this step after the page dialogs in #533.

**Decision.** `browser_screenshot {tab}` returns the visible page as one
JPEG image, through the existing kernel `Picture` and MCP image content,
with the tab's address, title and image dimensions as text. It captures no
Banda chrome or other Pane. It fits within 1280 × 1280 pixels, preserving
the full viewport's aspect ratio, and at most 1 MiB before base64 encoding.
No image file is written. The 20 KB text cap in ADR 0029 excludes this
bounded image payload.

`browser.toml` gains `[agents] enabled = true` and `screenshots = false`.
Both appear in Settings → Browser. Disabling enabled refuses every Banda
browser tool call by an Agent; the tools stay listed in existing MCP
sessions, which cache their list. Screenshots additionally require their
own opt-in. Settings apply to the next call and are checked again before
returning an image. These settings govern Banda's tools; the CDP endpoint
for the Person's own programs keeps its existing behavior.

Screenshots obey the same site gate, Stopped and handoff rules as page
reads. Password and card fields identified by input type or autocomplete
are masked, including in frames. Other visible page content is part of the
image. A pending page dialog refuses capture, and a page that navigates
during capture asks for a new attempt rather than returning a mixed view.

Electron may have no capture surface while a tab's Pane is out of sight.
Capture is bounded to eight seconds and then asks the Person to show the
tab and retry. It does not move the Person's focus or select a hidden tab.
