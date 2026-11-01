# Hackable workspace: how plugin systems work, and options for Banda modules

- **Date:** 2026-11-01
- **Question:** How do Obsidian, VS Code, Zed, Zellij, Raycast, Notion (plus Anytype and AFFiNE), AI-made UI hosts (Claude Artifacts, tldraw make real, ChatGPT Apps SDK, MCP Apps) and Emacs/Electron handle extensions? What should Banda's module system look like, given that a non-developer should be able to ask an Agent to write a module inside the app?
- **Added on request:** (a) how systems keep their own built-in features on the public extension API; (b) how tools give Agents knowledge of themselves (skills, AGENTS.md, MCP instructions, llms.txt) and how to keep it current; (c) config kept as text files with live reload that both a Person and an Agent can edit safely.
- **Method:** Primary sources (official docs, API references, source code, the projects' own posts) read on 2026-11-01. Most pages were read through a summarising fetch tool. Quotes are as that tool returned them, so the short ones are reliable and the longer ones may be paraphrased. Source code (VS Code, Zed, Obsidian typings, Emacs manual sources, MCP schema) was downloaded and grepped directly. Third-party sources are marked as such. Limits are listed in section 13.
- **Status:** Research only. Nothing here is an accepted Banda decision.

---

## Key findings

1. **Almost no popular desktop plugin system sandboxes plugin code.** Obsidian, VS Code, Raycast and Emacs all run plugins with the app's own rights. Each one says so openly ([Obsidian](https://obsidian.md/help/Extending+Obsidian/Plugin+security), [VS Code](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security), [Raycast](https://developers.raycast.com/information/security)) and relies on review, open source and blocklists instead. The systems that really sandbox code are the WASM ones (Zed, Zellij, Figma's VM) and the AI-UI hosts (MCP Apps, ChatGPT, Claude Artifacts).
2. **Sandboxed iframe + JSON-RPC over postMessage is now the standard for untrusted, AI-adjacent UI.** MCP Apps (SEP-1865, stable spec 2026-01-26) merged MCP-UI and OpenAI's Apps SDK into one design. It requires a different origin for the frame, a CSP the module declares (with a deny-by-default fallback), consent hooks for tool calls the UI starts, and theme tokens the host passes in ([spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)). It shipped in Claude, ChatGPT, Goose and VS Code Insiders ([MCP blog, 2026-01-26](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)).
3. **The way to keep one look is to own the components.** Raycast renders React to native AppKit through its own reconciler, with "no HTML or CSS involved" ([FAQ](https://developers.raycast.com/misc/faq)), and extensions can send only registered messages ([blog](https://raycast.com/blog/how-raycast-api-extensions-work)). Iframe-based systems (VS Code webviews, MCP Apps) can only suggest a look through CSS variables. VS Code tells authors to use webviews "only if you absolutely need them" ([UX guidelines](https://code.visualstudio.com/api/ux-guidelines/webviews)).
4. **Capabilities are cheap to put in early and painful to add late.** When Zellij added permissions in 0.38, every plugin had to add `request_permission` calls ([upgrade guide](https://zellij.dev/documentation/plugin-upgrade-0.38.0)). Obsidian says it "cannot reliably restrict plugins" after the fact ([Obsidian](https://obsidian.md/help/Extending+Obsidian/Plugin+security)).
5. **Built-ins on the public API is the norm, and every system has an exception lane.** VS Code's git, markdown and TypeScript support are extensions, but built-ins are exempt from the proposed-API gate (built-in git enables 34 proposals). Zellij's own UI is plugins, but only "externally loaded plugins" must ask for permissions. Zed keeps its most-used languages native and moves the rest to the same extension API. Obsidian's core plugins appear to run on internals (their types are not in the public typings): only Bases has a public extension point, and Canvas is open as a file format rather than an API.
6. **Agent-written apps already work as products.** Claude Artifacts let a person describe an app, Claude writes the code, and each capability is approved on first use (calling Claude, connectors, personal or shared storage) ([help](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them)). Notion Workers are "designed to be built with AI coding agents" ([Notion docs](https://developers.notion.com/workers/get-started/overview.md)). The pattern in both: the Agent writes code against a small, documented contract; the host enforces capabilities; the person approves in plain words.
7. **Agent-facing self-knowledge has converged on progressive disclosure.** A short description is always loaded and the body loads on demand. Claude Code skills, Codex skills (both follow agentskills.io), MCP `instructions` plus `tools/list`, and llms.txt all work this way. Content generated from manifests (VS Code `contributes`, MCP tool lists, Raycast `ai` evals) stays current. Hand-written prose goes stale.
8. **Recommendation (section 12): manifest-first modules.** A module is a `module.toml` plus content in one of two tiers. Tier 1 is declarative Panes built from Banda's own blocks, the default for Agent-written modules. Tier 2 is a sandboxed-frame Pane with an MCP-Apps-compatible bridge, as an escape hatch. In both tiers, the logic runs in a separate process that holds a capability-scoped token for the same engine API. First-party modules should adopt the manifest and the "public API only" rule now.

---

## 1. Obsidian (community plugins, core plugins)

| Aspect | Finding |
|---|---|
| What a plugin can do | Custom views in workspace leaves (`ItemView` + `registerView`) ([docs](https://docs.obsidian.md/Plugins/User+interface/Views)). Ribbon icons, commands and settings tabs ([tutorial](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)). Markdown code-block processors, CodeMirror 6 editor extensions, `obsidian://` URL handlers, editor suggesters, Bases views (`registerBasesView`, since 1.10.0) and CLI handlers (`registerCliHandler`, since 1.12.2), all in the public typings ([obsidian.d.ts](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)). Network goes through `requestUrl` (same file). |
| Packaging / loading | A folder in `<vault>/.obsidian/plugins/<id>/` holding `main.js` (compiled from TypeScript), `manifest.json` and an optional `styles.css`. The sample plugin is built with `npm run dev`. Reload by toggling the plugin or with the community Hot-Reload plugin ([tutorial](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)). Plain JS runs in the Electron renderer. |
| Manifest | `id`, `name`, `version`, `minAppVersion`, `description`, `author`, `isDesktopOnly`, plus optional URLs. **There are no permission fields** ([manifest](https://docs.obsidian.md/Reference/Manifest)). |
| Isolation / permissions | None. "Obsidian cannot reliably restrict plugins to specific permissions or access levels"; plugins "inherit Obsidian's access levels". The only gate is **Restricted mode**, which is on by default: "By default, Obsidian runs in Restricted Mode to prevent third-party code execution." The user turns it off once, for all plugins ([plugin security](https://obsidian.md/help/Extending+Obsidian/Plugin+security)). |
| Review | Obsidian "automatically scans every plugin version for security vulnerabilities, code quality issues, and malware" and shows a safety scorecard; "Manual reviews continue for popular, featured, and flagged plugins" ([plugin security](https://obsidian.md/help/Extending+Obsidian/Plugin+security)). |
| Distribution / updates | The author submits once at community.obsidian.md. "Obsidian downloads main.js, manifest.json, and styles.css from the GitHub release whose tag matches the version." Updates are new GitHub releases ([submit](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)). A local folder works for development. |
| Data | `saveData`/`loadData` write to `data.json` in the plugin folder ([saveData](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/saveData)). User content is Markdown plus properties in the vault. |
| Talking to other plugins | No official channel. The public typings have no `getPlugin` or `internalPlugins` (grep of [obsidian.d.ts](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)). The guidelines say to "Avoid using the global app object", which "might be removed in the future" ([guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)). |
| Look | Guidelines ask plugins to use Obsidian's CSS variables, because "hardcoding the styling ... makes it impossible to modify with themes" ([guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)). This is advice, not enforcement. |
| First plugin | Clone the sample plugin into a dedicated dev vault, run `npm install` and `npm run dev`, enable it in settings, edit `main.ts` ([tutorial](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)). |

**Core plugins (Bases, Canvas).** Core plugins are "officially built and supported by the Obsidian team" and are switched on in Settings → Core plugins. The list includes Bases, Canvas, Web viewer, Slides and Sync ([core plugins](https://obsidian.md/help/plugins)). Bases is "a core plugin". It shows database-like views (Table, List, Cards, Kanban, Map) over notes, and "All the data in Obsidian Bases is stored in your local Markdown files and their properties". View definitions live in a `.base` file or a code block. "Community plugins can add more layouts" ([Bases](https://obsidian.md/help/bases)) through `registerBasesView` ([API](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerBasesView)). Canvas has no public plugin API in the typings. It is open instead as a file format: JSON Canvas, "originally created for Obsidian", stored in `.canvas` files ([jsoncanvas.org](https://jsoncanvas.org/)).

**Lesson for Banda:** Obsidian is the closest product to "hackable for non-developers", and its key moves are data the person owns (Markdown, `.base`, `.canvas`) and an easy dev loop. Its weak point is all-or-nothing trust.

## 2. VS Code

| Aspect | Finding |
|---|---|
| What an extension can do | Declarative **contribution points** in `package.json`: commands, menus, keybindings, views, viewsContainers, customEditors, configuration, languages, themes, walkthroughs, authentication, terminal, and now `chatAgents`, `chatSkills`, `languageModelTools` and `languageModelChatProviders` ([contribution points](https://code.visualstudio.com/api/references/contribution-points)). Code adds behaviour through the `vscode` API. |
| Runtime | One or more **extension hosts**: Node.js locally, Node.js remotely, or a browser WebWorker. The host keeps extensions from slowing or "modifying the UI" ([extension host](https://code.visualstudio.com/api/advanced-topics/extension-host)). Extensions never touch the workbench DOM. |
| Activation | Lazy, through `activationEvents` (`onCommand`, `onLanguage`, `onView`, `onStartupFinished`, `*`, `onWebviewPanel`). Since 1.74, contributed commands, views and so on activate implicitly ([activation events](https://code.visualstudio.com/api/references/activation-events)). |
| Custom UI | **Webviews**: "Think of a webview as an iframe within VS Code that your extension controls." Scripts are off by default (`enableScripts`), and `localResourceRoots` limits local files. The recommended CSP is `default-src 'none'; img-src ${webview.cspSource} https:; script-src ${webview.cspSource}; style-src ${webview.cspSource};`. The page talks to the extension with `postMessage` and `acquireVsCodeApi()`. State is kept with `getState`/`setState` and a serializer for restart, and theming uses `--vscode-*` CSS variables. Webviews are "resource heavy" and are meant for when "VS Code's native API is inadequate" ([webview guide](https://code.visualstudio.com/api/extension-guides/webview)). |
| Isolation / permissions | "The extension host has the same permissions as VS Code itself", with no runtime sandbox. Marketplace protections: antivirus scan before publish, signature verification on install, verified publishers, a block list that auto-uninstalls, and (since 1.97) a prompt to trust a third-party publisher ([runtime security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security)). **Workspace Trust** guards against untrusted *workspace content*, not extensions. Extensions declare `capabilities.untrustedWorkspaces` as `true`, `false` or `"limited"` ([workspace trust](https://code.visualstudio.com/api/extension-guides/workspace-trust)). |
| Distribution | Marketplace or a VSIX file. |
| Data | `globalState` and `workspaceState` (key-value), `secrets` (encrypted), and `storageUri`/`globalStorageUri` (private folders) ([common capabilities](https://code.visualstudio.com/api/extension-capabilities/common-capabilities)). |
| Talking to other extensions | Commands (`vscode.commands`). An extension can also return an API from `activate`; others declare `extensionDependencies` and read `exports` ([API reference](https://code.visualstudio.com/api/references/vscode-api)). |
| Tools for Agents | `contributes.languageModelTools` (name, `modelDescription`, `inputSchema`) plus `vscode.lm.registerTool`. `prepareInvocation` returns confirmation messages, and users can pick "Always Allow". The docs compare this with MCP servers: extension tools for deep editor access, MCP for cross-tool reuse ([AI tools](https://code.visualstudio.com/api/extension-guides/ai/tools)). |
| First extension | `npx --package yo --package generator-code -- yo code`, then F5 opens an Extension Development Host; "Developer: Reload Window" picks up changes ([first extension](https://code.visualstudio.com/api/get-started/your-first-extension)). |

**Lesson:** the manifest-declared contribution points are the strongest idea here. They make the app's surface machine-readable (settings UI, command palette, schemas), let the app activate extensions lazily, and let first-party and third-party extensions use the same mechanism (section 9).

## 3. Zed and Zellij (WASM)

### Zed extensions

- **What they can do:** languages (Tree-sitter grammars, queries, language servers), debuggers, themes, icon themes, snippets and MCP servers ([developing extensions](https://zed.dev/docs/extensions/developing-extensions)). Extension slash commands "have been removed from Zed"; MCP servers are now the way to extend the Agent Panel ([Zed docs mirror](https://git.secluded.site/zed/blob/pr-53295/docs/src/extensions/slash-commands.md?raw=1)). **No custom UI:** an RFC for panels and status-bar items (#53403, 2026-04-08) got a maintainer reply on 2026-05-21: "not something we're likely to get to in the near future, but it's very much on our radar" ([discussion](https://github.com/zed-industries/zed/discussions/53403)).
- **Packaging / runtime:** a Git repository with an `extension.toml`. Code is optional and written in Rust against `zed_extension_api`, then compiled to `wasm32-wasip2` ([developing extensions](https://zed.dev/docs/extensions/developing-extensions)). The API is defined in WIT (the WebAssembly component model); the host uses `wasmtime::component::bindgen!` and the extension uses `wit_bindgen`. Calls into extensions are async, so a slow download does not block the editor ([Zed blog, 2024-10-21](https://zed.dev/blog/zed-decoded-extensions)).
- **Permissions:** a capability system controlled by the user setting `granted_extension_capabilities`. Capabilities are `process:exec` (a specific command or `*`), `download_file` (host and path globs) and `npm:install` (a package or `*`). Narrowing a capability makes the matching API call return an error, and an empty list "will likely make many extensions non-functional" ([capabilities](https://zed.dev/docs/extensions/capabilities)).
- **Distribution:** a PR to `zed-industries/extensions`. CI builds `archive.tar.gz` (the WASM plus `.scm` queries) and uploads it, and users download the archive, never the source ([Zed blog](https://zed.dev/blog/zed-decoded-extensions)). Local work uses "Install Dev Extension", which overrides any published copy ([developing extensions](https://zed.dev/docs/extensions/developing-extensions)).
- **Data:** the host exposes a key-value store and HTTP client resources to extensions ([Zed blog](https://zed.dev/blog/zed-decoded-extensions)).

### Zellij plugins

- **What they can do:** "A Zellij plugin is a first class citizen in the workspace, just like a terminal pane". Plugins render UI in a pane, react to events and control Zellij. "Rust is the only language officially supported", and Zellij's own UI is built from plugins ([plugins](https://zellij.dev/documentation/plugins)).
- **Loading:** `file:/abs/path.wasm`, `https://…`, `zellij:tab-bar` (built-ins) or aliases. Plugins load from layouts, keybindings, the `zellij plugin` CLI, `load_plugins` at startup or the plugin manager ([plugin loading](https://zellij.dev/documentation/plugin-loading)). Dev loop: the example repo's layout runs `cargo build` and then `zellij action start-or-reload-plugin` ([dev env](https://zellij.dev/documentation/plugin-dev-env)).
- **Permissions:** 14 named permissions, including ReadApplicationState, ChangeApplicationState, OpenFiles, RunCommands, WriteToStdin, FullHdAccess, InterceptInput, ReadPaneContents, RunActionsAsUser and WriteToClipboard ([permissions](https://zellij.dev/documentation/plugin-api-permissions)). The plugin calls `request_permission`, which "will display a help screen asking the user to approve". Grants are cached in a `permissions.kdl` file that the user can edit ([0.38.0 release](https://github.com/zellij-org/zellij/releases/tag/v0.38.0)). "Externally loaded plugins must now request permission" ([0.38 news](https://zellij.dev/news/session-manager-protobuffs/)).
- **File system:** `/host` (the cwd), `/data` (the plugin's own folder, shared by its instances) and `/tmp` ([file system](https://zellij.dev/documentation/plugin-api-file-system)).
- **Talking to each other:** **pipes**, one-way named messages with payloads. They go plugin to plugin (the receiver learns the sender id), as broadcasts, or from the CLI (stdin and stdout with backpressure) ([pipes](https://zellij.dev/documentation/plugin-pipes)).

**Lesson:** WASM gives a real sandbox and a typed contract (WIT). The cost is a compile toolchain for authors, which is a poor fit for an Agent writing a module live inside the app, and neither project lets extensions bring their own look.

## 4. Raycast

- **What an extension can do:** commands in three modes, `view` (a UI), `no-view` (a script) and `menu-bar`. `interval` runs no-view and menu-bar commands in the background, at a minimum of `1m`. Extensions also contribute preferences (textfield, password, checkbox, dropdown, file and so on), arguments, and `tools` for the AI ([manifest](https://developers.raycast.com/information/manifest)). AI extensions add `ai` instructions and **evals** ("like integration tests") to the manifest. An exported `confirmation` function runs before a tool, and "If the user cancels, the tool doesn't run" ([AI concepts](https://developers.raycast.com/ai/learn-core-concepts-of-ai-extensions)).
- **UI kit:** "Raycast uses React for its user interface declaration and renders the supported elements to our native UI." The kit is List, Grid, Detail, Form and ActionPanel with keyboard shortcuts ([UI API](https://developers.raycast.com/api-reference/user-interface)); "There isn't any HTML or CSS involved" ([FAQ](https://developers.raycast.com/misc/faq)). Raycast wrote a custom React reconciler that serialises each render to a JSON "render tree", diffs it with JSON Patch, and has Swift build AppKit views from it. The explicit goal was to avoid "a second-class mini-app that shows in some frame" ([blog, 2023-05-31](https://raycast.com/blog/how-raycast-api-extensions-work)). **This is why every Raycast extension looks like Raycast.**
- **Runtime / isolation:** "a single child Node.js process where extensions get loaded and unloaded"; each extension runs in its own worker thread (a V8 isolate) with a heap limit. Extensions are "not further sandboxed as far as policies for file I/O, networking" ([security](https://developers.raycast.com/information/security)). The IPC is JSON-RPC over file-descriptor streams, and extensions can only send registered messages (such as `render` and `setClipboard`) ([blog](https://raycast.com/blog/how-raycast-api-extensions-work)). Commands unload when the user leaves them, and memory limits terminate greedy ones ([lifecycle](https://developers.raycast.com/information/lifecycle)).
- **Trust:** "All extensions are open source", and Raycast staff and community review every PR ([security](https://developers.raycast.com/information/security)).
- **Distribution:** `npm run publish` opens a PR on `raycast/extensions`, and accepted extensions publish automatically to the Store ([publish](https://developers.raycast.com/basics/publish-an-extension)).
- **Data:** a "local encrypted database [that] can only be accessed by the corresponding extension", plus the Keychain for secrets ([security](https://developers.raycast.com/information/security)).
- **First extension:** the "Create Extension" command offers templates; then `npm install` and `npm run dev`, which is "development mode with hot reloading" ([first extension](https://developers.raycast.com/basics/create-your-first-extension)); `npx ray develop` reloads "automatically ... when you save" ([CLI](https://developers.raycast.com/information/developer-tools/cli)).

**Lesson:** Raycast is the model for "one design language". Authors use React, but the host owns every pixel. It is also the cleanest example of a narrow, message-based host API, even though Raycast chose review over a sandbox.

## 5. Notion, Anytype, AFFiNE

- **Notion blocks:** "Everything you see in Notion is a block." Each block has an id, a type ("defines how a block is displayed"), properties, content (child ids) and a parent. "Changing the type of a block doesn't change the block's properties or content." Permissions follow the parent pointer, and database rows are page blocks with properties ([Notion blog, 2021-05-18](https://www.notion.com/blog/data-model-behind-notion)).
- **Notion developer platform (2026-05-13):** **Workers** are "our hosted runtime for custom code". They run "in a secure sandbox" on Notion's infrastructure and provide database syncs, custom agent tools and webhook triggers. There is also a CLI, an External Agents API (alpha; Claude and Codex named) and an Agent SDK (alpha) ([release notes](https://www.notion.com/releases/2026-05-13)). Workers are "small Node/TypeScript programs"; capability types are sync, tool and webhook; "Your code runs in a sandboxed Node.js environment"; secrets are injected as environment variables; and "Workers are designed to be built with AI coding agents", with a template that ships prompts and skills ([Workers overview](https://developers.notion.com/workers/get-started/overview.md)). **I found no primary source for third-party custom UI blocks in Notion.** The platform is headless: code adds data and tools, while Notion owns all rendering.
- **Anytype:** a localhost **Local API** (developer preview, desktop 0.46) that "opens up powerful new possibilities for an ecosystem of plugins". Early tools include an MCP server and a Raycast extension ([release](https://releases.any.org/desktop-046-6)). I found no in-app plugin loader.
- **AFFiNE / BlockSuite:** BlockSuite supports "Defining custom blocks and inline embeds" and replacing toolbars and widgets, and AFFiNE should reuse it "without any privileges" ([BlockSuite guide](https://blocksuite.io/guide/overview.html)). This is a build-time framework, not a runtime plugin system for users.

**Lesson:** Notion keeps one look by allowing **no third-party UI at all**. Extension happens through data (databases, properties, views) and headless code (Workers, tools for agents). It is a strong precedent for "declarative modules from our blocks" plus "logic runs elsewhere".

## 6. Agent-written apps and UI made for AI

### Claude Artifacts (state on 2026-11-01)
- **Model:** "Describe what you want, Claude writes the code, and the app runs on Anthropic's infrastructure."
- **Capabilities, each approved on first use:**
  - **Calling Claude:** "New artifacts ask you for permission the first time they want to use Claude", and usage "counts against each person's own plan limits".
  - **Connectors:** "Claude shows which apps and tools it will use and asks you to approve them", and "your choice carries over to later uses of that artifact". "Connector tools that need approval for each action aren't available to artifacts", and "Everyone connects their own apps".
  - **Storage:** personal ("Everyone keeps their own private data") or shared ("Everyone sees and works with the same data"), with a confirmation the first time shared storage is used. The limit is "20 MB ... text only".
- **Sharing:** "Artifacts start private to you." Artifacts made before 2026-09-16 are legacy ([help center](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them)).
- **Isolation:** not described in Anthropic's help article. Simon Willison describes artifacts as running in "a strictly controlled browser sandbox" with CSP and iframe sandboxing. He also showed that a CSP `<meta>` tag injected into a `sandbox="allow-scripts"` frame cannot be removed by script ([Willison, 2026-04-03](https://simonwillison.net/2026/apr/3/test-csp-iframe-escape)).
- **Observed in this session (no public URL):** the Claude Code Artifact tool's own contract has a page *declare* runtime capabilities at publish time. It loads only from an allowlist of CDNs with exact versions, and it requires a design-guidance skill to be loaded before the page is written. That is a working example of an Agent-written UI held to one design language by a skill plus checks at publish time.

### tldraw "make real" (2023-11-18)
A PNG snapshot of the selected sketch goes to GPT-4V, the returned HTML is placed on the canvas as an iframe shape, and the user iterates by drawing on top. The model gets "the previous result's HTML, together with a note to 'fill in' the white box", because iframe contents export as empty ([tldraw blog](https://tldraw.dev/blog/make-real-the-story-so-far)). The post does not discuss sandboxing. It shows that generated UI is easiest to iterate on when it is a first-class object in the workspace.

### OpenAI Apps SDK (ChatGPT apps)
- **Now an MCP Apps host:** components "run inside an iframe in ChatGPT, communicate with the host through the MCP Apps bridge" (JSON-RPC over `postMessage`). The UI is a resource with MIME type `text/html;profile=mcp-app`, linked from tools by `_meta.ui.resourceUri`; `openai/outputTemplate` remains as an alias.
- **Extras and state:** `window.openai` adds ChatGPT-only extras that must be feature-detected. "Widget state belongs to one rendered UI instance", and apps should "Avoid `localStorage` for core state".
- **CSP and review:** the CSP is declared in `_meta.ui.csp` (`connectDomains`, `resourceDomains`, `frameDomains`), "Nested frames are blocked by default", and review checks the declared policy against what the UI actually does ([ChatGPT UI](https://developers.openai.com/apps-sdk/build/chatgpt-ui)).
- **Security guide:** "Widgets run inside an isolated iframe with a strict Content Security Policy" and "cannot access privileged browser APIs"; the guide asks for "human confirmation for irreversible operations" ([security](https://developers.openai.com/apps-sdk/guides/security-privacy)).

### MCP Apps / MCP-UI (the standard)
- **History:** SEP-1865 was created 2025-11-21 and is now Final (Extensions Track). It unifies MCP-UI (which had HTML, external-URL and remote-DOM content types) with the Apps SDK. The MVP is **HTML only**, chosen for the "Simplest security model (standard iframe sandbox)" and so hosts can take screenshots. UI is **predeclared** as `ui://` resources so hosts can prefetch and review it ([SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)). The stable spec is `2026-01-26`. SDK packages are `@modelcontextprotocol/ext-apps` (the `App` class), `/react`, `/app-bridge` (for hosts) and `/server`. Listed hosts include ChatGPT, Claude, VS Code, Goose and Postman ([ext-apps repo](https://github.com/modelcontextprotocol/ext-apps)).
- **Sandbox rules:** "The Host and the Sandbox MUST have different origins." The sandbox has `allow-scripts` and `allow-same-origin`, which is safe only because of the separate origin (MDN warns that the pair on a *same-origin* frame "lets the embedded document remove the sandbox attribute" ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe))). Web hosts "MUST wrap the View ... through an intermediate Sandbox proxy".
- **CSP:** declared in `_meta.ui.csp` (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`). If it is omitted, the host applies `default-src 'none'` and `connect-src 'none'`, and hosts "MUST NOT allow undeclared domains".
- **Permissions:** `_meta.ui.permissions` covers `camera`, `microphone`, `geolocation` and `clipboardWrite`, and apps "SHOULD NOT assume permissions are granted".
- **What the View can call:** `tools/call`, `resources/read`, `ui/message`, `ui/open-link`, `ui/request-display-mode`, `ui/update-model-context` and logging.
- **Host context:** `theme`, `styles.variables` (CSS custom properties such as `--color-text-primary`), `css.fonts`, `displayMode` (inline, fullscreen or pip) and `locale`.
- **Tool visibility:** `_meta.ui.visibility` is `["model","app"]` by default. A host "MUST NOT include tools in the agent's tool list" without `model`, and must reject app calls to tools without `app`.
- **Consent:** hooks only, using MAY and SHOULD ("MAY ... subject them to further user approval"; "SHOULD warn users when UI requires external domain access") ([spec 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)).
- **Launch (2026-01-26):** "MCP Apps are now live as an official MCP extension", in Claude (web and desktop), Goose, VS Code Insiders, and ChatGPT ("starting this week"). The four security layers are sandboxed iframes, predeclared templates, auditable JSON-RPC and user consent; "users should continue to proactively and thoroughly vet MCP servers" ([MCP blog](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)).

**Lesson:** MCP Apps is close to the frame half of a Banda third-party Pane. It also defines the separation of "tools the Agent sees" from "tools only the UI may call". Its host context passes theme *variables*, which is a hint about look, not a guarantee.

## 7. Emacs, and Electron/web plugin sandboxing practice

**Emacs (the hackability extreme).** "New commands are simply programs written in the Lisp language ... Existing commands can even be redefined in the middle of an editing session, without having to restart Emacs. Most of the editing commands in Emacs are written in Lisp; the few exceptions could have been written in Lisp but use C instead for efficiency. Writing an extension is programming, but non-programmers can use it afterwards." ([Emacs manual source, emacs.texi](https://github.com/emacs-mirror/emacs/blob/master/doc/emacs/emacs.texi)). Packages come from GNU ELPA and NonGNU ELPA by default, with optional signature checks (`package-check-signature`). `package-review-policy` lets a cautious user "browse the source code, examine a diff between the downloaded package and a previous installation" before installing ([package.texi](https://github.com/emacs-mirror/emacs/blob/master/doc/emacs/package.texi)). There is no isolation at all. Built-ins and user code are the same kind of thing.

**Electron practice for untrusted content** ([Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)):
- **Renderer settings:** no Node integration in renderers that show remote content, context isolation, "enable the sandbox in all renderers", and a CSP.
- **IPC:** "All Web Frames can in theory send IPC messages to the main process, including iframes", so validate the `sender` of every IPC message.
- **Loading and permissions:** serve content from a custom protocol rather than `file://`. Electron "will automatically approve all permission requests" unless you set `setPermissionRequestHandler`. Limit `will-navigate` and new windows.
- **Background code:** `utilityProcess` forks a Node child through Chromium's services API, with `MessagePortMain` transfer ([utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)). MessagePorts let renderers and workers talk "without going through the main process" ([message ports](https://www.electronjs.org/docs/latest/tutorial/message-ports)).

**Figma (the classic split, 2019).** Plugin logic runs in a sandbox with a "whitelisted, audited" document API: first the Realms shim, later a JS VM in C compiled to WebAssembly. Plugin UI runs in a **null-origin iframe**, and "These two parts ... communicate with each other via message passing." Iframes alone were rejected because async message passing was awkward for designers and copying large documents was slow ([Figma blog](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/)).

**Deno (a capability runtime for a separate process).** "Deno is secure by default": there is no file, network, env or subprocess access without flags, and flags can be scoped (`--allow-net=example.com`, `--allow-read=./data`). Treat `--allow-run` and `--allow-ffi` "as equivalent to `--allow-all`" ([Deno security](https://docs.deno.com/runtime/fundamentals/security/)).

## 8. Side-by-side

| System | Code runs in | Custom UI | Sandbox | What the user approves | Distribution | Own data | Ext ↔ ext |
|---|---|---|---|---|---|---|---|
| Obsidian | Renderer (JS) | Full DOM in leaves | None | Turn off Restricted mode once | Directory + GitHub releases; folder | `data.json`, vault files | Unofficial |
| VS Code | Extension host (Node/worker) | Native contributions; webview iframe | None for code; webview CSP | Trust publisher; Workspace Trust | Marketplace, VSIX | KV, secrets, folders | Commands, `exports` |
| Zed | WASM (wasmtime) | None | WASM + capabilities | Edit `granted_extension_capabilities` | Registry PR → archive; dev folder | Host KV | None found |
| Zellij | WASM/WASI | Pane rendering | WASM + 14 permissions | Prompt per plugin, cached | URL, file, built-in | `/data` | Pipes |
| Raycast | Node worker per ext | Host-rendered React kit only | None (isolates for stability) | Nothing at runtime; store review | Store PR | Encrypted DB, Keychain | `launchCommand` between commands |
| Notion | Notion-hosted Node sandbox | None (Notion renders) | Hosted sandbox | Workspace access/sharing | CLI deploy | Notion DBs | Via data |
| MCP Apps / ChatGPT | Server anywhere; UI in iframe | HTML in iframe | Separate-origin iframe, CSP | Host consent hooks | MCP server / directory | Server-side | Via host |
| Claude Artifacts | Anthropic-hosted page | HTML page | Sandboxed page (not officially documented) | Per capability, first use | Private link / share | Personal/shared storage | Connectors |
| Emacs | Same Lisp image | Buffers | None | Optional review of source/diff | ELPA, git | Files, variables | Plain function calls |

## 9. Built-ins on the public extension API (added on request)

**What each system does:**
- **VS Code:** git, markdown, TypeScript/JS, emmet, npm, GitHub auth, all themes, the simple browser and Copilot all live under `extensions/` in the repo ([vscode/extensions](https://github.com/microsoft/vscode/tree/main/extensions)), with a `package.json` and contribution points like anyone else's. **The exception lane:** built-ins may use *proposed* (unstable) APIs. The gate in `extensionsProposedApi.ts` nulls a third-party extension's proposals with `if (!extension.isBuiltin && …)`, and `product.json#extensionEnabledApiProposals` can allowlist specific external extensions ([source](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/extensions/common/extensionsProposedApi.ts)). The built-in git extension enables **34** proposals, and markdown enables 8 (counted from [git/package.json](https://github.com/microsoft/vscode/blob/main/extensions/git/package.json) on 2026-11-01). Marketplace extensions "should not" use proposed APIs ([proposed API](https://code.visualstudio.com/api/advanced-topics/using-proposed-api)). The editor, terminal, SCM view and debug UI frames stay in core, and extensions plug *providers* into them.
- **Zed:** the most-used languages (Rust, TS, Python, Go, C/C++, JSON, YAML and others) are built in with native adapters in `crates/languages`. "Support for all other languages is done via extensions", and Zed-maintained ones "use the same zed_extension_api available to all". There is a documented procedure for **extracting** a built-in language into its own extension repository ([extensions/README](https://github.com/zed-industries/zed/blob/main/extensions/README.md), [EXTRACTION.md](https://github.com/zed-industries/zed/blob/main/extensions/EXTRACTION.md)).
- **Zellij:** "Zellij's own UI is built from plugins" ([plugins](https://zellij.dev/documentation/plugins)). Built-ins load by `zellij:` URLs such as `zellij:tab-bar` ([plugin loading](https://zellij.dev/documentation/plugin-loading)), and the session manager is "implemented as a built-in plugin". Built-ins skip the permission prompt: "Externally loaded plugins must now request permission" ([0.38 news](https://zellij.dev/news/session-manager-protobuffs/)).
- **Obsidian:** core plugins are toggled in settings much like community plugins ([core plugins](https://obsidian.md/help/plugins)), but they appear to run on internals. The public typings mention `InternalPluginSettingTab` only in a comment and do not export it, and they have no Canvas API ([obsidian.d.ts](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)). Obsidian opens core features in two ways: a narrow public extension point when demand is clear (Bases, `registerBasesView`, 1.10), and **open file formats** (`.base`, JSON Canvas).
- **Raycast:** extensions get a fixed set of registered messages ([blog](https://raycast.com/blog/how-raycast-api-extensions-work)). I found no primary source saying Raycast's own built-in commands use the public extension API, so treat it as a host that keeps its core native.
- **Emacs:** no lane at all. Built-ins are Lisp like everything else, except C primitives "for efficiency" ([emacs.texi](https://github.com/emacs-mirror/emacs/blob/master/doc/emacs/emacs.texi)).
- **AFFiNE:** BlockSuite's stated goal is that AFFiNE reuses it "without any privileges" ([BlockSuite](https://blocksuite.io/guide/overview.html)).

**What dogfooding forces:**
- **A manifest for every built-in.** The registry, settings UI, keybinding list and command palette are all generated from manifests (VS Code `contributes`, Zed `extension.toml`).
- **No private paths into the host.** Built-ins can't import workbench internals, which is what keeps the extension host boundary honest (VS Code).
- **Lazy activation** applies to built-ins too.
- **A versioned API** (Zed records the extension API version each extension was compiled against: [Zed blog](https://zed.dev/blog/zed-decoded-extensions)).

**Why they made exceptions:**
- **Speed of iteration:** a flagship feature needs unstable API before it can be frozen (VS Code proposals).
- **Performance and depth:** native languages in Zed; Figma moved plugin logic onto the main thread because copying the document was too slow.
- **Trust:** built-ins skip consent prompts (Zellij).
- **Not yet designed:** Obsidian Canvas, and Zed's UI API.

**What broke:**
- **Obsidian:** plugins that reach into internals carry explicit warnings. PDF++ relies on "Obsidian's internals that is not exposed as a part of the public API", and "Obsidian's authors may rewrite such non-public code", so users may have to stay on old versions ([PDF++ #48, 2024-02-18](https://github.com/RyotaUshio/obsidian-pdf-plus/discussions/48)).
- **VS Code:** extensions that patch core files make the title show "[Unsupported]", and the patch is lost on the next update ([FAQ](https://code.visualstudio.com/docs/supporting/faq)). Its own proposal gate logs that an extension "WILL BE BROKEN unless product.json is updated" when declarations drift ([source](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/extensions/common/extensionsProposedApi.ts)).
- **Zed:** slash commands were added to the public API (per the [2024 blog](https://zed.dev/blog/zed-decoded-extensions)) and then removed as "virtually completely unused" (commit message reported by a [search result](https://git.secluded.site/zed/commits/sentry?page=7), a third-party mirror).
- **Zellij:** adding permissions in 0.38 forced every plugin to change ([upgrade guide](https://zellij.dev/documentation/plugin-upgrade-0.38.0)).

## 10. How tools ship Agent-facing knowledge of themselves (added on request)

- **Claude Code skills:** a skill is `SKILL.md` with YAML frontmatter (`description` recommended; `name`, `allowed-tools`, `disable-model-invocation`, `user-invocable` optional) plus optional supporting files. Locations: enterprise (managed directory), personal `~/.claude/skills/<name>/`, project `.claude/skills/<name>/`, and plugin `<plugin>/skills/<name>/` (namespaced). "skill descriptions are loaded into context so Claude knows what's available, but full skill content only loads when invoked"; keep `SKILL.md` under 500 lines and move detail into referenced files. Skills follow the **Agent Skills** open standard at agentskills.io ([Claude Code skills](https://code.claude.com/docs/en/skills)).
- **Codex:** `AGENTS.md` is read once per session from `~/.codex`, then from the repo root down to the cwd (at most one file per directory, `AGENTS.override.md` first), with closer files later so they win. The total is capped by `project_doc_max_bytes`, 32 KiB by default ([AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)). Codex **skills** use the same `SKILL.md` format, found in `.agents/skills` (cwd up to the repo root), `$HOME/.agents/skills`, `/etc/codex/skills` and bundled system skills. Name and description load first and the body loads after selection. An optional `agents/openai.yaml` holds UI metadata and `allow_implicit_invocation` ([Codex skills](https://learn.chatgpt.com/docs/build-skills.md)).
- **MCP:** the server's `initialize` result can carry `instructions`: "Instructions describing how to use the server and its features ... like a 'hint' to the model ... MAY be added to the system prompt" ([schema 2025-11-25](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-11-25/schema.ts)). Tools carry descriptions and input schemas, and servers can send list-changed notifications (`listChanged`) ([lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)). The current spec revision is 2026-07-28 (folder list of the [schema repo](https://github.com/modelcontextprotocol/modelcontextprotocol/tree/main/schema)), which I did not review.
- **llms.txt:** a proposal (Jeremy Howard, 2024-09-03; v2 2026-08-10). It is a Markdown `/llms.txt` with an H1, a summary, and H2 lists of links, plus `.md` copies of pages, mainly for inference-time use ([llmstxt.org](https://llmstxt.org/)). Docs platforms now generate it. Pages on modelcontextprotocol.io and developers.notion.com start with "Documentation Index: Fetch the complete documentation index at …/llms.txt" (observed while fetching).
- **In-manifest guidance:** VS Code `languageModelTools[].modelDescription` ([AI tools](https://code.visualstudio.com/api/extension-guides/ai/tools)); Raycast `ai.instructions` and `ai.evals` ([Raycast AI](https://developers.raycast.com/ai/learn-core-concepts-of-ai-extensions)); the Notion Workers template ships prompts and skills for coding agents ([Workers](https://developers.notion.com/workers/get-started/overview.md)).

**Keeping a "Banda skill" current:**
- **Generated content cannot drift from the code.** VS Code's settings UI and JSON IntelliSense come from `contributes.configuration` ([contribution points](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration)). MCP clients read `tools/list` live. Zed derives the settings schema from Rust types (`JsonSchema` derives in [settings_content.rs](https://github.com/zed-industries/zed/blob/main/crates/settings_content/src/settings_content.rs)).
- **Hand-written content is needed for concepts and judgment**, but it goes stale.
- **Suggested split:**
  1. A short hand-written `SKILL.md` covering concepts (Space, Pane, module, capability), how to change things safely, and pointers.
  2. **Generated reference files** from the module registry and manifests: every module, command, MCP tool, event, setting (with its schema), keybind action, layout schema, file location and capability. These are regenerated at build time and whenever a module is installed or changed.
  3. A live `describe` command or MCP tool for current state.
  4. **Evals** in Raycast's style: a few Agent tasks per area that run in CI against the skill.
  5. An architecture test that fails when any manifest entry lacks a description.

## 11. Config as editable text, safe for both a Person and an Agent (added on request)

- **VS Code:**
  - **Files:** user `settings.json` (per OS path) and workspace `.vscode/settings.json`. The Settings editor and the JSON file are the same store, and "VS Code applies changes to settings directly as you change them".
  - **Checks and edits:** the file gets "full IntelliSense ... and description hovers", and bad names and JSON errors are highlighted. When the file has errors, the UI may refuse to save new values until they are fixed.
  - **Precedence:** default, user, remote, workspace, folder, then language-specific; policy settings always win. Objects merge and arrays replace ([settings](https://code.visualstudio.com/docs/configure/settings)).
  - **Schema:** comes from each extension's `contributes.configuration`, and `contributes.jsonValidation` attaches schemas to other JSON files ([contribution points](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration)).
- **Zed** (read in source, 2026-11-01):
  - **Reload:** config files are watched with a 100 ms debounce ([settings_file.rs](https://github.com/zed-industries/zed/blob/main/crates/settings/src/settings_file.rs)) and parsed as lenient JSON (comments allowed).
  - **Migration:** old formats are migrated automatically before parsing.
  - **Bad values:** parsing is **fallible per field**. A field with a bad value falls back to its default and the error is recorded, while the rest of the file applies. A syntax error yields no settings, and the **previous settings stay in force**. Errors are kept per file for the UI ([fallible_options.rs](https://github.com/zed-industries/zed/blob/main/crates/settings_content/src/fallible_options.rs), `set_user_settings` in [settings_store.rs](https://github.com/zed-industries/zed/blob/main/crates/settings/src/settings_store.rs)).
  - **App writes:** when the app changes a setting it computes the updated file text from the existing text (`new_text_for_update`, same file). I did not verify that comments always survive.
- **Zellij:** permission grants are a plain `permissions.kdl` that the user can edit or delete ([0.38.0](https://github.com/zellij-org/zellij/releases/tag/v0.38.0)).

**Rules that follow for Banda config (keybinds, modules, layouts, settings):**
- One text file per concern, with comments allowed.
- A JSON Schema generated from manifests, published so both editors and Agents can validate.
- Watch, validate, then apply. On error, keep the last good config and show the error with its file and line.
- Per-field fallback where it is safe.
- Automatic migrations.
- App writes should be minimal text edits that keep human comments.
- A `check` command an Agent can run before saving.

## 12. Options for Banda

The constraints:
- **Today:** a module is a Rust engine crate (commands, events, its own SQLite tables, MCP tools) plus a React Pane package, all compiled in. Panes reach the engine only through the JSON-over-WebSocket API, under a strict CSP.
- **Goals:** people who don't code, one design language, and "ask an Agent to build me a module" inside the app.

### Option A: Sandboxed frame Pane + capability manifest + out-of-process logic (VS Code / Figma / MCP Apps lineage)
- **Window:**
  - A third-party Pane is an `<iframe sandbox="allow-scripts">` served from a per-module origin through a custom protocol, never `file://` (Electron checklist).
  - The CSP is injected and derived from the manifest. Script cannot remove it ([Willison](https://simonwillison.net/2026/apr/3/test-csp-iframe-escape)), and the fallback is MCP Apps' deny-by-default.
  - A postMessage JSON-RPC bridge mirrors today's Pane props: `{space, args, focused}` in, `open`/`update`/`close` and `engine.call` out. The window filters every call by the module's granted capabilities and checks the sender (Electron IPC rule).
  - The host passes Banda CSS tokens and fonts, like MCP Apps `styles.variables`.
- **Engine:** module logic runs as a separate process (Node or Deno, or any language) that holds a **scoped token** for the same engine API. The engine enforces the manifest: own namespaced tables, the allowed commands and events, outbound hosts, and Agent tools. A capability runtime such as Deno can map manifest network hosts onto `--allow-net=…`. WASM (wasmtime component model, as in Zed and Zellij) is a later option for hot paths.
- **Safety:** high, if done right (origin split, CSP, token scopes, consent).
- **Power:** high.
- **Design language:** *weak*. A frame can ignore the tokens, like VS Code webviews.
- **For an Agent:** moderate. It writes HTML/React plus a small server against two documented contracts.

### Option B: MCP-App modules (adopt the standard as-is)
- **Shape:** a module is a local MCP server, and its Panes are MCP Apps `ui://` resources. Banda becomes an MCP Apps host. Its tools for Agents are just MCP tools, with `visibility: ["model"|"app"]` separating Agent tools from UI-only tools.
- **Safety:** high (the spec's sandbox rules).
- **Power:** moderate. MCP Apps was designed for widgets inside a chat. It has no Space, no Pane lifecycle (`open`/`update`/`close`), no engine events and no owned tables, so Banda would need `banda/*` extension methods.
- **Design language:** weak (variables only).
- **For an Agent:** easiest *for developers' Agents*, since MCP servers are well known. Every existing MCP App works in Banda without changes.
- **Risk:** Banda would follow someone else's spec revisions (MCP is already at 2026-07-28) for a core internal contract.

### Option C: Declarative modules built from Banda's blocks (Raycast / Notion / Bases lineage)
- **Shape:** a module is `module.toml` plus data schemas (its tables) plus **views composed from Banda's own components** (List, Table, Board, Form, Detail, Document, Chart, Terminal, Browser), all rendered by the window's own React. Actions bind to engine commands, MCP tools or a small logic script run as in Option A.
- **Safety:** highest. No third-party code runs in the window.
- **Power:** limited to what the blocks express. A new kind of widget is a Banda change.
- **Design language:** **guaranteed**, as in Raycast.
- **For an Agent:** easiest and most reliable. It generates schema-validated files, `check` catches mistakes, and the person sees a native-looking result at once. This is the best fit for non-developers.

### Option D: Trusted local code (Obsidian / Emacs lineage)
- **Shape:** a module is JS loaded into the window with the full Pane props, behind a Restricted-mode switch.
- **Safety:** none. An Agent that read a poisoned web page could write a module that takes everything. It also breaks the strict CSP Banda already has.
- **Power:** maximal.
- **Design language:** advisory.
- **For an Agent:** easy.
- **Verdict:** use only for first-party code that is compiled in.

### Recommendation: manifest-first modules (C by default, A as the escape hatch, B-compatible at the frame bridge)
1. **One contract, `module.toml`,** declares id, API version, Panes, commands (with input schemas and descriptions), events, tables (with migrations), MCP tools (each command marked for Agents, the UI or both, following MCP Apps visibility), settings schema, keybind actions, and **capabilities in plain words**. Keep capabilities few and coarse, for example own data, read Space, network hosts, use Agents, open Panes, run programs. Show them on enable and again when an update widens them (Zellij, Artifacts). Agent-written modules start as **local drafts** with no network and no Agent tools until the person approves.
2. **Tier 1 (default): declarative Panes** from Banda's blocks. This is what the Agent writes for "make me a habit tracker / reading list / client CRM".
3. **Tier 2 (escape hatch): frame Panes** under Option A's sandbox. The bridge speaks MCP Apps' `ui/initialize`, `tools/call` and host context *plus* Banda methods, so existing MCP Apps render in a Pane for free. Publish the blocks as an npm package and pass the CSS tokens, so frame Panes can match the look. This is encouraged, not enforced.
4. **Logic outside the window and outside the engine process.** It runs as a separate process with a scoped token for the *same* JSON-over-WebSocket engine API, under a capability runtime. WASM can come later.
5. **Distribution:** start with a local folder per Space (like Obsidian's `.obsidian/plugins`, Zed dev extensions and Zellij `file:`), then git URLs, then a reviewed directory. Use Emacs-style review on update: show the source diff and the capability diff.
6. **How an Agent writes one:**
   - The Agent reads the generated "Banda module" skill: the block catalogue, capability list and engine API reference.
   - It runs `banda module new`, writes the files, and runs `banda module check`, which validates the manifest, view JSON and schemas and reports errors by file and line.
   - `banda module dev` hot-reloads the Pane (Raycast `ray develop`, Obsidian Hot-Reload).
   - The person sees the capability screen and approves, and the module's MCP tools then appear to the Space's Agents.

**Why this one:**
- Option C gives non-developers and their Agents a high success rate with one look, which is Raycast's and Notion's lesson.
- Option A keeps the "hackable" promise for power users without Obsidian's all-or-nothing trust.
- Bridge-level compatibility with MCP Apps buys an ecosystem without making MCP the internal contract.

### What first-party modules must already do now (so a third-party or Agent-written module can do the same later)
Each rule should get an architecture test, per the project's refactoring rule:
1. **Every first-party module ships a `module.toml`.** The window's `PaneKind` registry, the engine's command, event and table registry, the MCP tool list, the settings schema and the keybind list are **built from manifests**, not from hand-kept lists (VS Code `contributes`). *Test:* no registration outside the manifest loader.
2. **The Pane props are a message contract.** Everything in `{engine, space, args, focused, open, update, close}` must be expressible as serialisable messages, so the same Pane can later run behind a frame bridge. Do not pass shared React context, live engine objects or cross-module imports. *Test:* Pane packages import only the public module API package and the blocks package.
3. **Engine crates use only the public engine API.** No reaching into another module's tables or crate internals. Cross-module work goes through commands and events (VS Code `executeCommand`, Zellij pipes). Tables are namespaced by module id and created by declared migrations. *Test:* dependency rules between crates; SQL table-name prefixes.
4. **First-party modules declare capabilities too.** They may be auto-granted (Zellij exempts built-ins from the prompt), but never undeclared. The engine checks them on every call, so the enforcement path is exercised from day one. This avoids Zellij's 0.38 retrofit.
5. **One "proposed API" lane.** First-party modules may use APIs marked unstable, listed in the manifest, and the count is tracked (VS Code built-in git: 34 proposals). That debt stays visible, and third parties can't depend on those APIs by accident.
6. **First-party Panes are built only from the public blocks.** No private styles or widgets. If a first-party module needs a new block, add it to the blocks package first, the rule Banda's terminal design system (tikho) kept.
7. **Agent surfaces are declared, not hand-written.** Each command and tool description lives in the manifest, and the Banda skill's reference section is generated from the registry (section 10).
8. **Config is text with schemas** (section 11): keybinds, layouts, module settings and enabled modules, each watched, validated, applied, and kept at the last good version on error.
9. **Dogfood the external path once.** Build one small first-party module (for example files or a notes list) as an out-of-process, declarative module, so the third-party path works before anyone outside depends on it (Zed's extraction of built-in languages; AFFiNE's "without any privileges" goal).

## 13. Evidence limits

- **How pages were read:** through a summarising fetch tool on 2026-11-01. Short quotes are reliable, and a few longer "quotes" may be paraphrases. Code facts (VS Code proposal gate and git manifest, Zed settings parser and language layout, Obsidian typings, MCP schema, Emacs manual sources) were read directly from downloaded source on that date and may change.
- **Third-party or unofficial sources:**
  - Claude Artifacts isolation: Anthropic's help page doesn't describe it; Willison's posts are third-party.
  - The Zed slash-command removal reasoning: from a third-party git mirror.
  - Notion Workers internals beyond the official overview, such as Vercel Sandbox or Firecracker, appeared only in third-party posts and were not used.
- **Dated sources:** Raycast internals come from a 2023 post; Figma's from 2019 (with a later update note); tldraw's from 2023.
- **Not verified:**
  - Whether VS Code stable (not just Insiders) renders MCP Apps.
  - How MCP Apps sits inside the 2026-07-28 MCP spec.
  - Whether Raycast's built-in commands use its public API.
  - Any 2026 Anytype or AFFiNE end-user plugin loader (none found).
  - Notion third-party custom UI blocks (none found).
- **No Banda code or docs were read.** The options rest only on the description of Banda's current shape given in the request.

## Sources

**Obsidian**
- https://docs.obsidian.md/Reference/Manifest
- https://obsidian.md/help/Extending+Obsidian/Plugin+security
- https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
- https://docs.obsidian.md/Plugins/User+interface/Views
- https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerBasesView
- https://docs.obsidian.md/Reference/TypeScript+API/Plugin/saveData
- https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin
- https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- https://obsidian.md/help/plugins
- https://obsidian.md/help/bases
- https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts
- https://jsoncanvas.org/
- https://github.com/RyotaUshio/obsidian-pdf-plus/discussions/48

**VS Code**
- https://code.visualstudio.com/api/advanced-topics/extension-host
- https://code.visualstudio.com/api/references/contribution-points
- https://code.visualstudio.com/api/references/activation-events
- https://code.visualstudio.com/api/extension-guides/webview
- https://code.visualstudio.com/api/ux-guidelines/webviews
- https://code.visualstudio.com/api/extension-guides/workspace-trust
- https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security
- https://code.visualstudio.com/api/extension-capabilities/common-capabilities
- https://code.visualstudio.com/api/references/vscode-api
- https://code.visualstudio.com/api/extension-guides/ai/tools
- https://code.visualstudio.com/api/get-started/your-first-extension
- https://code.visualstudio.com/api/advanced-topics/using-proposed-api
- https://github.com/microsoft/vscode/tree/main/extensions
- https://github.com/microsoft/vscode/blob/main/extensions/git/package.json
- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/extensions/common/extensionsProposedApi.ts
- https://code.visualstudio.com/docs/supporting/faq
- https://code.visualstudio.com/docs/configure/settings

**Zed**
- https://zed.dev/docs/extensions/developing-extensions
- https://zed.dev/docs/extensions/capabilities
- https://zed.dev/blog/zed-decoded-extensions
- https://github.com/zed-industries/zed/discussions/53403
- https://github.com/zed-industries/zed/blob/main/extensions/README.md
- https://github.com/zed-industries/zed/blob/main/extensions/EXTRACTION.md
- https://github.com/zed-industries/zed/blob/main/crates/settings/src/settings_file.rs
- https://github.com/zed-industries/zed/blob/main/crates/settings/src/settings_store.rs
- https://github.com/zed-industries/zed/blob/main/crates/settings_content/src/fallible_options.rs
- https://github.com/zed-industries/zed/blob/main/crates/settings_content/src/settings_content.rs
- https://git.secluded.site/zed/blob/pr-53295/docs/src/extensions/slash-commands.md?raw=1 (third-party mirror)

**Zellij**
- https://zellij.dev/documentation/plugins
- https://zellij.dev/documentation/plugin-api-permissions
- https://zellij.dev/documentation/plugin-loading
- https://zellij.dev/documentation/plugin-pipes
- https://zellij.dev/documentation/plugin-api-file-system
- https://zellij.dev/documentation/plugin-dev-env
- https://zellij.dev/documentation/plugin-upgrade-0.38.0
- https://zellij.dev/news/session-manager-protobuffs/
- https://github.com/zellij-org/zellij/releases/tag/v0.38.0

**Raycast**
- https://developers.raycast.com/information/security
- https://developers.raycast.com/information/lifecycle
- https://developers.raycast.com/information/manifest
- https://developers.raycast.com/api-reference/user-interface
- https://developers.raycast.com/misc/faq
- https://developers.raycast.com/basics/create-your-first-extension
- https://developers.raycast.com/basics/publish-an-extension
- https://developers.raycast.com/information/developer-tools/cli
- https://developers.raycast.com/ai/learn-core-concepts-of-ai-extensions
- https://raycast.com/blog/how-raycast-api-extensions-work

**Notion, Anytype, AFFiNE**
- https://www.notion.com/blog/data-model-behind-notion
- https://www.notion.com/releases/2026-05-13
- https://developers.notion.com/workers/get-started/overview.md
- https://releases.any.org/desktop-046-6
- https://blocksuite.io/guide/overview.html

**AI-made UI**
- https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them
- https://simonwillison.net/2026/apr/3/test-csp-iframe-escape (third-party)
- https://tldraw.dev/blog/make-real-the-story-so-far
- https://developers.openai.com/apps-sdk/build/chatgpt-ui
- https://developers.openai.com/apps-sdk/guides/security-privacy
- https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp
- https://github.com/modelcontextprotocol/ext-apps
- https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
- https://mcpui.dev/guide/introduction

**Emacs, Electron, web**
- https://github.com/emacs-mirror/emacs/blob/master/doc/emacs/emacs.texi
- https://github.com/emacs-mirror/emacs/blob/master/doc/emacs/package.texi
- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/api/utility-process
- https://www.electronjs.org/docs/latest/tutorial/message-ports
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
- https://www.figma.com/blog/how-we-built-the-figma-plugin-system/
- https://docs.deno.com/runtime/fundamentals/security/

**Agent-facing knowledge**
- https://code.claude.com/docs/en/skills
- https://learn.chatgpt.com/docs/agent-configuration/agents-md
- https://learn.chatgpt.com/docs/build-skills.md
- https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-11-25/schema.ts
- https://llmstxt.org/
