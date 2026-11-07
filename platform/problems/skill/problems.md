---
name: problems
description: What broke in Banda itself - how to look into a Problem the Person asked about, fix it in Banda's checkout, or find its issue on GitHub - and never send anything without the Person.
---

# Problems

A Problem is something that broke in Banda itself: the page of its window,
the window's main process, a process of Banda's that crashed, or the
engine. A Turn that failed, or a program of the Person's that broke, is
not one. The engine keeps each Problem on this computer, once, by its
fingerprint: a hash of its kind and its top frames in Banda's code. The
same fault has the same fingerprint on every machine.

The tools `problems` and `problem` read them; `banda problems` and
`banda problems report <fingerprint>` say the same in a terminal. Nothing
here sends anything anywhere.

## When the Person asks you to look into one

1. Read it with `problem`: what broke, its frames, Banda's version and
   system, and the last lines of the logs. `text` is all of it in
   Markdown. `checkout` is the folder of Banda's source the engine runs
   from, or null for a released Banda.
2. Say whether it is Banda's. It is when its frames are in Banda's code
   (`client/`, `apps/`, `platform/`, `sdk/`, `engine/`, `kernel/`; in a
   Problem kept before these folders, `app/`, `modules/`, `contract/`). A
   disk that is full, a program that is missing, or a network that is down
   is the Person's to fix: say what to do, and stop there.
3. Then, one of the two below.

A released Banda's page frames name its bundles, `assets/App.js`, not
its source files: say where it likely broke from the message and the
logs, and say that you guess.

### `checkout` is this Thread's folder: fix it here

Fix it there, as the repository's `AGENTS.md` says: find the cause from
the frames, fix it at its root, add a test that broke before the fix,
and run the checks. Do not draft an issue unless the Person asks for one.
When `checkout` is another folder, say so: a Thread in that folder's
Project can fix it.

### `checkout` is null: find its issue

1. Search Banda's issues for the fingerprint, closed ones too:
   `gh search issues <fingerprint> --repo 0x1oceanlabs/banda`. Without
   `gh`, say the address to look at:
   `https://github.com/0x1oceanlabs/banda/issues?q=<fingerprint>`.
2. An issue has it: say which, whether it is closed, and in which version
   it was fixed if it says. If it is open, draft a comment with what is
   new, this version, this system, how many times: `draft_issue` with
   `comment_on` its number.
3. None has it: draft the issue with `draft_issue`, its title what the
   Person saw, in a few words, and its body what you found, then the
   report's `text`.

`draft_issue` shows your Person a card with Send, Edit and Cancel. Never
open an issue or comment yourself, with `gh` or otherwise: the Person
sends it, or not.
A report holds no Thread's words, no paths outside Banda's code, and the
Panes by their kinds alone; keep it so.
