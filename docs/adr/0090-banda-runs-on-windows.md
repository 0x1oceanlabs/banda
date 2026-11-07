---
status: proposed
date: 2026-11-07
---

# Banda runs on Windows

_Proposed on 2026-11-07. Roma asked for Windows to be planned now and
built later. Nothing here is built. Code is cited at `089cd164`.
Research: docs/research/2026-11-07-windows.md, which goes in with this
ADR. It holds what five readers found in the engine, the window, the
Harnesses, the release and the service, the critique of the first draft,
and their sources. The read-only probe for the laptop is
docs/research/2026-11-07-windows-probe.ps1._

ADR 0033 put Windows off (decision 7): "Windows comes later, on its own.
The engine's terminals (`pty-process`) and the window's socket
(`window.sock`) are Unix only." Since then:

- the engine became the machine's (ADR 0086);
- every program for a Project goes through its environment (ADR 0084);
- the fence will keep Banda's state out of an Agent's shell (ADR 0083).

Each of these is written for Linux first and macOS second. None has a
Windows answer.

What stands in the way today:

- **The workspace does not compile for Windows.**
  - The kernel's environment port is built on `pty_process::Pts` and
    `rustix` process groups (`kernel/src/environment.rs:15`, `:65`).
    `pty-process` 0.5.4 does not build on Windows.
  - After it come about a dozen more Unix-only call sites in 8 crates:
    process groups and signals, `/proc`, exec bits, `nix`, Hyprland's
    socket.
  - The engine crate already has `cfg(not(unix))` stand-ins
    (`engine/src/serve.rs:83-86`).
  - Even a Windows window that is only a client of a Linux host needs a
    Windows `banda.exe`: the window runs `banda look --follow` and
    `banda settings` itself (`client/desktop/src/look.ts:38`,
    `client/desktop/src/settings.ts:34`), and `banda-settings` pulls in
    the kernel.
- **The engine has no Windows way to run.**
  - `way()` gives every system but Linux `Child(NotYet)`
    (`engine/src/service.rs:227-229`).
  - `banda stop` sends SIGTERM. Off Unix it says it "needs a Unix
    system" (`engine/src/control.rs:389-392`).
  - The window stops its child engine with SIGTERM
    (`client/desktop/src/child.ts:29-44`). Node turns that into a plain
    kill on Windows, so the engine never stops its Harnesses itself.
- **The window assumes Unix.**
  - The engine is `banda` with no `.exe`
    (`client/desktop/src/program.ts:107`,
    `client/desktop/electron-builder.config.mjs:32`).
  - The window's socket is a Unix socket
    (`client/desktop/src/door.ts:21-35`).
  - The window keeps its state under `~/.local`, but the engine keeps
    its own under `%LOCALAPPDATA%` and `%APPDATA%`
    (`client/desktop/src/channel.ts:62-78` against
    `engine/src/places.rs:121-150`).
  - The adapters run on the installed app's Electron
    (`BANDA_NODE = process.execPath`, `client/desktop/src/main.ts:165`),
    which has no console on Windows.
  - The updater does nothing unless Banda is an AppImage or came from
    brew (`client/desktop/src/update.ts:77-88`).
- **Two of the window's safety rules do not hold on Windows.**
  - "A click never runs a program" depends on the exec bit
    (`client/desktop/src/outside.ts:39-45`), and no Windows file has
    one. A Ctrl-click on `setup.exe` or `x.bat` would run it.
  - `outside.ts` and `editors.ts` stat any absolute path. On Windows,
    `\\host\share\x` is an absolute path, and a stat of it sends the
    Person's NTLM hash to that host.
    `client/desktop-kit/src/files.ts:102-103` already refuses such
    paths. These two files do not.
- **The fence has no Windows form.** Namespaces, Landlock and
  `SO_PEERCRED` do not exist on Windows.
- **Nothing packs, signs or tests for Windows.** electron-builder has no
  `win` target, and `.github/workflows` has no Windows job.

What Windows allows, checked on 2026-11-07:

- **Electron 45** runs on Windows 10 and later, x64 and arm64.
- **ConPTY**, the pseudoconsole a terminal needs, came with Windows 10
  1809 (build 17763).
- **Windows 10**'s support ended in October 2025. Its extended security
  updates for consumers ended in October 2026.
- **Claude Code** runs natively on Windows 10 1809 and later.
  - Its installer puts `claude.exe` in `%USERPROFILE%\.local\bin` and
    does not change PATH.
  - Its sandbox does not run on native Windows, only in WSL2.
- **Codex** runs natively, and its installer adds it to the user PATH.
  - It has a sandbox of its own, in one of three forms: Microsoft's
    Execution Containers (MXC) on recent Windows 11 builds; sandbox
    users, which an admin sets up once; or a restricted token, which
    cannot hide what a command reads.
  - On Windows 10 its support is "best effort".
- **WSL2** needs Windows 10 2004 (build 19041) for `wsl --install`, and
  virtualization switched on in the firmware. systemd works inside. A
  Unix socket does not cross between Windows and WSL2
  (microsoft/WSL#5961).
- **Mica and acrylic**, the system's glass, need Windows 11 22H2
  (build 22621).
- **Smart App Control** blocks an unsigned program or DLL with no "Run
  anyway" button. It checks every one, not only downloaded ones. Once
  turned off, it cannot be turned on again without reinstalling Windows,
  on builds before 25H2.
- **SmartScreen** warns once for each new file a browser downloaded that
  has no reputation yet. A signed file from a new publisher warns too,
  until the publisher has reputation, which Microsoft says can take
  several weeks and hundreds of clean installs.
- **GitHub's standard hosted runners are free on a public repository**,
  Windows and Windows on Arm included. This repository has been public
  since 2026-11-03 (ADR 0038).

Roma, 2026-11-07: Windows is planned now and built later. He has an old
laptop with Windows to try it on. Which version of Windows it runs is
not known yet (Open questions, 1).

**Decision.**

1. **Banda runs on 64-bit Windows 10 1809 or later, and is made for
   Windows 11. x64 comes first.**
   - The lowest build is 17763: ConPTY needs it, and so does Claude
     Code. The installer refuses an older Windows and says why.
   - Banda is tested on Windows 11 and on Roma's laptop.
   - Windows 10 runs Banda for as long as Electron supports it, and gets
     no features made for it. Its desk is solid (ADR 0030), and it has no
     native fence (decision 6).
   - arm64 comes after x64, in the same build (Plan, step 13). Electron,
     Claude Code and Codex all ship arm64, and Rust's
     `aarch64-pc-windows-msvc` target is Tier 1.
   - No 32-bit. Claude Code, Codex and the engine need 64-bit.

2. **A Windows machine is a host of its own, natively. A WSL2 distro may
   become a host later. Neither is an environment.**
   - **Native first.**
     - The engine, the adapters and the CLIs run on Windows.
     - Projects live on NTFS, with the Person's Windows tools. Both
       vendors default to this.
     - It depends on no other plan, so it gives Roma's laptop something
       to try soonest.
   - **A WSL2 distro as a host, later.**
     - The Linux engine runs inside the distro, unchanged: its systemd
       unit, its terminals, its owner socket, the Linux fence, both CLIs
       with their own sandboxes, and Projects on the distro's fast disk.
     - The Windows window is its client, through a `wsl` route next to
       `ssh` in ADR 0081's list of routes (decision 4).
     - The route runs a new command, `wsl.exe -e banda bridge`, and
       talks to it over its stdio. It installs and starts the engine as
       the `ssh` route does.
     - The bridge runs as the Person's Linux user, so it passes the
       owner socket's check inside the distro. VS Code reaches WSL the
       same way.
   - **The `wsl` route waits** for two things: ADR 0081's routes (its
     step 5), and a client that takes files, media, settings and the
     look from its host (the vision's M5). Its spike checks:
     - that the distro stays up with no window open (WSL's idle
       timeouts);
     - whether the WSL kernel has Landlock;
     - that the fence also hides Banda's Windows folders under `/mnt/c`,
       and Windows interop (`/run/WSL`, `WSL_INTEROP`). Otherwise a
       fenced Agent reads those folders under `/mnt/c`, or through
       `powershell.exe`.
   - **Banda never runs `wsl.exe` to learn whether WSL is there.** On
     Windows 11 the `wsl.exe` in System32 is a stub: any command, even
     `wsl --version`, downloads and installs WSL and turns on
     VirtualMachinePlatform. The probe did exactly that on Roma's
     laptop. The same goes for `bash.exe` in `WindowsApps`. Banda looks
     for `%ProgramFiles%\WSL\wsl.exe` and reads the distros from
     `HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss` instead.
   - **WSL2 is not an environment of a Windows engine.** ADR 0084's
     decisions do not hold across that border:
     - paths differ inside and outside (`C:\…` against `/mnt/c/…`),
       which breaks its decision 3;
     - its box's door is a Unix socket mounted into the box, and that
       cannot cross into WSL2 (its decision 6);
     - automount and interop are on by default, so WSL is no wall.

     A machine with its own kernel is a host, as ADR 0084's decision 2
     says of a remote machine.

   - A Windows window can also be the client of any Linux host, Roma's
     devbox for example. That comes with ADR 0081's routes, and needs
     steps 1, 4 and 5 of this plan.
   - On a native host, the `local` environment works as it does on
     Linux, but without the fence (decision 6). The `sandbox`
     environment on Windows is MXC, after its spike. The `container`
     environment on Windows joins ADR 0084's open question for macOS:
     Docker Desktop runs Linux containers in a VM, where paths differ.

3. **On Windows, each program the engine starts is born in a Job Object,
   and none opens a console window.**
   - **The port's handle.** ADR 0084's plan, step 1, already asks for "a
     handle that stops what it started". The handle has:
     - `ask_to_stop`: TERM to the process group on Unix. On Windows it
       closes the program's stdin, or closes its ConPTY for a terminal
       (decision 4);
     - `kill`: KILL to the group on Unix, ending the Job Object on
       Windows;
     - a PTY handle of its own, in place of `pty_process::Pts`.

     Git, the terminal, the Harnesses' pipes and the servers stop
     through this handle. Only the Unix code in `platform/environments`
     still uses `rustix`.

   - **A Job Object for each program**, which kills the whole process
     tree when it closes.
     - A program on pipes starts suspended, is put in its Job Object, and
       only then resumes; `process-wrap` does this. A terminal's program
       is born in its Job Object (decision 4). Either way it cannot start
       a child outside it.
     - npm's CLIs are `.cmd` wrappers. Killing only the direct child
       would leave `node.exe` running.
     - When the engine dies, its handles close and its children die
       with it. This is the Windows form of `KillMode=mixed`'s final
       kill.
     - **No Job Object of Banda's lets a program break away.** Node,
       Electron and Bun put their own children in a Job Object that lets
       them leave it silently. If Banda's allowed breaking away, a tool
       that an Agent's Node starts could leave Banda's. So nothing in a
       Job Object of Banda's starts a program that outlives it. Decision
       5 says what follows for the engine.
   - **No signals, and no Ctrl+Break in v1.** Windows has no SIGTERM.
     Sending Ctrl+Break takes a Win32 call that no safe crate makes
     (decision 10), and nothing needs it:
     - a Harness's adapter stops when its stdin closes;
     - git is stopped by ending its Job Object. Banda then removes the
       `.git/index.lock` that git left, if it is still there and was made
       after that git started;
     - a terminal stops when its ConPTY closes (decision 4);
     - a server is stopped by killing its process tree (decision 4).
   - **An exit has a code, never a signal.** A program stopped by Ctrl+C
     ends with a code such as `0xC000013A`.
   - **No console windows.**
     - Only the engine's own start is hidden. The window starts its
       `banda` with `windowsHide`, and `banda start` starts the engine
       with `CREATE_NO_WINDOW` (decision 5). Either way the engine has a
       console with no window.
     - Every program the engine starts, through the port or for its
       bookkeeping, inherits that console. None gets `CREATE_NO_WINDOW`
       of its own: that would give each a hidden console of its own, and
       a `conhost.exe` more. Each gets `CREATE_NEW_PROCESS_GROUP`, so a
       Ctrl+C in a console where someone runs `banda serve` by hand
       reaches the engine only.
     - The adapters run on `node.exe`, a console program (decision 5),
       never on the window's Electron. Electron has no console, so each
       console program it starts opens a visible console window, as
       codex-acp starts `codex.exe` with no `windowsHide`
       (codex-acp 2.5.0, `dist/index.js:28101`). Banda's patch of
       codex-acp (`pnpm-workspace.yaml:32`) gains `windowsHide` as
       well.
   - **PATH comes from the registry.** Windows has no login shell.
     - Before it looks for a CLI or starts a Harness, the engine reads
       the user's and the system's PATH (`HKCU\Environment` and
       `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`),
       expands their `%VARIABLES%`, and adds them to its own. So it
       finds a CLI installed while Banda runs.
     - This is ADR 0059 decision 3, on Windows.
     - Windows variable names ignore case (`Path` and `PATH` are the
       same), so Banda's own maps of variables ignore case there too
       (`apps/agents/engine/src/lib.rs:153-169`).
   - **Finding a CLI** (`platform/harnesses/engine/src/cli.rs:92-104`):
     - It understands `\` paths and `PATHEXT`.
     - It looks in the vendors' folders first:
       `%USERPROFILE%\.local\bin\claude.exe`, which the Claude Code
       installer does not put on PATH, and
       `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`.
     - It skips every program under `WindowsApps` and never runs one.
       An old Claude Desktop puts a `Claude.exe` alias there, and
       running it with `--version` opens Claude Desktop.
     - It skips a `claude` whose `--version` does not say
       "(Claude Code)".
     - The `npx` fallback runs `npx.cmd`.
   - **Paths.**
     - `dunce::canonicalize` replaces `canonicalize`, so no `\\?\`
       prefix reaches the window, `engine.json` or `cmd.exe`.
     - Project folders are compared without case.
     - Git gets `core.longpaths=true`.
   - **Git's hooks folder is an empty folder in Banda's state, never
     `/dev/null`** (`platform/git-cli/src/lib.rs:151`). Git for Windows
     reads `/dev/null` as `\dev\null` on the current drive. It works
     today only because that folder does not exist, and an Agent can
     create it.
   - **Files refuses the names Windows refuses**: `<>:"|?*`, `CON`,
     `NUL`, `COM1` to `LPT9`, and a name ending in a dot or a space.
     - When Windows refuses something Unix allows, Files says why: for
       example a link without Developer Mode, or a file another program
       has open.
     - Before it moves a Project folder, Banda stops that Project's
       Harnesses, terminals and file watcher. Windows will not move a
       folder that a process is working in.
   - **A file written whole is renamed into place with a few tries.**
     Defender or the search indexer may hold a new file for a moment,
     and the rename then fails (`ERROR_ACCESS_DENIED`,
     `ERROR_SHARING_VIOLATION`).
   - **Places.**
     - Everything lives under `%LOCALAPPDATA%\<folder>\`, in `data`,
       `state`, `cache` and `config`.
     - Nothing goes in Roaming. A company's roaming profile would copy
       the stores and the engine's copies to other machines. ADR 0081
       decision 12 already says who owns each settings file.
     - `~/Banda` is `%USERPROFILE%\Banda`.
     - The window computes the same places, and a test keeps the two in
       agreement.
     - The `BANDA_*` variables still move each place, but only within
       the Person's profile: a place outside it is refused, with the
       reason. Under the profile, a folder takes the profile's access
       list, which keeps it to the Person, SYSTEM and the admins. That
       list is what keeps the owner's secret in `engine.json` to the
       Person (decision 5). Elsewhere, such as `C:\banda`, the Users
       group could read it. The rule holds while Banda sets no access
       list of its own (decision 10).
   - **The build id** is the GUID and age in the program's CodeView
     record (`RSDS`), read from the PE file as `build_id.rs` reads ELF
     and Mach-O today. MSVC writes it, with `banda.pdb`, because
     `debug = "line-tables-only"` already asks for one
     (`Cargo.toml:87-88`). `banda.pdb` is packed and copied beside
     `banda.exe`, as `banda.dSYM` is on macOS
     (`client/desktop/src/program.ts:260-270`,
     `client/desktop/electron-builder.config.mjs:59`), so ADR 0039's
     backtraces keep their lines. Two builds that differ never share
     one, as two Banda Local builds could with a value `build.rs` made
     up: that changes only when `build.rs` runs again.

4. **A terminal on Windows is a ConPTY that Banda starts itself. The
   page draws it as it does today.**
   - **The engine starts the ConPTY with its own code** in
     `platform/windows` (decision 10), not through `portable-pty`.
     portable-pty 0.9.0 (`src/win/psuedocon.rs`) does three things
     Banda cannot have:
     - It starts the program with fixed flags, so the program cannot be
       born in its Job Object. Banda's start passes the Job Object in the
       start's attribute list (`PROC_THREAD_ATTRIBUTE_JOB_LIST`, Windows
       10 1607 and later), beside the pseudoconsole.
     - It always asks for `PSEUDOCONSOLE_INHERIT_CURSOR`. With it, ConPTY
       asks the terminal where its cursor is and waits for the answer.
       A terminal that no Pane shows has nobody to answer: the engine
       has no VT parser, and a replay has its answers off
       (`apps/terminal/engine/src/history.rs:1-6`). So it would hang.
       Banda asks for no flags at all, so ConPTY does not ask for
       win32-input-mode either.
     - It loads a bare `conpty.dll` by name before kernel32's. Windows
       looks for that name in the current folder and in every PATH
       folder too, so any `conpty.dll` there would run inside the
       engine. Banda calls kernel32's `CreatePseudoConsole`, and limits
       the engine's DLL search to the system's folder and its own
       (`SetDefaultDllDirectories`) as it starts.

     WezTerm's code (MIT) is the reference.

   - Resizing goes through `ResizePseudoConsole`. Closing the ConPTY is
     the hangup: Windows sends a close event to every program on it. The
     Job Object ends after the grace period.
   - The default shell is `pwsh.exe` if it is on PATH, then
     `powershell.exe`, then `%ComSpec%`. `terminal.toml` (ADR 0047) can
     name another shell, such as Git Bash.
   - **What runs in front** comes from the shell's process tree, because
     Windows has no foreground process group.
     - It is the shell's newest descendant, with its command line and
       folder, read through `sysinfo`.
     - Names drop their `.exe`, and a folder under the home shows as
       `~\`.
     - The shells' own marks (OSC 133, 633, 7 and 9;9) may come later,
       for shells that send them.
   - **Signing in from a terminal** (ADR 0059 decision 6) works once
     terminals work. Until then, a Harness row on Windows tells the
     Person to sign in from their own PowerShell.
   - Banda uses the ConPTY that ships with Windows. VS Code and WezTerm
     ship a newer `conpty.dll` and `OpenConsole.exe` from
     microsoft/terminal. Banda does that only if Roma sees the screen
     drawn wrong, and then loads them by their full path beside
     `banda.exe`.
   - **The renderer stays.**
     - It is libghostty-vt compiled to WebAssembly and drawn in the page
       (`client/ghostty`), with nothing native.
     - T3's adapter already handles drive-letter paths, UNC paths and
       AltGr.
     - On the transparent canvas, text gets greyscale smoothing, not
       ClearType. This is checked at 100, 125 and 150 % scale.
   - Until terminals come (Plan, step 7), a Terminal Pane on Windows
     says that terminals come to Windows later.
   - **Servers started in Banda** (ADR 0044) are found through two
     crates instead of `/proc`: `listeners` for listening ports and
     their processes, and `sysinfo` for a process's parent, command line
     and variables.
     - Windows has no process groups, so "a Harness's own listener" is
       found by following the chain of parent processes.
     - A server is stopped by killing its process and its descendants,
       with no Ctrl+C first. That is what `taskkill /T /F` gives Windows
       users anyway.

5. **On Windows the engine also belongs to the machine: any client
   outside Banda's Job Objects can start it, and it is nobody's child.**
   - **How it starts** (Plan, step 10).
     - The window runs `banda start`, as it does on Linux.
     - `banda start` starts `banda.exe serve` from the engine's own copy
       (ADR 0086 decision 2), with `CREATE_NO_WINDOW`,
       `CREATE_NEW_PROCESS_GROUP` and `CREATE_BREAKAWAY_FROM_JOB`.
     - So the engine survives a closed window or a crashed one.
     - Windows ends it at logoff, which is what ADR 0086 asks for.
     - Nothing is registered with the system.
   - **Who can start it.**
     - The window is in no Job Object of Banda's, and Node's own Job
       Object lets its children break away. So the window can start the
       engine.
     - **A client inside a Job Object of Banda's never starts an
       engine.** Breaking away fails there (decision 3). It never needs
       to: the engine that made its Job Object is running, or the client
       is gone with it.
     - A client in another program's Job Object that does not allow
       breaking away is refused with the reason: open Banda to start its
       engine. If step 10 finds common starters that do this, a per-user
       Task Scheduler task becomes the way to start the engine (Open
       questions, 5).
     - **ADR 0086 decision 7 on Windows:** an Agent's test run of Banda
       Local lives in the Agent's Job Object and ends with it. It leaves
       nothing behind, and a program ended this way leaves no crash
       report, which is what decision 7 is for.
   - **It uses the session's environment, not the environment of
     whatever started it.** At start, the engine builds its variables
     with `CreateEnvironmentBlock` for its own account, without
     inheriting its own: the variables a fresh sign-in gets from the
     registry. So a `banda` run inside Claude Code does not pass
     `CLAUDECODE` on to the engine. This is in `platform/windows`.
   - **The other option we weighed** is a per-user Task Scheduler task,
     run on demand.
     - For it: it starts outside any Job Object, as `systemd-run --user`
       does, and it gives the engine a name Windows knows.
     - Against it: a task runs a console program in a visible console
       window, so it needs a windowless copy of `banda.exe`, as
       `pythonw.exe` is to `python.exe`. By default, Windows stops a task
       after 72 hours, and when the laptop goes on battery. Company policy
       may forbid tasks.
     - We keep it for one case, if step 10 finds it: starters whose Job
       Object does not allow breaking away.
   - Until step 10, the engine stays the window's child on Windows, as
     `way()` already arranges. **Banda Local stays the window's child**
     after step 10 too (`--with-parent`; closing stdin works on Windows).
   - **Stopping the engine.**
     - While it is the window's child, the window closes the engine's
       stdin, which `--with-parent` already reads as "stop". It waits as
       long as on Linux, and only then kills it. It never sends SIGTERM,
       which is a plain kill on Windows
       (`client/desktop/src/child.ts:29-44`).
     - From step 10, Quit Banda and `banda stop` send a new owner-only
       command, `engine.stop`, over the engine's API, the WebSocket the
       CLI already opens. They wait as long as they do on Linux, then end
       its process.
     - Whether the engine still runs is asked of Windows, by its process
       id and start time through `sysinfo`, not read from `/proc`.
   - **A logoff is not a crash.**
     - A console program gets no logoff event. So the engine keeps a
       hidden top-level window that receives `WM_QUERYENDSESSION` and
       `WM_ENDSESSION`. This is in `platform/windows`.
     - When they arrive, the engine records that it left because the
       session ended, and ends its Job Objects.
     - Without this, every logoff would show up as a crash in the
       problems journal (ADR 0039; ADR 0086 decision 1).
   - **The engine's copies.**
     - A running `banda.exe` can be renamed but not deleted, and a folder
       with a running program in it cannot be renamed. So the window
       renames an old copy's folder aside before it removes it. A folder
       Windows will not rename still runs something, and stays until a
       later start. Today the window removes nothing on Windows
       (`client/desktop/src/program.ts:305`, `:327-352`), and every Dev
       would leave a copy, so this comes with the installer (step 5).
     - Putting a new copy in place is a rename too
       (`client/desktop/src/program.ts:279-282`). It is tried a few
       times, and a copy that cannot be put in place is logged; the
       window runs the packed program, as it does today when a copy
       cannot be made.
   - **The adapters run on a `node.exe` that comes with the engine's
     copy**, never on the installed `Banda.exe`. This comes with the
     installer (step 5), not later.
     - Electron has no console (decision 3), and Windows locks a running
       program. Adapters running on the installed app would make every
       install and update kill them.
     - This is ADR 0084 decision 5's host package, on Windows first.
     - `node.exe` sits in a `node\` folder of the copy, not beside
       `banda.exe`. The engine puts its own folder first on every Agent's
       PATH (`apps/agents/engine/src/lib.rs:153-169`), and a `node.exe`
       there would stand in for the Person's own Node in every Agent's
       shell.
     - It is a pinned Node LTS release, downloaded as Banda is packed and
       checked against nodejs.org's `SHASUMS256.txt`. Its license goes in
       the notices. A Node security release means a new Banda release.
       Node's program, tens of megabytes, is in the download and in each
       copy kept.
   - **Banda keeps running after its window closes, as on macOS** (ADR
     0086 decision 4), from step 10.
     - Electron stays running with no window, as an icon in the
       notification area, with the same panel and Quit Banda.
     - It keeps sending the Person's notifications itself, under the
       installed app's id.
     - Mock first.
   - **Owner access stays the secret in `engine.json` on native Windows,
     until a fence holds there.**
     - ADR 0083 decision 1's owner socket tells the Person by the user
       the peer runs as. On Windows an unfenced Agent runs as the Person,
       with the same kind of token. No check of the peer tells the two
       apart.
     - A pipe with token checks would keep out only what the secret
       already keeps out: other accounts, by the profile's access list
       (decision 3), and the network, as the engine listens on loopback.
     - So the owner pipe comes with the MXC spike (decision 6), where a
       fenced Agent's token differs from the Person's. It is designed in
       the research: a named pipe for the Person's account and SYSTEM
       only, refusing remote clients, made as the first instance, and
       taking a client as the owner if its token has the Person's SID,
       no AppContainer, no restriction, and Medium integrity or higher.
     - The window will reach the owner pipe through `banda bridge` over
       stdio, as the `wsl` route does (decision 2). So only Rust touches
       the pipe, and no check goes stale between a look and a connect.
   - **The window's socket** (ADR 0017, `banda menu`) is a named pipe on
     Windows: `\\.\pipe\<folder>-window-<hash of the state folder>`.
     - Node listens on a pipe path as on a socket path
       (`client/desktop/src/door.ts:21-35`), with no folder to make or
       file to remove. The CLI opens it as a file
       (`engine/src/main.rs:741-765`).
     - It carries no owner access: it only opens the Banda menu. Node
       makes it with Windows' default access list. A test on the Windows
       runner checks that another account cannot send it a line. If one
       can, `banda menu` goes through the engine instead.

6. **Native Windows has no fence in v1, so its default mode is
   Supervised.**
   - ADR 0083 decision 1 already says this. Where the fence cannot hold,
     the default mode is Supervised, and the mode menu says that Full
     access there means "this Agent is you". The Person can still choose
     Full access.
   - Why the fence cannot hold on Windows:
     - Windows has no namespaces and no Landlock.
     - Hiding files from a program's reads needs a different token (an
       AppContainer, or MXC) or a different user.
     - A restricted token or low integrity limits writes, not reads.
     - Nothing tells an unfenced Agent from the Person: both run as the
       Person's account, with the same kind of token (decision 5).
   - In Supervised mode, Codex's own Windows sandbox still applies to
     its commands. Claude Code runs its commands without a sandbox on
     native Windows, as its docs say.
   - **Keys.** The Person key and the device keys (ADR 0083 decision 6;
     ADR 0081 decision 2) are protected with DPAPI. Any unfenced program
     running as the Person can read them. Pairing on a native Windows
     host warns about this.
   - Banda detects two more risks and shows them, as it does the
     `docker` group: an admin account at the default UAC level, and
     membership of `docker-users`. Microsoft treats neither as a
     security boundary.
   - **The spike, later:** MXC's ProcessContainer, on Windows 11 24H2
     (build 26100.9278 or later) or 25H2 (build 26200.9278 or later).
     - One Harness runs with wide grants, Banda's folders in
       `deniedPaths`, and its config in `readonlyPaths`.
     - Tests try the denied reads and writes, and must fail.
     - It checks that a ProcessContainer holds a long-lived program on
       piped stdio. MXC 1.0's lifecycle calls are for IsolationSession
       and WSLc only.
     - It checks that a Harness's own sandbox still runs inside it:
       Codex's MXC mode, for one.
     - If it holds, `local` fences Harnesses there, the owner pipe comes
       (decision 5), and Full access becomes the default on those
       builds.
     - MXC's native tier needs no admin.
     - It cannot contain a terminal, but the fence does not cover
       terminals anyway.
   - An AppContainer denies everything by default. That suits App
     workers (ADR 0062) better than an Agent's shell. It comes later.
   - A WSL2 host has the Linux fence (decision 2).

7. **The window on Windows.**
   - **Its safety rules come first**, before the first installer is
     built:
     - A Ctrl-click never runs a program. On Windows, a file whose
       extension is in `PATHEXT` or on a fixed list (`.exe`, `.bat`,
       `.cmd`, `.ps1`, `.lnk`, `.url`, `.scr`, `.msi`, `.hta`, `.vbs`,
       `.js`, `.wsf`, `.cpl`, `.reg`, `.appref-ms` and similar) is shown
       in Explorer, never opened.
     - `outside.ts` and `editors.ts` refuse UNC and device paths
       (`\\host\…`, `\\?\…`, `\\.\…`), as `desktop-kit/src/files.ts`
       already does.
     - A `.toml` file opens in an editor from the editors list, or else
       in Notepad. Stock Windows has no program for `.toml`.
   - **Banda's bar is the title bar, with Windows' window buttons at its
     end.**
     - This uses Window Controls Overlay: `titleBarStyle: "hidden"` and
       `titleBarOverlay`, coloured by the look.
     - Today the frame has an inset at its start only
       (`client/web/src/frame.ts`, `client/web/src/bar/Bar.tsx:156`). It
       gets one at its end too.
     - Until this lands, Windows draws its own frame above Banda's bar.
     - Mock first.
   - **The glass is Mica** on Windows 11 22H2 and later, and the Person
     can choose acrylic instead.
     - Mica is what Windows 11's own long-lived windows use. It costs
       less on an old laptop, and ADR 0080's `windows` base already
       names it.
     - Acrylic shows what is behind the window, as macOS's vibrancy
       does.
     - Both turn solid when the window is inactive, when transparency
       effects are off, or in battery saver. The page is told, so its
       light tint does not sit on a solid desk.
     - It is tested with and without `transparent: true`, because
       Electron ignores the background's alpha without it.
     - On Windows 10 the desk stays solid.
     - Mock first.
   - **The `windows` theme base** (ADR 0080 decision 4) is Segoe UI
     Variable, Mica and the system's accent. It comes once ADR 0080's
     step 1 is in. The accent and its changes are already read
     (`client/desktop/src/main.ts:663`, `:677-683`).
   - **Keys.**
     - On many keyboard layouts, AltGr arrives as Ctrl+Alt. A key
       pressed with AltGr held never matches a Banda key: `matches()`
       checks `getModifierState("AltGraph")`
       (`client/ui/src/lib/keys.ts:103-114`), as the terminal already
       does (`client/ghostty/src/t3/surface.ts:392`).
     - Super is not offered as the mod on Windows (ADR 0068). Windows
       takes most Win keys before Banda sees them.
     - Alt+Space (the Banda menu, ADR 0017) may open Windows' window
       menu or PowerToys Run instead. Alt+Shift may switch the keyboard
       layout. Alt pressed alone, then a key, may move the focus to the
       window menu. All three are tested on the laptop. If Banda does not
       get Alt+Space, Windows gets another default key for the menu,
       which Roma picks from a mock.
   - **Notifications.**
     - Banda calls `app.setAppUserModelId(channel.appId)` first thing.
       The installer's Start menu shortcut carries the same id. Without
       both, Windows shows no notifications.
     - Banda Local makes a shortcut of its own.
     - **Windows' Do Not Disturb cannot be read.** No documented call
       reports it (`SHQueryUserNotificationState` does not). So on
       Windows a system notification carries Windows' own sound, and
       Banda plays none of its own with it. Windows then silences and
       holds it under Do Not Disturb. Banda's sounds for a window in
       front still play, as on any desktop whose quiet Banda cannot read
       (ADR 0011 decision 4). Checked on the laptop.
   - **Editors** are looked for in Windows' install folders, and started
     through their own `.exe`. Node refuses to start a `.cmd` without a
     shell.
   - **Paths in the page.** A native host's paths look like `C:\…`.
     Links in a reply, dragged files, the split into name and folder,
     and Add Project's path field all learn this form. A client of a
     Linux host keeps that host's paths.
   - **The engine as the window's child** uses the `.exe` names, starts
     hidden, and is stopped as decision 5 says.

8. **Banda ships for Windows as a per-user NSIS installer that updates
   itself. It starts unsigned.**
   - **The installer** is electron-builder's NSIS, one-click and per
     user.
     - It installs into `%LOCALAPPDATA%\Programs\banda` and
       `…\banda-dev`, and needs no admin.
     - Banda and Banda Dev install side by side, because their app ids
       differ (ADR 0033 decision 1).
     - T3 Code ships the same kind of installer.
     - We rejected:
       - Squirrel.Windows: no release since 2020, and it replaces the
         updater.
       - MSIX: its virtualized AppData would apply to every Harness the
         engine starts.
       - A portable exe.
   - **The installer stops only what runs from its own folder.**
     - electron-builder's check for a running app stops every process
       whose path starts with the install folder, with no `\` after it
       (`app-builder-lib` 26.18.0,
       `templates/nsis/include/allowOnlyOneInstallerInstance.nsh:66`,
       `:94`). So installing Banda also stops Banda Dev, from
       `…\banda-dev\`. Without PowerShell it falls back to
       `taskkill /IM` (`:97`, `:99`), which stops every program of the
       window's name, `banda.exe`. The engine's copy has that name too.
     - Banda's installer has its own `customCheckAppRunning` macro. It
       matches `$INSTDIR\`, and it never falls back to a program's name.
     - The engine keeps the name `banda.exe`: it is also the `banda` CLI
       that the Person and Agents type.
     - **Until step 10, an update still stops the engine**, as it does on
       Linux today (`client/desktop/src/main.ts:326-335`), after ADR
       0072's wait for the Threads. Every Harness's processes and every
       terminal go with it. From step 10, which comes after ADR 0086's
       step 6, the update leaves the engine alone, and the engine moves
       to its new copy once no Turn runs (ADR 0086 decision 6).
     - Uninstalling stops the engine first.
   - **Updates** use electron-updater's NSIS updater, from the same
     GitHub releases.
     - Each release carries `latest.yml`, the `.exe` and its
       `.blockmap`, so an update downloads only what changed.
     - `update.ts` gets a third path, beside AppImage and brew:
       - it installs with `quitAndInstall(true, true)`;
       - it does not use `startAfter`, which is bash and `/proc`;
       - it retries while the newest release has no Windows files yet,
         as the brew path does;
       - Banda Dev's update widget is always on the bar (ADR 0045).
   - **Signing.**
     - Unsigned first, for Roma. SmartScreen asks once for each new file
       a browser downloaded: More info, then Run anyway. Updates the app
       downloads itself should not trigger it; step 6 checks that.
     - Smart App Control blocks unsigned programs and DLLs with no way
       past, the engine's copy and `node.exe` included. On a machine
       where it is on, signing has to come first.
     - Signing does not end the warnings at once. A new publisher's
       files still warn until it has reputation, which can take several
       weeks and hundreds of clean installs. Since 2024 an EV certificate
       no longer skips this.
     - Then **Azure Artifact Signing**, if Roma qualifies.
       - It costs $9.99 a month for 5,000 signatures, then $0.005 for
         each one after, and needs a paid Azure subscription.
       - It is open to companies in the US, Canada, the EU, the UK and a
         few more countries, and to individuals in the US or Canada.
       - Validation takes 1 to 20 business days.
       - The certificate shows the signer's legal name, city and
         country. For an individual, that is Roma's own.
     - Otherwise an **OV certificate** with its key in a cloud HSM.
       Certum's costs about €109–169 a year, others $150–300.
     - Not an EV certificate: it costs more and skips nothing.
     - Not SignPath Foundation, for three reasons:
       - Banda carries the Claude Agent SDK under Anthropic's terms
         (ADR 0059);
       - SignPath requires every job to run on GitHub's runners, and
         `which` runs on devbox;
       - SignPath approves each release by hand.
     - **Every program and DLL is signed, in Dev as in Stable**
       (`signExts: [".dll"]`). Smart App Control checks DLLs too, so a
       Dev with unsigned DLLs would not start where it is on. No elevate
       helper is packed (`packElevateHelper: false`): a per-user install
       never elevates.
       - That is about 12 files for each x64 build. At today's 30 or so
         Dev releases a day, it is about 11,000 signatures a month, about
         $40 on the Basic plan. Devs that Windows skips in a burst
         (below) cost nothing. arm64 doubles it.
     - Once Banda is signed, `publisherName` is set, so the updater
       refuses an update signed by anyone else.
   - **Distribution.**
     - GitHub Releases, for both channels.
     - winget for Stable only, pushed from the release workflow, as the
       AUR package is.
     - Scoop only if someone asks. It needs a mark that turns
       self-updating off, as `package-type` does for the AUR.
     - The Microsoft Store is a spike, later.
   - **Windows builds in a workflow of its own**, `release-windows.yml`.
     - It runs on `windows-2025` once `release` has published a version,
       Dev or Stable. It packs the installer, signs it once signing
       comes, and adds its files to the release with `release.mjs add`,
       as `mac-publish` does.
     - It has a concurrency group of its own: one Windows Dev at a time,
       and a newer one replaces one waiting. So Windows never holds up
       Linux and macOS, whose `release` builds one Dev at a time
       (`.github/workflows/release.yml:36-48`). In a burst of merges,
       Windows skips to the newest Dev, and its updater waits for it.
     - A run's time is measured in step 5. GitHub's runners cost no
       money here, only time.
     - arm64 joins the same run later, so one `latest.yml` lists both.
     - `promote.mjs` does not change: a Stable tag builds Windows too.
     - `scripts/package.sh` gets a Windows branch. `scripts/licenses.mjs`
       lists the crates of the target it packs, not of the machine it
       runs on (`--filter-platform`, `scripts/licenses.mjs:112`), and
       Node's license.
   - **What it costs:**

     | Item                                                 | Cost                                                           |
     | ---------------------------------------------------- | -------------------------------------------------------------- |
     | GitHub's `windows-2025` and `windows-11-arm` runners | nothing, on a public repository                                |
     | Unsigned                                             | nothing; SmartScreen warns, Smart App Control blocks           |
     | Azure Artifact Signing, Basic, x64, Dev and Stable   | about $40 a month at today's pace; about twice that with arm64 |
     | OV certificate, key in a cloud HSM                   | about €109–169 a year (Certum), $150–300 elsewhere             |
     | EV certificate                                       | $400 a year or more, with no gain                              |
     | winget, GitHub Releases                              | nothing                                                        |

9. **Every PR is checked for Windows from Linux, and tests run on
   Windows after the merge.**
   - From step 1, `ci` has a part of its own on devbox,
     `scripts/check.sh windows`. It runs cargo-xwin's clippy on the whole
     workspace and its tests for `x86_64-pc-windows-msvc`, with warnings
     as errors, as the `rust` part does for Linux.
     - It runs on a runner of its own beside `rust ts`, so it adds
       runner time, not time to wait. It is a merge gate.
     - **Until devbox's image is rebuilt with cargo-xwin**, the part runs
       the same `scripts/check.sh windows` on GitHub's `windows-2025`
       runner, with plain cargo and Visual Studio's build tools. It runs
       for PRs that change Rust or what builds it, and `ci` waits for it
       there, so until it moves it adds time to wait. It gates merges once
       it has passed on main, which main's green run leaves an artifact to
       say. Before that a failure only warns and the part stays green, so
       neither a PR nor main's Dev build is held up on day one.
     - It is not one of `check.sh`'s default parts, nor of
       `--no-window`: on a laptop, it builds every crate a second time.
       It runs locally only by name.
     - cargo-xwin and clang go into `ci/Dockerfile`, which has neither
       today. cargo-xwin downloads Microsoft's CRT and Windows SDK, under
       Microsoft's license (Open questions, 14).
     - Step 1 measures how long it takes with a warm `target/`.
   - A new workflow, `windows.yml`, runs the Rust tests on
     `windows-2025`:
     - on each push to `main`;
     - by hand (`gh workflow run windows --ref <branch>`);
     - on PRs that touch Windows code (`platform/windows/**`, files
       named `windows.rs`, the workflow itself).

     It is not a merge gate at first. A red run on `main` is fixed the
     same way a red `ci` is. Roma decides when it becomes a gate. It
     uses `Swatinem/rust-cache`, and step 1 measures how long a run
     takes.

   - **Line ends.** GitHub's Windows runners check out with
     `core.autocrlf=true`, and the repository has no `.gitattributes`.
     Step 1 adds one with `* text=auto eol=lf`, so every checkout has
     LF line ends and tests that compare text pass on Windows. Batch
     files are the exception, `*.cmd` and `*.bat` with CRLF, as cmd.exe
     misreads labels with LF.
   - Tests that run `sh` or `chmod` get a Windows version, or become
     `cfg(unix)` with the reason written next to them.
     `tools/fake-agent` already works on Windows.
   - The window's end-to-end tests come to Windows later. They need a
     Node launcher in place of `scripts/local.sh`, and fake CLIs that
     are not `#!/bin/sh` scripts. `scripts/try.sh` and `scripts/drive.mjs`
     get Windows versions when an Agent first drives a Windows build.

10. **One crate makes the Win32 calls that no safe crate covers, from
    step 7.**
    - `unsafe_code = "forbid"` stays for the workspace
      (`Cargo.toml:105-106`).
    - Steps 1 to 6 use only safe crates:
      - `process-wrap`: Job Objects on Windows and process groups on
        Unix, on tokio;
      - `listeners`, `sysinfo` and `dunce`;
      - `windows-registry`, already in `Cargo.lock`;
      - tokio's and std's named pipes, as clients.
    - What v1 does without unsafe code:
      - no Ctrl+Break: a kill, and the stale `index.lock` removed
        (decision 3);
      - no access list of its own: places stay inside the profile
        (decision 3);
      - no read of Do Not Disturb: the notification carries Windows'
        sound (decision 7);
      - no owner pipe: the secret stays (decision 5).
    - A new crate, `platform/windows`, comes with terminals (step 7):
      - the ConPTY start, born in its Job Object, and the DLL search
        (decision 4);
      - at step 10, the session's environment block and the end-session
        window (decision 5);
      - with the MXC spike, the owner pipe's access list and the token
        checks (decision 5).
    - This crate builds on Windows only. It is the only crate allowed to
      use `unsafe`. Each `unsafe` block says why it is sound and has a
      test that runs on the Windows runner. An architecture test keeps it
      the only exception.

11. **Windows is built when Roma takes it up, and waits for little.**
    - Steps 1 to 9 wait for no other plan: not the fence, not several
      hosts, not the web client.
      - Step 2 is work ADR 0084's plan step 1 left open, so it lands
        whenever either plan needs it first.
      - Only step 9's theme base waits for ADR 0080's step 1.
    - Step 10 waits for ADR 0086's step 6, which stops an update from
      restarting the engine while Turns run, and its step 7, the macOS
      menu bar, whose model the notification-area icon copies.
    - The owner pipe waits for the MXC spike. The `wsl` route waits for
      ADR 0081's step 5.
    - The first thing Roma tries is step 1's `banda.exe`, to learn
      whether an unsigned program runs on his laptop at all.
    - The first Banda he uses there is step 5's installer: Threads with
      Claude Code and Codex, Supervised, and no terminals yet.

**Open questions.** Only Roma can answer these. Each one has a
recommendation.

1. **Which Windows is on the laptop?** We need:
   - its version and build (`winver`), and its edition;
   - x64 or Arm, the amount of RAM, free disk space, and whether
     virtualization is on;
   - whether the account is an admin;
   - whether Smart App Control is on;
   - whether a company manages the laptop;
   - its keyboard layouts, and the key that switches between them;
   - whether PowerToys, Git for Windows, PowerShell 7, Developer Mode
     and WSL are installed or on;
   - whether the user name has a space or a letter outside ASCII in it.

   _Recommendation:_ run the probe (docs/research/2026-11-07-windows-probe.ps1,
   read-only) and paste what it prints. If Smart App Control is on, turn
   it off on this test laptop: on builds before 25H2 it then stays off
   until Windows is reinstalled, which is fine for a test laptop.
   Otherwise signing has to move before step 5.

   _Answered_ by the probe on 2026-11-07:
   - Windows 11 Pro 25H2, build 26200.9457, x64 (Intel i7-1255U), 16 GB
     of RAM, an NVMe disk with about 400 GB free, virtualization on in
     the firmware. So Mica, ConPTY and MXC are all there.
   - An admin account with UAC's default prompt; no domain, no Entra
     ID, no MDM; no space or letter outside ASCII in the user name.
   - Smart App Control is off, so an unsigned Banda runs. Developer
     Mode and long paths are off.
   - Keyboard layouts ru-UA, ru and en-US, switched with Windows'
     default keys; no PowerToys.
   - No Git for Windows, Node, PowerShell 7 or Claude Code. Codex CLI
     0.150.1 is there from OpenAI's installer, with its own sandbox set
     to `elevated`.
   - WSL was not installed. The probe's `wsl --version` installed it
     (WSL 3.0.3, no distro), which decision 2 now forbids Banda to do;
     the probe no longer runs `wsl.exe`.

2. **Native first, or a WSL2 host first?** _Recommendation:_ native
   first (decision 2). It depends on no other plan, and it works on a
   laptop without virtualization. The WSL2 host comes after ADR 0081's
   routes, and brings the full fence.
3. **Is Supervised the right default for native Windows?**
   _Recommendation:_ yes. It is ADR 0083's own rule, and the MXC spike
   may lift it on recent Windows 11 builds.
4. **Safe crates until step 6, then one crate that may use `unsafe`?**
   _Recommendation:_ yes to decision 10. The alternative for terminals
   is `portable-pty` with its three faults worked around: the Job Object
   set right after the start, which leaves a race; the engine answering
   ConPTY's cursor question itself; and a pinned `conpty.dll` shipped
   beside `banda.exe`, so that Windows finds that one first. It keeps
   `unsafe` out of Banda, but it leaves the race, and Banda would ship
   and update Microsoft's `conpty.dll` with every release.
5. **A detached engine, or a Task Scheduler task?** _Recommendation:_
   a detached engine (decision 5). Use the task only if step 10 finds
   common starters whose Job Object does not allow breaking away.
6. **After the last window closes: an icon in the notification area
   with Electron still running (the macOS model), or Electron exits and
   the engine sends notifications (the Linux model)?**
   _Recommendation:_ the icon. Windows notifications need the app's id
   and shortcut. The installed app has them, and a lone `banda.exe`
   does not. Mock first.
7. **Banda's bar as the title bar (Window Controls Overlay), or Windows'
   own frame above it?** _Recommendation:_ Banda's bar, as on macOS.
   Mock first.
8. **Mica or acrylic as the default?** _Recommendation:_ Mica, with
   acrylic as a choice (decision 7). This changes ADR 0030 decision 4.
9. **Who signs, and when?** Is 0x1oceanlabs a registered company, and
   in which country? Or would Roma sign as an individual, and where does
   he live? The certificate shows the signer's legal name, city and
   country. _Recommendation:_ stay unsigned until someone other than
   Roma uses Banda on Windows. Then use Artifact Signing if eligible,
   otherwise Certum's OV certificate. Sign every program and DLL, in Dev
   too, for about $40 a month.
10. **winget? Scoop?** _Recommendation:_ winget for Stable. Scoop only
    when someone asks.
11. **arm64 now or later?** _Recommendation:_ later (step 13). It is
    cheap, but nobody has an Arm machine to try it on.
12. **May step 1 land early, before Roma takes Windows up?**
    _Recommendation:_ yes, on its own. The Unix-only call sites are few
    and small today, and every Unix-only change that merges adds more.
    Once step 1 is in, its part in `ci` keeps Windows compiling at
    little cost.
13. **Use Microsoft's MXC SDK (the `mxc-sdk` crate) for the Windows
    fence?** _Recommendation:_ yes for the spike. Decide after the spike,
    based on what it shows.
14. **Accept Microsoft's license for the CRT and Windows SDK that
    cargo-xwin downloads into the CI image?** _Recommendation:_ yes. It
    is the license every Rust build for Windows accepts with Visual
    Studio's build tools, which GitHub's Windows runners come with.
15. **How do App workers (ADR 0062) run on a Windows host?**
    _Recommendation:_ a worker written in TypeScript runs on the
    `node.exe` Banda carries. An App from elsewhere written in Rust
    names the targets it is built for, and a Windows host says when an
    App has no Windows build. Decide with the tracer App.

**Plan.** Each step is its own PR, and `scripts/check.sh` passes after
each. Windows work starts when Roma takes it up (decision 11). Step 1 may
come earlier if Roma agrees (Open questions, 12). The sizes come from
the research: S is up to a day, M is two to five days, L is one to two
weeks.

0. **The laptop's facts.** No PR. Roma runs the probe and answers the
   open questions. This ADR is accepted with his answers.
   - _Roma tries:_ the probe, in PowerShell.
1. **It compiles on Windows** (M).
   - `pty-process`, `nix` and the Unix-only `rustix` calls become
     `cfg(unix)`, and `hyprland.rs` becomes Linux only.
   - Each Unix-only call site gets Windows code where that is a line or
     two. Where it needs a step of its own (terminals, servers), it says
     "not on Windows yet".
   - `.gitattributes` with `* text=auto eol=lf`.
   - `ci` gets its `windows` part, with cargo-xwin and clang in the
     image. `windows.yml` runs the tests that pass on Windows, and marks
     the others with the reason.
   - Each `windows.yml` run keeps `banda.exe` as an artifact.
   - _Roma tries:_ `banda.exe --version` from the artifact. Then
     `banda.exe serve` in one PowerShell window and `banda.exe status` in
     another. He notes what SmartScreen, Smart App Control and Defender
     say about an unsigned program.
2. **The port's handles** (M).
   - Decision 3's handle that stops what it started, and the port's own
     PTY handle.
   - Git, the terminal, the Harnesses' pipes and the servers stop
     through it.
   - Linux and macOS behave as before.
   - This is work that ADR 0084's plan step 1 left open, so it can land
     whenever ADR 0084 needs it.
   - _Roma tries:_ nothing; Linux does not change.
3. **Windows processes and paths** (M–L). Everything in decision 3,
   with no unsafe code:
   - Job Objects through `process-wrap`, with no breaking away;
   - stopping by stdin and by the Job Object, and git's stale lock;
   - one hidden console for the engine, inherited by its programs;
   - PATH from the registry;
   - `PATHEXT`, `.cmd`, the vendors' folders, and `WindowsApps` skipped;
   - `dunce` and case-insensitive paths;
   - the places under `%LOCALAPPDATA%`, and places outside the profile
     refused;
   - renames with a few tries;
   - the build id from the PE, and `banda.pdb`;
   - git's hooks folder;
   - the names Windows refuses.

   The Harness tests run on Windows with `tools/fake-agent`.
   - _Roma tries:_ with `banda.exe serve` running, `banda.exe call`
     finds his Claude Code and Codex, including one he installs while
     the engine runs. No console window flashes.

4. **The window on Windows** (M).
   - Decision 7's safety rules first.
   - The `.exe` names and the window's places.
   - The child engine started hidden, and stopped by closing its stdin.
   - The window's socket as a named pipe, and a test on the Windows
     runner that another account cannot write to it.
   - The app id, notifications with Windows' sound, the AltGr guard, no
     Super as the mod, the editors and `.toml` files.
   - _Roma tries:_ nothing yet; step 5 brings the installer.
5. **The installer, built by hand** (M).
   - electron-builder's NSIS target, with Banda's own
     `customCheckAppRunning`.
   - `node.exe` pinned and checked, in the engine's copy, and the
     adapters on it. Banda's codex-acp patch adds `windowsHide`, and the
     fix for a CLI path with a space (codex-acp#602).
   - Old copies renamed aside and removed; new ones put in place with a
     few tries.
   - `banda.pdb` packed. `licenses.mjs` follows the target, with Node's
     license.
   - `release-windows.yml`, run by hand
     (`gh workflow run release-windows --ref <branch>`), unsigned, x64.
     It measures how long a run takes.
   - Windows still draws its own frame, and there is no glass yet. The
     Terminal Pane says terminals come later.
   - _Roma tries,_ the first real try:
     - installs Banda Dev from the run, getting past SmartScreen;
     - adds a Project on NTFS, and checks Git's `core.autocrlf` in it;
     - runs a Claude Code Thread and a Codex Thread in Supervised mode,
       approves a command, and sees no console window flash;
     - opens Files and a diff, and notes how slow Defender makes a
       Project with `node_modules`;
     - Ctrl-clicks a `.bat` an Agent wrote: Explorer opens and the file
       does not run;
     - gets a notification when a Turn ends, with Do Not Disturb off,
       then on;
     - presses Alt+Space, taps Alt alone, and uses Banda's Alt+Shift
       keys with his keyboard layouts;
     - types AltGr characters, if a layout has them;
     - runs `banda menu` from PowerShell;
     - closes the window and sees the Agents stop, since the engine is
       still the window's child;
     - installs the next run over a running Banda.
6. **Dev on every merge, and updates** (M).
   - `release-windows.yml` after every Dev, with its own concurrency
     group, adding its files to the release.
   - The NSIS path in `update.ts`, with its retry.
   - "Update now" (ADR 0045), tested on two Dev releases, as was done for
     ADR 0041.
   - _Roma tries:_ Banda Dev updates itself from the bar, from one Dev
     to the next, with no SmartScreen prompt. The engine starts again
     afterwards, and the old copy goes once nothing runs from it.
7. **Terminals** (L). Decision 4, and `platform/windows` with it
   (decision 10): Banda's own ConPTY start, born in its Job Object, with
   no flags and kernel32's `CreatePseudoConsole`; the DLL search; the
   default shell; what runs in front; signing in from a terminal.
   - _Roma tries:_
     - terminals with pwsh, Git Bash and `cmd`;
     - `claude` inside one;
     - resizing, Ctrl+C, and closing a Pane while a program runs;
     - a terminal left running with its Pane closed, then opened again;
     - the Pane's label, showing the program and folder;
     - text at 100, 125 and 150 % scale;
     - Claude Code's sign-in from its Harness row.
8. **Servers** (M). ADR 0044 through `listeners` and `sysinfo`.
   - _Roma tries:_ a dev server started in a terminal shows on the bar,
     opens from it, and stops from it.
9. **The look on Windows** (M). Mock first:
   - Banda's bar as the title bar, with Windows' buttons at its end;
   - Mica, and acrylic as a choice;
   - the `windows` theme base, once ADR 0080's step 1 is in;
   - a new key for the Banda menu, if Alt+Space failed in step 5.
   - _Roma tries:_ the mock, then the build: light and dark mode, the
     accent, Snap layouts on the maximize button, and F11. The glass
     works only on Windows 11. If the laptop runs Windows 10, testing
     the glass waits for a Windows 11 machine, since GitHub's runners
     cannot show it.
10. **The engine outlives the window** (M–L), after ADR 0086's steps 6
    and 7. Decision 5:
    - `banda start` starts the detached engine from its copy, and a
      client inside a Job Object of Banda's never does;
    - the session's environment block;
    - `engine.stop`, for Quit Banda and `banda stop`;
    - the end-session window;
    - the icon in the notification area, mock first;
    - Electron keeps running with no window;
    - the update leaves the engine alone.
    - _Roma tries:_
      - closes the window while an Agent works, and the Agent keeps
        going;
      - opens the icon's panel;
      - uses Quit, which asks first and then stops everything;
      - logs off and on, and Banda says the session ended, with no
        crash;
      - an update during a running Turn waits for the Turn to end;
      - the installer leaves the engine alone.
11. **Signing** (S, plus the paperwork for the signing identity, which
    takes 1 to 20 business days for Artifact Signing). Decision 8.
    - _Roma tries:_ a fresh install that shows Banda's publisher, with
      Smart App Control on, on a machine where it still can be.
12. **Stable for Windows** (S–M).
    - A Stable release tagged by `promote.mjs` builds Windows too.
    - winget for Stable.
    - With this, ADR 0033 decision 7 is done.
    - _Roma tries:_ `winget install` of Banda, next to a running Banda
      Dev, which keeps running through the install.
13. **arm64** (S–M). The same run builds it, and tests run on
    `windows-11-arm`.
    - _Roma tries:_ nothing, unless he has an Arm machine.

Later, each as its own step or spike:

- MXC's fence (decision 6), on a Windows 11 24H2 or 25H2 machine, and
  the owner pipe with it (decision 5).
- The `wsl` route (decision 2), after ADR 0081's step 5 and a client
  that takes files, media, settings and the look from its host.
- The window's end-to-end tests on Windows, and Windows versions of
  `try.sh` and `drive.mjs`.
- A newer `conpty.dll` and `OpenConsole.exe`, if step 7 shows they are
  needed.
- AppContainers for App workers (ADR 0062).
- The Microsoft Store, as a spike.
- Scoop, if someone asks.
- A Task Scheduler task, if step 10 finds starters that need it.

**Consequences.**

- Windows becomes Banda's third platform. From step 1, every new
  Unix-only call needs a `cfg` and either a Windows answer or "not on
  Windows yet". Otherwise the `windows` part of `ci` fails.
- On native Windows, Full access means "this Agent is you" until a fence
  holds there. The mode menu says so, and Supervised is the default.
- On native Windows, owner access stays a secret in `engine.json`, kept
  to the Person by the profile's access list, until the MXC fence
  brings the owner pipe.
- Threads come to Windows before terminals do.
- On Windows, Banda keeps running with no window open, as on macOS, with
  an icon in the notification area.
- Windows refuses some things Unix allows, such as deleting or moving
  something a program has open, or making a link without Developer
  Mode. Banda says why instead of failing quietly.
- From step 5, the Windows download and each copy of the engine include
  a `node.exe`. A Node security release means a new Banda release.
- Banda's codex-acp patch grows by `windowsHide` and the fix for a path
  with a space. Each part goes once codex-acp takes it (ADR 0062,
  decision 16).
- From step 11, signing costs about $40 a month, or €109–300 a year for
  an OV certificate. GitHub's Windows runners cost nothing.
- From step 7, a new crate, `platform/windows`, is the only place
  allowed to use `unsafe`.
- `docs/architecture.md` gets a Windows section: the port's handle, Job
  Objects, places, and what runs where. `GLOSSARY.md`'s "Owner socket"
  says that native Windows has none until a fence holds there. The
  README explains how to install on Windows, and `CONTRIBUTING.md`
  explains how to run the Windows checks. The Banda skill names the
  Windows places, where it names only `~/.local/share/banda`,
  `~/.config/banda` and systemd today (`platform/skill/SKILL.md:16`,
  `:59`, `:142`, `:149-151`).

**Changes.**

- ADR 0033, decision 7: Windows ships as this ADR says, with a per-user
  NSIS installer, Dev after every merge to `main`, Stable promoted by
  hand, and winget for Stable (decision 8). On Windows, decision 1's
  places are under `%LOCALAPPDATA%` (decision 3).
- ADR 0030, decision 4: on Windows 11 the system's material is Mica by
  default, with acrylic as a choice. Windows' title bar is Banda's bar,
  with the window buttons at its end (decision 7).
- ADR 0041 and ADR 0045: Windows updates through electron-updater's NSIS
  updater, and Banda Dev's widget is always on its bar (decision 8).
- ADR 0059, decision 1: from step 5, on Windows the adapters run on a
  `node.exe` kept with the engine's copy, never on the installed
  `Banda.exe` (decision 5). ADR 0059, decision 3: on Windows, PATH comes
  from the registry, not a login shell (decision 3 here).
- ADR 0083, decision 1: native Windows is a place where the fence cannot
  hold, so its default mode is Supervised until the MXC spike shows
  otherwise (decision 6). Until then, owner access there stays the
  secret in `engine.json`; with the fence, the owner socket is a named
  pipe, and the engine checks the client's token (decision 5).
- ADR 0084, decision 1: on Windows, `local` starts each program in a
  Job Object and stops it through it, and the port's handle covers both
  Unix and Windows (decision 3). ADR 0084's open question on macOS also
  covers `container` and `sandbox` on Windows (decision 2).
- ADR 0086, decision 1: on Windows the engine is a detached process that
  any client outside Banda's Job Objects starts, not a systemd unit or a
  launchd agent. It records when the session ended (decision 5). ADR
  0086, decision 2: on Windows the build id is the PE's CodeView GUID,
  and `banda.pdb` is copied with the engine (decision 3). ADR 0086,
  decision 4: on Windows, Banda stays in the notification area, as it
  stays in the menu bar on macOS. ADR 0086, decision 7: on Windows, an
  Agent's test run of Banda Local lives and ends in the Agent's Job
  Object (decision 5).
- ADR 0081, decision 4: a `wsl` route joins `ssh`, later (decision 2).
- ADR 0009 and ADR 0011, decision 4: on Windows a system notification
  carries Windows' own sound, so Windows' Do Not Disturb silences it;
  Banda cannot read that switch (decision 7).
- ADR 0068, decision 1: Super is not offered as the mod on Windows, and
  AltGr never matches Ctrl+Alt (decision 7).
- ADR 0017, decision 1: on Windows, Alt+Space stays the Banda menu's key
  only if testing on the laptop shows it reaches Banda (decision 7). The
  window's socket is a named pipe there (decision 5).
- ADR 0080: the `windows` base theme moves from "Later" into this plan,
  at step 9 (decision 7).
