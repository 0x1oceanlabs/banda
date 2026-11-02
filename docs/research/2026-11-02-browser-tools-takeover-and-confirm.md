# Browser tools for Agents: taking a tab over, showing who drives, confirming

Companion to `2026-11-02-browser-tools-for-agents.md` (issue #151), for Roma's questions 2, 3 and 6.


Research for Banda. Written 2026-11-02. Read-only web research.
Codex desktop is covered in `codex.md` by another researcher. It is not repeated here.

Legend:
- **verified**: official docs, an official blog, or a first-hand report (a review with screenshots, or a GitHub issue with a repro).
- **inferred**: secondary coverage, a third-party write-up, or my reading of indirect evidence.

## 0. State of the field (read first)

- **ChatGPT Atlas has been retired.** OpenAI announced on 2026-07-09 that it would shut Atlas down on 2026-08-09. Its help article now redirects to a retirement notice. Its features moved to a ChatGPT Chrome extension, the ChatGPT desktop app ("Work" mode, Computer Use settings), and a cloud browser. **verified** (help page redirect seen via r.jina.ai; [aiweekly](https://aiweekly.co/alerts/openai-to-sunset-chatgpt-atlas-browser-after-nine-months), [Android Authority](https://androidauthority.com/openai-sunsetting-chatgpt-atlas-3686001)). Atlas is still described below because its UI was influential.
- **Claude now has three browser surfaces.** The first is the Claude in Chrome extension, which Claude Code drives with `claude --chrome`. The second is the **Browser pane in the Claude Desktop Code tab**, a tabbed browser in a pane beside the chat. That is the closest analogue to Banda. The third is a **built-in browser in Cowork**, which opens in a side panel next to the task and has been rolling out since 2026-08-26.
- **Dia does not act on pages.** A 2026-05 hands-on found it is chat-with-page only. **inferred** ([llmx-tech](https://llmx-tech.pages.dev/blog/ai-browsers-reviewed-2026-comet-vs-dia-vs-the-rest/)). It is left out below.
- **Genspark and Fellou have little documentation.** Fellou runs tasks in a background "shadow workspace" window. **inferred** ([seraphic](https://seraphicsecurity.com/?p=3628)). I found no takeover or confirmation details for either.

---

## 1. ChatGPT Atlas agent mode (Oct 2025 – Aug 2026, retired) and the ChatGPT Chrome extension

### Q1: the Person acts in an Agent tab
- Atlas showed a notification bar at the bottom of the screen with **"Take control"** and **"Stop"** buttons while the agent worked. **verified** (screenshot described by Simon Willison, 2025-10-21: [link](https://simonwillison.net/2025/Oct/21/introducing-chatgpt-atlas/)).
- OpenAI: "you can pause, interrupt, or take over the browser at any time." **verified** (quoted in the same post).
- The cloud ChatGPT agent, which Atlas built on, works like this:
  - When a task needs a login, the agent pauses and asks the Person to take over through "…" → "Take over browser".
  - "While you control the browser, screenshots are not captured."
  - After the Person hands control back, "the agent attempts to continue from the prior workflow state", and it may ask again.
  - **verified** ([ChatGPT agent help](https://help.openai.com/en/articles/11752874-chatgpt-agent), via r.jina.ai, undated).
- MIT AI Agent Index: "User can take over and do things themselves, and hand control back to the agent." **verified** ([index](https://aiagentindex.mit.edu/2025/chatgpt-atlas)).
- I found no source on whether clicking in the page without pressing Take control was blocked. **inferred**: the overlay tint suggests input went to the agent view until the Person pressed Take control.

### Q2: showing the Agent controls a tab
- The page had a "weird sparkle overlay effect", and a tooltip such as "Opening the first result" appeared on the page. **verified** (Willison).
- "Browser is tinted to indicate agent is working." The sidebar showed the action trace. **verified** (MIT index).
- The agent used "some internal tab system", not ordinary browser tabs. It prepared all its tabs first, then worked through them one by one. **inferred** (first-hand blog, [codeminer42](https://blog.codeminer42.com/how-to-use-chatgpt-atlas-agent-mode/), 2025-10-27).
- The chat ran in a side panel ("Ask ChatGPT" sidebar) next to the page.

### Q3: risky actions
- "ChatGPT is trained to ask before taking many important actions." This is model-driven. **verified**.
- The agent could not run code in the browser, download files, install extensions, or use saved passwords and autofill. These limits were enforced by product code. **verified** (Willison quoting OpenAI).
- **Logged-out mode**: the agent ran without the Person's cookies. The CISO recommended it "when you don't need to take action within your accounts". **verified** ([Willison on the CISO post](https://simonwillison.net/2025/Oct/22/openai-ciso-on-atlas/)).
- **Watch Mode**: on sensitive sites, the Person had to keep the tab active. "Agent will pause if you move away from the tab with sensitive information." **verified** (CISO). Willison could not trigger it on GitHub or his bank, so this behaviour itself is not confirmed.
- The ChatGPT agent docs list "user confirmations for high-impact actions" and "refusal patterns for disallowed tasks". **verified**.

### ChatGPT Chrome extension ("Work" mode, from 2026-10-15)
This overlaps with Codex desktop and the ChatGPT desktop app, so it is covered briefly.
- ChatGPT asks before acting on each new site. The choices are **allow once / allow for this site / allow for all sites ("Elevated Risk") / decline**. Allowed and blocked domain lists are under Settings → Computer Use → Manage. Browsing history access asks every time, with no "always" option. **inferred** (secondary source quoting the help page, [kami-labs](https://kami-labs.fr/en/ia/chatgpt-agit-dans-onglets-chrome/), 2026-10-21).
- Approval is per site, not per action. **inferred**.
- I found no information on indicators or a takeover control.

---

## 2. Claude in Chrome, Claude Code `--chrome`, the Claude Desktop Browser pane, and the Cowork built-in browser

### Q1: the Person acts in an Agent tab
- No official doc describes what happens when the Person clicks or types in a tab Claude is using. **inferred**: input is not blocked. The page stays live, and Claude sees the new state on its next screenshot or read. Tab changes are injected into tool results as a `<system-reminder>`. **inferred** ([reverse-engineering gist](https://gist.github.com/sshh12/e352c053627ccbe1636781f73d6d715b)).
- **Stop**: a "Stop Claude" button. If the Person stops mid-loop, every pending tool gets an error `tool_result`, and the debugger detaches from all tabs. **inferred** (same gist).
- **Agent-initiated handoff**: "When Claude encounters a login page or CAPTCHA, it pauses and asks you to handle it manually." For a blocking JS dialog: "Dismiss the dialog manually, then tell Claude to continue." Control goes back to Claude through a chat message, not a button. **verified** ([Claude Code + Chrome docs](https://code.claude.com/docs/en/chrome)).
- The Cowork built-in browser docs say only "stop the task if something looks off". They describe no takeover button. **verified** ([help](https://support.claude.com/en/articles/16607400-use-the-built-in-browser-in-claude-cowork)).

### Q2: showing the Agent controls a tab
- **Coloured tab group**: "This lets Claude organize tabs it opens into a separate group with a different color." The Person can drag tabs into Claude's group to share them. **verified** ([getting started](https://support.claude.com/en/articles/12012173-getting-started-with-claude-for-chrome)).
  - The group is named "Claude" ("Claude (MCP)" for Claude Code sessions) and is yellow or orange.
  - Its title shows animated dots while working and a check mark when done. **inferred** (gist, plus bug reports on group colour and naming).
  - Claude Code closes the group on `/clear`. **verified** (Chrome docs).
- **Glowing border overlay**: the extension injects a full-viewport `<div id="claude-agent-glow-border">` on every tab a session attaches to. It is animated with an infinite 2 s `claude-pulse` box-shadow. The overlay is hidden during screenshots and clicks. **verified** (GitHub issues [#52826](https://github.com/anthropics/claude-code/issues/52826), 2026; [#20070](https://github.com/anthropics/claude-code/issues/20070), with a screenshot). Both issues report heavy CPU and GPU cost. One asks for a thin border, `prefers-reduced-motion`, and pausing the glow while the agent is idle.
- **Chrome debugger infobar**: Chrome shows "Claude started debugging this browser" on every tab. This is a side effect of `chrome.debugger`, not a design choice. **verified** ([#69287](https://github.com/anthropics/claude-code/issues/69287)).
- **Placement**:
  - Chrome: Claude works in a side panel next to the page. Claude Code opens **new tabs** in a visible Chrome window. **verified**.
  - Desktop Browser pane: a tabbed pane beside the chat (Cmd+Shift+B). **verified** ([desktop docs](https://code.claude.com/docs/en/desktop)).
  - Cowork: "a browser opens in the side panel next to your task". **verified**.

### Q3: risky actions
- **Per-Thread mode**, chosen from a drop-down on the chat input. **verified** ([permissions guide](https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide), "updated this week" as of 2026-11-02):
  - *Manually approve*, formerly "Ask before acting". The classic panel approves a plan listing the sites. The Cowork panel approves each action.
  - *Automatically approve*, the Cowork default. A safety check reviews each action, blocks unsafe ones, and asks when needed. Repeated blocks fall back to per-step approval.
  - *Skip all approvals*, formerly "Act without asking".
- **Per-site prompt** "New permissions required": **Allow this action / Always allow actions on this site / Decline**. Approved sites are listed in extension settings, with history. **verified**.
- **Always ask, even on allowed sites**: downloads, entering sensitive information, and granting authorizations. **verified**.
- **Prohibited in every mode**: purchases, account creation, card and ID data, downloads from untrusted sources, permanent deletion, trades, system files, and following instructions from emails or web content. **verified** (permissions guide).
  - The server-injected system prompt has a "Prohibited (never perform)" tier, an "Explicit permission required" tier, and an "Instruction source boundary". It says: "These actions stay prohibited when the user explicitly asks for them." **verified** (verbatim quote in [#96762](https://github.com/anthropics/claude-code/issues/96762)).
  - The prohibited tier is enforced by the model and the prompt, not by browser code. No setting changes it. **verified** ([#105185](https://github.com/anthropics/claude-code/issues/105185)).
- **Blocked sites**: adult and pirated content. Asks before financial sites. Team and Enterprise admins have allow and block lists. **verified** ([safety page](https://support.claude.com/en/articles/12902428-use-claude-in-chrome-safely)).
- **Classifiers**: one checks incoming content for injection, and "another checks every action Claude takes before it runs". **verified**.
- **Credential handoff**: "1Password for Claude" fills logins or cards without the model seeing the values. **verified** (referenced in #96762).
- **Claude Code**:
  - The prompt "Claude in Chrome wants to …" appears in the Harness's own permission UI, with "allow all actions on that site for the session".
  - In auto mode, the classifier's approval skips the extension's per-site check.
  - In VS Code, it is a card in the chat.
  - **verified** (Chrome docs).
- **Desktop Browser pane** (the most Banda-like):
  - Safety classifiers review clicks and typing on external pages "in every permission mode … when they flag an action, you get a permission prompt regardless of mode". Bypass mode is included.
  - Outside Auto and Bypass, a domain allowlist check runs before navigating to a new site.
  - The first action on a site shows a card: **Allow once / Always allow / Deny**. Each subdomain is separate. localhost and project files are exempt.
  - "Even on an approved site, Claude won't purchase items, create accounts, or bypass CAPTCHAs without your input."
  - The pane uses a clean profile with no saved logins.
  - Admin switches: `browserExternalPageTools: "disabled"` and `disableBrowserExternalNavigation`.
  - **verified** (desktop docs).
- **Cowork browser**:
  - "Claude asks for your permission before acting on a site for the first time."
  - "High-risk sites are blocked."
  - Cookie import is per site, and "banking, email, and single sign-on sites stay unchecked by default".
  - **verified**.

---

## 3. Gemini in Chrome "auto browse" (from 2026-01-28; AI Pro and Ultra, desktop)

### Q1: the Person acts in an Agent tab
- "While Gemini in Chrome is performing a task, you can take over the task at any time." On the task tab, click **"Take over task"**, then do the steps. **verified** ([Chrome help](https://support.google.com/chrome/answer/16821166?hl=en)).
- To give control back, click **"Resume"** or **"Give back task"** in the Gemini chat. **verified**.
- **Stop** is in the side panel or the Gemini text box. Closing the task tab also stops it. After Stop, Gemini "may try other next steps" or abandon the task. **verified**.
- When Gemini needs help, it pauses and offers a "Take over task" button plus a text field for more instructions. After repeated critic vetoes, the planner hands control back to the Person. **verified** ([Chrome security blog, 2025-12-08](https://blog.google/security/architecting-security-for-agentic/)).
- I found no source on whether a plain click in the task tab, without pressing Take over, is blocked. **inferred**: the explicit button suggests a mode switch.

### Q2: showing the Agent controls a tab
- Gemini opens a **new tab** for the task. The Person can keep browsing elsewhere while it runs. **verified** ([9to5Google](https://9to5google.com/2026/01/28/chrome-gemini-auto-browse/), 2026-01-28).
- The tab is badged with a **cursor-and-sparkle icon** and has a **glow around it**. **verified** (9to5Google; help page: "an auto browse icon on the tab").
- The **top-right of the window** shows that auto browse is active, next to the Gemini spark. **verified** (9to5Google).
- "When Gemini needs you to act, you get a notification at the top of the browser." In the chat, the controls are "Switch tabs" (jump to the task tab) and "Check your task". **verified** (help).
- The side panel shows a step-by-step **work log**. The chat confirms with "Task started". **verified**.

### Q3: risky actions
- **Plan approval up front**: Gemini shows a plan and the Person clicks "Start Task". **verified**.
- **Confirmation before**: sending messages, modifying data, submitting web forms, scheduling events, and going to sites with highly sensitive financial or health data. **verified** (help).
- **The Person must do it themselves (forced takeover)**: finalizing financial transactions, accepting terms of service, creating accounts. For purchases and social posts, the Person presses the buy or post button. **verified**.
- **Sign-in**: Gemini asks before using Google Password Manager. Passwords are never shared with the model. A settings list, "Sites Gemini can sign you in to", is revocable. **verified**.
- **How it is enforced**: **verified** (security blog):
  - The sensitive-site navigation gate is "a deterministic check against a list of sensitive sites".
  - The purchase, payment, and send gates are model-based ("will try to pause").
  - A **User Alignment Critic** model sees only action metadata and vetoes misaligned actions.
  - **Agent Origin Sets** split origins into read-only and read-write sets. A trusted gating function must approve new origins.
  - A prompt-injection classifier runs in parallel.
- Not in Incognito. Daily limits are 20 (Pro) and 200 (Ultra). The master toggle is "Let Gemini browse for you". **verified**.

---

## 4. Perplexity Comet

### Q1: the Person acts in an Agent tab
- "There are clear buttons to stop the Assistant or provide more guidance." The post does not say where they are. **verified** ([Perplexity blog, 2025-11-14](https://www.perplexity.ai/hub/blog/comet-assistant-puts-you-in-control)).
- Desktop and Android: "you can take over at any time." **verified** ([MacStories](https://www.macstories.net/?p=196521), about 2026-03).
- Before that update, the MIT index said the Person "doesn't really have any opportunities to take over" and the agent "doesn't seem to pause". **verified** for mid-2025 only ([index](https://aiagentindex.mit.edu/2025/comet)).
- iOS runs the task in a **cloud browser** and sends screenshots. "Relevant cookies are temporarily transferred to the cloud agent and deleted when the task is done." **verified** (MacStories).

### Q2: showing the Agent controls a tab
- "A pulsing blue highlight around the webpage signifies that Comet's assistant is currently browsing on your behalf." **verified** (MacStories). An older review describes "a blinking blue border". **inferred**.
- "You'll see exactly where it's clicking, scrolling, or interacting with a site", and you can watch its reasoning in the "Assistant sidecar" (side panel). **verified** (Perplexity blog).
- One claim says a 2026-03-13 redesign replaced the blue wave with **tab animations** in a tab-group redesign. **inferred, weak** (an AI answer quoted on Reddit).

### Q3: risky actions
- Logging in or checking out a cart: the Assistant "will pause and ask for permission before proceeding". It makes "minor decisions without interrupting you" and asks for "more important decisions". These calls are model judgement. **verified** (blog).
- **Opt-in per task**: Comet can ask whether the Assistant should handle a task. The Person can browse themselves, grant one-time permission, or let it browse automatically. **verified**.
- **Global "Always Allow"** lets the Assistant act "without having to confirm". Without it, actions are confirmed. **Per-domain admin levels**: Browser Control / Read Only / No Access, overriding the global setting. **verified** ([help](https://www.perplexity.ai/help-center/en/articles/13531023-managing-comet-assistant-permissions), screenshots dated 2026-01-14).

---

## 5. Microsoft Edge Copilot Mode, Actions

### Q1: the Person acts in an Agent tab
- "You can interrupt or take control at any time." "If you stop the task, you're back in control." Copilot then stops capturing screenshots until restarted. **verified** ([support](https://support.microsoft.com/en-us/topic/copilot-actions-in-edge-5ed5e17e-42df-40a3-984a-20420eba86e2)).
- On higher-risk sites, such as banking or email, it "may ask you to monitor or take control". **verified**.

### Q2: showing the Agent controls a tab
- "Copilot can work in your current tab or open a new tab in the same window." "The tab where Copilot is working shows a **cursor icon** in the tab menu." **verified** (support).
- A ZDNET summary says Edge Actions are "less visually explicit than Atlas's cursor-movement". **inferred**.
- A **relevance-check dialog** appears when a site seems unrelated to the task, with continue or cancel. **verified** ([Edge blog, 2025-10-23](https://blogs.windows.com/msedgedev/2025/10/23/considerations-for-safe-agentic-browsing/), with a screenshot caption).

### Q3: risky actions
- **Modes**: **verified** (Edge blog):
  - *Balanced* (default): Actions only work on a **curated list of sites**. The Person can approve others.
  - *Strict*: overrides the curated list, and the Person approves every site.
- **Hard limits in code**: **verified**:
  - Downloads are disabled.
  - External app launches (protocol handlers) are blocked.
  - Context menus are disabled.
  - The file and folder picker is unavailable.
  - No `edge://` pages.
  - No autofill, passwords, or wallet.
  - The agent cannot grant site permissions, and site permissions are suspended during actions.
  - SmartScreen blocks bad sites. Adult and gambling sites are blocked.
- **Model-based**: "ask for confirmation when risk is higher". A secondary model detects task drift. Purchases and reservations ask for "attention and supervision". **verified**.

---

## 6. Opera Neon ("Neon Do", from 2025-09-30)

- **Q1**: "You can pause, stop, or take over at any time." "At any point, you can intervene to pause the process, make changes, or redirect its actions." Some steps need the Person to press a **play button**. There is an explicit "needs user action" UI. **verified** ([Neon FAQ](https://www.operaneon.com/faq); [MIT index](https://aiagentindex.mit.edu/2025/opera-neon)). One hands-on said there was no way to course-correct mid-task. **inferred** (remio, date unclear).
- **Q2**: "a subtle glow around active tasks" and "a side-panel view showing the plan and next steps". It runs in the Person's own pages and session. **verified** (FAQ).
- **Q3**: the Person approves the plan first. It pauses "for sensitive actions like completing transactions or downloading files". High-risk pages such as banking are blacklisted. **verified** (MIT index). Credentials and payments stay local. **verified** (FAQ).

---

## 7. Dev tools: Browserbase, Steel, Vercel agent-browser

These give live pixels and raw input. They have no control model. The host app must build one.

- **Browserbase Live View**: **verified** ([docs](https://docs.browserbase.com/platform/browser/observability/session-live-view)).
  - A read-only embed uses `style="pointer-events: none;"` on the iframe. An interactive embed omits it.
  - Use case: "Human in the loop – instantly take control or provide input."
  - Each tab has its own live-view URL.
  - The iframe posts `browserbase-disconnected`.
  - The docs give no pause or resume handshake.
- **Steel**: **verified** ([docs](https://docs.steel.dev/overview/sessions-api/human-in-the-loop)).
  - The debug URL takes `interactive=true|false` and `showControls=true`.
  - Multi-tab view by default. The viewer auto-switches to new tabs.
  - The example banner reads **"Automated session - Click inside to take control"**.
  - Advice: "Make it clear to users when they can interact with the session." Human actions change the real session state.
  - Debug URLs are unauthenticated.
- **Vercel agent-browser streaming**: **verified** ([docs](https://agent-browser.dev/streaming)).
  - Each session runs a WebSocket server that sends `frame` (JPEG), `url`, and `status` messages.
  - It accepts `input_mouse`, `input_keyboard`, and `input_touch`.
  - It is framed as "pair browsing".
  - There is no lock, pause, or "agent busy" concept. Only localhost origins are allowed.

---

## Cross-product summary

| Product | Takeover control | Handback | Tab mark | Page mark | Where the tab opens | Confirm style |
|---|---|---|---|---|---|---|
| Atlas (retired) | "Take control" / "Stop" bar at the bottom | yes (agent continues from prior state) | internal agent tabs | tint / sparkle overlay | in the browser, chat in a side panel | model asks; watch mode; logged-out mode |
| Claude in Chrome | "Stop Claude"; no takeover lock (inferred) | chat message "continue" | coloured "Claude" tab group with dots / check | pulsing orange glow border | new tabs in a group; side panel chat | per-Thread mode + per-site prompt + prohibited list + classifiers |
| Claude Desktop Browser pane | none documented | — | — | — | tabbed pane beside chat | per-site card; classifier prompts in every mode |
| Gemini auto browse | "Take over task" on the tab | "Resume" / "Give back task" in chat | cursor+sparkle icon | glow | new tab, background OK | plan approval; deterministic sensitive-site list; model pauses; forced takeover for pay / ToS / signup |
| Comet | stop / guidance buttons; take over | — | tab animations (weak) | pulsing blue highlight | in page; iOS cloud | model judgement; "Always Allow"; per-domain admin levels |
| Edge Copilot | interrupt / take control / stop | restart | cursor icon in tab | — | current or new tab, same window | Balanced (curated list) / Strict; hard code limits; drift model |
| Opera Neon | pause / stop / take over; play button | play | — | subtle glow | in page; side panel plan | plan approval; pauses on transactions / downloads |
| Browserbase / Steel / agent-browser | host builds it; interactive flag or `pointer-events` | host builds it | — | banner in host | remote browser | none |

---

## Options for Banda: confirming risky actions

Five designs seen in the field. Most products layer two or three of them.

### A. Rely on the Harness's tool-permission prompt
- **How**: browser tools are ordinary tools. The Harness (Claude Code, Codex) shows its own prompt in the Thread. Example: "Claude in Chrome wants to …", with "allow all on this site for the session". The Harness's mode (manual / auto / bypass) decides.
- **Seen in**: Claude Code + Claude in Chrome (CLI prompt; VS Code card in chat). Claude Code auto mode lets its classifier approve browser calls and skip the extension's own site check.
- **Pros**: no new UI. One consistent prompt surface in the Thread. It respects the mode the Person already chose.
- **Cons**: it differs per Harness. Banda does not own the semantics. Bypass or auto can wave everything through. The prompt is per tool call, not per risk, so "click" looks the same whether it is a link or "Pay". It cannot see page context unless the tool describes it.

### B. Per-site allow list (first action on a new origin asks)
- **How**: the first write action on an origin shows **Allow once / Always allow this site / Deny**, sometimes plus "all sites (elevated risk)". The list is saved per device and can be revoked in settings. Local dev origins are exempt.
- **Seen in**: Claude in Chrome, the Claude Desktop Browser pane, the Cowork browser, the ChatGPT Chrome extension, Comet (admin per-domain levels), Edge Strict mode. Edge Balanced is the inverse: a vendor-curated allow list.
- **Pros**: deterministic and cheap. Banda's browser code can enforce it at the CDP or webContents layer, whatever the Harness. Easy to explain. Exempting localhost keeps dev testing silent.
- **Cons**: coarse. Once a site is allowed, "Pay" on that site is allowed too. It causes prompt fatigue on research tasks that touch many sites. Subdomain handling needs care.

### C. Browser-side gates on classified risky actions
- **How**: Banda's browser layer detects risky moments and pauses the Agent with its own confirm UI in the Pane or the Thread. Two flavours:
  - **C1 deterministic**: navigation to a sensitive-site list (banks, health). Filling a password, card, or ID field. Form submit. Download. File picker. Permission prompt. Protocol handler.
  - **C2 model or classifier**: a critic or classifier flags purchases, sends, deletes, task drift, and injection.
- **Seen in**:
  - Gemini: deterministic sensitive-site list, plus model "will try to pause", plus User Alignment Critic, plus origin sets.
  - Edge: drift model and relevance-check dialog.
  - Claude Desktop Browser pane: classifier prompt "regardless of mode".
  - Claude in Chrome: "Automatically approve".
- **Pros**: targets the risky moment, not the site. C1 is cheap and explainable, and works the same for every Harness. The prompt can show what is about to happen ("Submit form on shop.example: 3 fields").
- **Cons**: C1 has false positives (every search box is a form) and misses cases (a JS "Buy" button with no form). C2 needs a model call per action, adds latency and cost, is probabilistic, and Banda would have to run or pick that model.

### D. Per-Thread mode (ask / auto / skip)
- **How**: a mode switch per Thread or session. For example: *Ask every action*, *Ask on new sites and risky actions* (default), *Auto with checks*, *Skip*. Shown in the composer, like the model picker.
- **Seen in**: Claude in Chrome (Manual / Auto / Skip, drop-down on the chat input, remembered). Comet ("Always Allow"). Edge (Balanced / Strict). Atlas (logged-in vs logged-out per task). Claude Code permission modes.
- **Pros**: the Person sets risk once per task. It fits Banda's Thread model and composer. It can map onto each Harness's own modes.
- **Cons**: one more control to understand. "Skip" is a footgun. It needs clear defaults and a visible mode marker in the Thread and on the tab.

### E. Forbidden categories plus forced handoff
- **How**: some actions the Agent never does. It hands the tab to the Person ("Take over to finish"). Typical list:
  - payment entry and final purchase
  - passwords and sign-in
  - account creation
  - accepting terms of service
  - CAPTCHAs
  - trades
  - permanent deletes

  Sometimes it is softened by a credential handoff, where a password manager fills the field and the model never sees it.
- **Seen in**:
  - Gemini: forced takeover for pay, terms of service, and signup.
  - Claude: "Prohibited (never perform)", which stays prohibited even with consent. Enforced by the prompt and the model. 1Password handoff.
  - Edge: no passwords, autofill, wallet, or downloads, enforced in code.
  - Atlas: no downloads, extensions, or passwords.
  - Neon: banking blacklisted.
  - Watch-mode variant: Atlas pauses on sensitive sites if the Person leaves the tab.
- **Pros**: the clearest safety story. No prompt fatigue. Hard-coding the gate in browser code (Edge style) beats prompt-only enforcement.
- **Cons**: it blocks the "last mile" users want to delegate (Claude issues #96762 and #105185 complain about exactly this, with no opt-out). If the gate is prompt-only, the Agent's refusal arrives late, deep in a task. It needs a good takeover-and-handback flow (see the UI patterns below).

**Note on layering**: most products combine B or D (coarse scope) with C (targeted pause) and E (hard floor). The products differ mainly in **who asks**:
- the model in chat: Atlas, Comet, and Claude's prohibited list
- the browser's own UI: Gemini, Edge, and the Claude Desktop site card

Browser-UI gates are deterministic and Harness-independent, which matters for Banda because it hosts several Harnesses.

---

## UI patterns for "an Agent drives this tab"

Common elements, from most to least common:

1. **Side panel or Thread with a live step log.** It shows what the Agent is doing now ("Opening the first result"), the plan, and Stop. Seen in every product.
2. **Glow or tinted border on the page.**
   - Claude: pulsing orange glow, a full-viewport overlay hidden during screenshots.
   - Gemini: glow.
   - Comet: pulsing blue.
   - Neon: subtle glow.
   - Atlas: tint or sparkle.

   Lesson from Claude's bug reports: an animated full-viewport overlay is expensive. Use a thin edge, respect `prefers-reduced-motion`, and stop animating while the Agent is idle or waiting.
3. **Tab-strip mark.** An icon on the tab: Gemini cursor+sparkle, Edge cursor icon. Or a coloured, named tab group with status: Claude's "Claude" group with working dots and a done check. Also Tabbit's isolated groups.
4. **Takeover control on or near the page.**
   - Atlas: "Take control" / "Stop" bar at the bottom.
   - Gemini: "Take over task" on the task tab.
   - Steel: example banner "Automated session - Click inside to take control".
5. **Explicit handback in chat.** Gemini "Resume" / "Give back task". Neon play button. Claude: the Person types "continue". ChatGPT agent "continues from the prior workflow state".
6. **"Needs you" notification.** Gemini notifies at the top of the browser, with "Check your task" and "Switch tabs" in chat. Neon has a "needs user action" UI. The Claude Code CLI asks the Person to handle logins and CAPTCHAs.
7. **Window-level indicator.** Gemini shows that auto browse is active at the top right, next to its spark.
8. **Privacy during takeover.** ChatGPT agent and Edge stop capturing screenshots while the Person is in control.
9. **Sound.** No product documents a sound for "Agent is working" or "needs you". Not found.

Where the Agent's tab opens:
- **New tab in the same window, can run in the background**: Gemini, Claude Code via Chrome, Edge (or the current tab).
- **Tab group**: Claude.
- **Browser pane or side panel beside the chat**: the Claude Desktop Code tab Browser pane and the Cowork browser. This is the closest match to Banda.
- **Hidden or remote**: Fellou "shadow workspace" window, the ChatGPT agent and Comet iOS cloud browsers, and Browserbase or Steel embedded live view.

What happens to Person input, in three models:
- **Explicit mode switch**: Take over → the Agent pauses → Resume or Give back. Gemini, Atlas / ChatGPT agent, Neon, Edge.
- **No lock**: input mixes in, and the Agent sees the new state on its next look. Claude in Chrome (inferred), and raw Browserbase, Steel, or agent-browser streams.
- **Agent-initiated handoff**: the Agent stops at a login, CAPTCHA, or payment and asks; the Person acts, then says continue in chat. Claude Code, plus Gemini's forced takeovers.

Nothing documents what text the Agent receives on handback, beyond:
- ChatGPT agent "attempts to continue from the prior workflow state"
- Claude: tab-state `<system-reminder>`s, and error tool_results on Stop (inferred)

## Gaps
- No official text on what Claude in Chrome does when the Person clicks during an action.
- No official text on whether Gemini, Comet, or Edge block page input before "Take over" is pressed.
- Comet's 2026 indicator change is unconfirmed.
- Atlas help pages are gone. Its UI details come from a launch-day post and the MIT index.
- Genspark and Fellou: no usable docs.
