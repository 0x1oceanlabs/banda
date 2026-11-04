---
status: accepted
date: 2026-11-04
---

# A Thread starts in No Space, and may become a Space

A Person who just installed Banda sees one thing: "Create your first Space" (`app/web/src/Spaces.tsx`, `FirstSpace`). The window shows nothing else, not even the settings, until there is a Space (`app/web/src/App.tsx`). Someone who only wants to ask an Agent something has to name a folder first.

T3 Code does not ask. Its server keeps a hidden project titled "No project" at `~/.t3/scratch` (`ManagedProjectFolders.ts`, `projects.ensureScratch`). Each Thread there gets its own folder, `<scratch>/<date>-<first words>-<id8>`, and its terminals open in it. A Thread can later be promoted to a real project in place (`ScratchThreadPromotion.ts`).

What Banda has now:

- A Space is a folder plus its data in `~/.local/share/banda/spaces/<id>/`. A new one goes in `~/Banda/<name>/` (ADR 0026). `space.json` names the folder, and it already holds flags: `pinned`, `archived`, `sees_others`.
- Every module works in a Space's folder: an Agent's session (`session/new`), a terminal, git, the browser's Space. A Thread has no folder of its own.
- `spaces.locate` already points a Space at another folder, for one whose folder went missing (ADR 0026, step 7).
- Since ADR 0040, the Harnesses and their accounts are the machine's, so signing in needs no Space.

Roma, 2026-11-03: a T3-like hidden project, "folder per Thread, promote later", as its own ADR after ADR 0040's step 4b. Roma, 2026-11-04, on the mock: call it "No Space", since Banda says Space, not project. Then, OK on the choices below: a Space per Thread, `~/Banda/scratch/`, a Thread on first run, a move to `~/Banda/<name>/` by default.

Two ways were weighed:

- **One hidden Space, a folder per Thread**, as T3 Code does. A Thread would need a folder of its own in agents, terminal, git and the browser. Making a Space from it would move the Thread from one Space's log to another's.
- **A Space per Thread, marked scratch.** Each Thread in No Space is a small Space of its own. Every module works as it does now, in its Space's folder. Making a Space from it only takes the mark off.

The second: nothing new below the kernel, and a Space stays one folder.

## Decision

1. **A scratch Space.** `space.json` gets `scratch`, false unless set. `spaces.create { scratch: true }` makes one, with no name asked: its folder is `~/Banda/scratch/<date>-<id8>/`, and its name is empty. `SpaceSummary` carries `scratch`. Everything else about it is a Space's: its log, its Threads, its terminals, its git, the Space wall for its Agents.

2. **No Space, in the window.** The sidebar lists the scratch Spaces as one group, "No Space", below the Spaces. It shows their Threads, not the Spaces themselves; a Thread's row reads as in any Space. The Space pickers (New Thread, Add Space, the overview's labels) leave scratch Spaces out. "New Thread" in the group, or in a window with no Space chosen, makes a scratch Space and sends the first message there, one command each, so a resend finds the same Space.

3. **The first run is a Thread.** With no Space shown, the window opens a new Thread in No Space instead of `FirstSpace`. Creating or adding a Space stays in the sidebar's "+" and the Banda menu. The settings open as in any window. The Agents settings' path with no Space (ADR 0040, step 4b) stays for the moment before the first message.

4. **"Make a Space from it…"** A No Space Thread's row menu offers it. A dialog asks the name, and where the folder goes:
   - moved to `~/Banda/<name>/`, the default, as a new Space's;
   - or kept where it is.
   It is one command, `spaces.update { scratch: false, name, folder? }`. Moving renames the folder and writes the new place into `space.json`, as `spaces.locate` does. It is refused while a Turn runs or a terminal is open in the Space, in words that say which. The Thread and everything in the Space go with it, since they are the Space's.

5. **What is kept.** Archive hides a scratch Space with its Thread, as it hides any Space. Remove forgets it, and as with any Space its folder stays. Banda deletes no folder it made by itself; a cleanup of old scratch folders is a later question.

6. **Each scratch Space has its own Harness process,** as each Space does, let go after five minutes with nothing asked (ADR 0040). Many short Threads mean many short processes, never many at once.

## Consequences

- A Person can chat at once on first run, and sign in from the Thread's own card or from the settings.
- The kernel learns one flag and a move. agents, terminal, git, browser and harnesses do not change.
- `~/Banda/scratch/` fills with small folders. They are the Person's to read, copy or delete, and "Show the folder" opens them.
- A Person who adds `~/Banda/scratch` itself as a Space gets a Space over the scratch folders. Nothing breaks; it is just odd.
- Threads in No Space each live in their own log, so an Agent there sees no other No Space Thread unless the Space lets it see others (ADR 0032).

## Steps

1. **The kernel:** `scratch` in `space.json` and `SpaceSummary`, `spaces.create { scratch: true }` and its folder, and `spaces.update { scratch: false }` without a move (decisions 1 and 5).
2. **The window:** the sidebar's No Space group, its New Thread, the pickers leaving scratch Spaces out, and the first run opening a Thread (decisions 2 and 3). Mock first.
3. **Make a Space:** the row menu, the dialog, and the move in `spaces.update`, refused while something runs (decision 4).
