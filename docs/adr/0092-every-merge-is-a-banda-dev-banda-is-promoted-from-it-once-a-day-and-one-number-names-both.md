---
status: accepted
date: 2026-11-08
---

# Every merge is a Banda Dev, Banda is promoted from it once a day, and one number names both

_Proposed on 2026-11-07, rewritten on 2026-11-08 after Roma's answers and
three reviews, and accepted by Roma on 2026-11-08. It replaces ADR 0033's
decisions 3 and 4, and amends ADR 0033, 0041, 0045 and 0072 (see Changes).
Code is cited as `path:line` from main at `3da9176e`._

Roma, on 2026-11-07: "let's settle the rules for versions and tags, so we
don't get confused later." Then, on the first draft, which had one Dev a day
and a Stable a week old (translated): "Two apps: in one (Banda) I work, the
second (Banda Dev) I test right away. I propose a daily release straight
from main: Stable releases once a day; later we may slow down. A rolling
release. Release numbers: now e.g. 0.382.0; when we launch it will be
1.123.1; every PR changes the number, like Claude Code and Codex."

On 2026-11-08 he took every recommendation, with two calls of his own: N
counts the commits on main, as Chromium's commit position does, and the PRs
a release holds are shown beside its version; MAJOR is a promise to people,
not a reaction to changes inside Banda (decisions 5 and 6).

**Where it stands.**

- Every push to main whose `ci` passes publishes a Banda Dev, 20 to 40 a
  day (`.github/workflows/release.yml:16-31`), as `0.1.0-dev.N`, N being
  the workflow's run number (`:99-108`), which rises by about 70 a day. The
  Mac's files join the release after Linux's (`release.yml:5-7`).
- `scripts/release.mjs` deletes all but the last 20 Devs and their tags
  (`release.mjs:17`, `:179-189`). No Stable has shipped; `promote.mjs` would
  push a tag (`promote.mjs:66-72`) that starts a build (`release.yml:21-22`).
- Banda Dev takes only a tag with its version's word, `dev`, and falls back
  from `dev-linux.yml` to `latest-linux.yml` (electron-updater 6.8.11,
  `out/providers/GitHubProvider.js:52-88`, `:132-145`). On a Mac it only
  shows the brew command (`client/desktop/src/update.ts:286-288`).
- A PR's build is Banda Dev at `0.1.0-local` (`scripts/package.sh:13-17`).
- An engine refuses a Project a newer engine migrated
  (`kernel/src/store.rs:893-899`), so going back a version is not safe.

**What Claude Code does**, checked on 2026-11-07: every release is a plain
`2.1.N`, some numbers never ship, and its `stable` is "typically about one
week old, skipping releases with major regressions". An update downloads in
the background, takes effect at the next start, and never goes back.

**The rules.**

1. Every merge to main reaches Banda Dev in the next release whose `ci`
   passes, about half an hour later, and Banda Dev installs it by itself,
   on Linux and on a Mac.
2. Every morning at 05:17 Madrid, Banda moves to the newest Dev that is at
   least 12 hours old, unless a hold stops it. With nothing new, Banda
   stays.
3. A release is `MAJOR.N.PATCH`. N counts main's commits up to the
   release's commit, from where its major began, so it only rises, and one
   commit has one number in every release build and in both apps. MAJOR
   moves only on Roma's word, as a promise to people.
4. Only the publish makes tags, one per release. A tag is never moved or
   deleted.
5. Nothing goes back a version. A bad release is withdrawn, which holds both
   apps, and the fix comes forward.

**Decision.**

1. **The words.**
   - **Banda** is the app Roma works in, **Banda Dev** the one he tests in.
     **Banda Local** is Banda from a checkout, a PR or a run by hand; it
     never updates.
   - A **release** is one GitHub release at one tag, such as `v0.761.0`,
     with both apps' files for every platform. Every release is a **Dev**.
     A **promoted** one is also a **Stable**: marked Latest, no longer a
     prerelease. Banda installs only Stables.
   - To **hold** is to stop the next Stable; to **promote now**, a Stable on
     Roma's word at any hour; to **withdraw** a release, to delete it and
     keep its tag, so its number is never published again.
   - **The build** is `release.yml`, with a read-only token. **The publish**
     is the workflow that writes: releases, tags, the tap and the AUR.

2. **Two apps, and no switch.** Banda and Banda Dev keep their own folders,
   lock and engine unit (ADR 0033, decision 1). Neither switches channels:
   from Dev to Stable would go back a version over one data folder.

3. **Every merge is a Dev.**
   - The build runs on every push to main, beside `ci`, on GitHub's runners.
     One runs at a time, and a newer push replaces one waiting
     (`release.yml:36-48`), so a burst of merges is built at its first and
     its last commit.
   - It packs both apps (decision 8), and each starts before it counts:
     with its sandbox on, on empty folders, then on the folders the last
     release of its kind used, where its engine opens the Project, then with
     one real update check that only reads. The build attests its files.
   - Once `ci` and the build pass, the publish makes one draft with every
     file, writes the notes and publishes it, which makes the tag; then the
     `banda-dev` cask, caught up first if a publish left it behind.
     Publishes run one at a time, each taking the newest commit that is
     ready, so an older one never lands after a newer.
   - Nothing is published for a commit that changes `.github/workflows/`,
     as GitHub does not let the workflow's token tag it
     (`release.mjs:157-176`), nor when only `docs/` and the root's Markdown
     changed since the last Dev. The next merge carries it.
   - **The notes**: the title `Banda Dev 0.761.0`, `Built from a1b2c3d`, and
     one line per PR merged since the last Dev, which the popover groups by
     kind (ADR 0072, decision 5). The popover's head shows their numbers
     beside the version, `0.761.0 — #714, #715`, and only the first of a
     Stable's long list, `#714, #715 +28`. The bar's label is the plain
     version.
   - **Banda Local** is `0.0.0-local`, below every release, told from
     another Banda Local by its build id (ADR 0086, decision 2), with
     folders, lock, engine unit and engine copy of its own
     (`client/desktop/src/program.ts:8-19`). It knows by its channel that it
     never updates, not by having no `APPIMAGE` (`update.ts:61-86`).

4. **One number names both.** A Stable keeps the version of the Dev it was:
   "Banda 0.761.0" and "Banda Dev 0.761.0" are one commit, so a Problem, a
   note or an agent names one thing. Promoting changes no file and no tag; a
   release never promoted stays a prerelease.

5. **The version is `MAJOR.N.PATCH`**, plain SemVer with no word after it,
   as Claude Code's and Codex's are. Nobody types it.

   | What                             | Version                    | Tag                                |
   | -------------------------------- | -------------------------- | ---------------------------------- |
   | A Dev today                      | `0.1.0-dev.391`            | `v0.1.0-dev.391`                   |
   | The bridge (see below)           | `0.1.0-dev.420`            | `v0.1.0-dev.420`                   |
   | The first release with a plain N | `0.750.0`                  | `v0.750.0`                         |
   | A commit whose `ci` failed       | `0.751.0`                  | none, unless its `ci` passes again |
   | A Dev                            | `0.761.0`                  | `v0.761.0`                         |
   | The same Dev, promoted to Banda  | `0.761.0`                  | `v0.761.0`                         |
   | The same commit, built again     | `0.761.0`                  | `v0.761.0`, made once              |
   | The first release of 1           | `1.1.0`, or a little above | `v1.1.0`                           |
   | A release after launch           | `1.123.0`                  | `v1.123.0`                         |
   | Banda Local                      | `0.0.0-local`              | none                               |
   - **N counts the commits on main's first-parent line up to the
     release's commit**, `git rev-list --count --first-parent <commit>`, as
     Chromium's commit position does. "On main" means on that line. Main
     only moves forward: PRs merge by rebase (`AGENTS.md:37-38`), and its
     ruleset forbids force-pushes and deleting it, two rules N rests on. So
     N rises in merge order, and a commit has one N in every release build,
     in Banda and Banda Dev alike, with nothing kept anywhere. Not the
     build's run number, which differs between builds of one commit and
     starts again under a renamed workflow; not a PR's number, as PRs merge
     out of order (#700 before #699). The PRs a release holds are shown
     beside its version instead.
   - Main has one merge commit (`80cd8c59`, PR #65), and the repository
     still allows them. A commit inside a merge is not on main's
     first-parent line and has no N; the merge commit has one. Roma turns
     merge commits off (see the Plan).
   - **One job counts**, `which`, and hands the version to every pack job,
     which keep shallow checkouts. It fetches main's history without tags
     (`git fetch --no-tags --filter=tree:0`), as `fetch-depth: 0`, which
     `which` has today (`release.yml:76-80`), also fetches every tag. A
     push of several commits ships only the last one's N, and a commit
     whose `ci` fails ships none, unless its `ci` passes again before a
     newer commit ships: N has gaps, as Claude Code's numbers do.
   - **`.github/release.toml`**, read at the built commit, holds Roma's
     numbers: `major = 0`, `from = 1` and `every = 1` (decision 7). N is the
     count less `from`, plus 1. Main's first-parent line has 737 commits at
     `3da9176e` and gains about 100 a day, so the first plain version is
     main's count then, above every `0.1.0-dev.N`; the examples here say
     `0.750.0`. Only Roma edits it. At a new major he sets `major`, and
     `from` to about main's count then, so N starts again: the first
     release of 1 is `1.1.0` or a little above. His `1.123.1` is `1.123.0`
     here.
   - **The build refuses** an N above 65,000, as Windows keeps each part in
     16 bits; an N below 1; a commit not on main; and a version at or below
     the line (decision 10), but a build of a commit whose release is
     published ends green and says so. At about 100 commits a day, N nears
     65,000 about 1.8 years into a major; Roma then decides how to go on
     (decision 6).
   - **PATCH is 0.** Building a commit again gives its version again, so a
     failed publish, which made no tag, is done again at the same version.
     A withdrawn release is followed by the fix's N; an urgent fix goes
     through main and is promoted now. A release that must be published
     again with no new code would take PATCH + 1; nothing does yet.
   - **The commit and its date are baked in beside the version**
     (`BANDA_COMMIT`, and `BANDA_DATE`, the commit's date, so a rebuild
     says the same), not as `+meta`, which comparisons ignore. The first
     line of `banda --version` keeps the build id last (ADR 0086, decision
     2): `banda 0.761.0 (a1b2c3d, 2026-11-08) (build 16da2821…)`. Settings >
     Problems, the popover, a Problem and a sharing event carry the commit
     and its date.
   - **It sorts right everywhere:** in SemVer and electron-updater,
     `0.1.0-dev.420 < 0.750.0 < 0.761.0 < 1.1.0`; in the AUR's `vercmp`, with
     no `-` to turn into `_`; on Windows as `MAJOR.N.PATCH.0` (ADR 0090); on
     a Mac in both bundle versions. Homebrew upgrades whenever the cask
     differs, so a cask moves only forward.

6. **MAJOR is Roma's promise to people.** He moves it rarely, on his word,
   never for a change inside Banda.
   - **0** until the launch, the day Roma announces Banda: anything may
     change. A public repository is not the launch.
   - **1** from the launch, promising that what works in 1.x keeps working
     through 1.x: Apps written to App API 1 run; a CLI command or MCP tool
     may be marked as going, with notice, and goes only at 2; settings
     files are read; and data migrates by itself.
   - **2** only when such a promise is broken on purpose: an App API major
     dropped, a CLI command or MCP tool removed, a step by hand on an
     update. A new contract beside the old, App API 2 beside 1, is not a
     major.
   - **When N nears 65,000** (decision 5), about 1.8 years into a major at
     today's pace, Roma decides how to go on. A new major that breaks no
     promise is one way.
   - **The App API** in this promise is the host API an App is written to,
     the SDK (ADR 0062, decisions 5 and 11), whose major an App's `api`
     names (`apps/agents/module.toml:10-11`). An App's own API, which a
     host serves at its current major and the one before (ADR 0082,
     decision 14), is the App's to number and moves no Banda major.
   - **The contracts keep their own numbers**, agreed at each layer as ADR
     0082 decision 14 lists them: the protocol between a client and a host
     (`PROTOCOL`, today between the window and the engine,
     `kernel/src/lib.rs:121-123`), each App's API, published facts, the
     Person's documents and the catalogue; and each module's migrations
     (`kernel/src/store.rs:888-899`). A client and a host of two versions
     agree through the protocol's range, not through MAJOR. A
     `module.toml` version and Cargo's `0.1.0` are not the release's
     either.
   - **Step 4 adds the contracts' numbers to `banda --version`**, on the
     lines after its first: the protocol, Banda's own Apps' `api` and each
     module's migrations, all compiled in, never an installed App's. So
     the window's check of its engine copy, which compares two outputs
     whole (`client/desktop/src/program.ts:185-210`), still compares one
     build with itself. The tests that read the line read its first
     (`engine/tests/engine.rs:189-193`, `engine/tests/fence.rs:41-50`).
     Today it says the version and the build id
     (`engine/src/main.rs:505-518`).

7. **Banda is promoted once a day.**
   - **When:** 05:17 Europe/Madrid, by a `schedule` with `timezone:`, before
     Roma's morning and off the top of the hour, where GitHub delays runs.
     A run at 07:17 is the same run again, for a first one late or dropped:
     it does nothing when Banda moved today.
   - **Which Dev:** the highest that is published, at least 12 hours old,
     above the line, past every hold (decision 9), with every file attested
     by a build of main: the newest Dev out by 17:17 the day before, which
     Banda Dev ran through the evening.
   - **No Stable that day** when none qualifies: the run ends green and
     says why. It ends red when something fails, when the `hold-stable`
     label is missing, or when Banda is two days late with no hold to say
     why.
   - **Promoting builds nothing.** The run reads the holds again; the
     release becomes `Banda 0.761.0`, marked Latest, and its text gains the
     PRs merged since the last Stable. Then the `banda` cask and the AUR's
     `banda-bin` take Banda's files from it. Each run first brings them up
     to Latest, so a promote that failed halfway is finished.
   - **Slowing down is one number**, `every`: Banda moves at most once in
     `every` days, to a Dev at least 12 hours plus `every - 1` days old.
   - Banda finds the Stable within the hour. ADR 0033's rule holds: a
     change that cannot migrate a Person's data is not merged, or it holds
     Banda until it can.

8. **Banda's files are built at the merge, not at the promote.** Both apps
   are packed in parallel jobs of one run, from one commit, toolchain and
   runner image, so the Dev waits about as long as for its own pack, and the
   bytes Banda installs come from the run Roma tried; a build at 05:17 would
   come from a later runner, and could fail. A release is complete when
   published, so GitHub's immutable releases fit (question 2), and promote
   now takes a minute. The cost: twice the packs per merge, on runners free
   for a public repository; releases twice the size, for a week (decision
   11); twice the Windows signatures (ADR 0090). If step 5 finds it too
   slow, Banda is built at the promote instead.

9. **A hold, and promote now.**
   - **To hold**, Roma or an agent opens an issue labelled `hold-stable`,
     naming the Dev that broke and how. While one is open, no Stable comes.
     Anyone may hold: it only delays Banda.
   - **A PR that fixes a regression merged since the last Stable** carries
     the label itself: it holds while open, and its merge ends the hold with
     the fix in, so a fix made in the 12 hours before the promote does not
     leave its bug in Banda.
   - **A hold ends at a commit**: the one that closed it (`Fixes #N`), or
     the labelled PR's own. A Dev passes it only when its commit contains
     that one, as git's ancestry says. N is never compared: it starts again
     at each major, and a commit inside a merge has none. When Roma closes
     a hold by hand, only a commit merged after passes. Agents never close
     or unlabel a hold by hand.
   - **Promote now** is `node scripts/promote.mjs [0.761.0]`, Roma's alone:
     that Dev or the newest, at once, past the 12 hours and past a hold,
     but never a withdrawn one, nor one at or below the line.

10. **A bad release.**
    - **Nothing goes back a version**, not the updater, a cask or a script.
    - **The line** for a Dev is the higher of the newest release and the
      `banda-dev` cask; for a Stable, of Latest and the `banda` cask. A cask
      moves only forward and keeps a withdrawn release's version. The
      publish and the promote read the line again just before they write.
    - **To withdraw**, Roma runs `node scripts/withdraw.mjs 0.761.0 "<why>"`.
      It lists, and on his yes deletes, that release and every one above it,
      which hold the same code, and keeps their tags. It opens a hold
      labelled `hold-stable` and `hold-dev`: until the fix ends it, no Dev
      is published either. A Banda Dev with it ready drops it at its next
      look.
    - **The fix comes forward**: a revert or a fix on main ends the hold and
      is the next Dev. A Banda Dev that cannot start is installed again.
    - **A bad Stable** goes the same way, then promote now. Latest should
      fall back to the Stable before (step 6 tries it). Until the fix,
      `brew install --cask banda` and `banda-bin` fail for new installs.
    - **No staged rollout** while Banda has one or two installs.

11. **Tags and releases.**
    - Only the publish makes a tag, by publishing a release. The
      `push: tags` trigger goes (`release.yml:21-22`), so a tag made by hand
      ships nothing. A pushed tag runs the workflows of the commit it
      names, and the `release.yml` of a commit from before step 2 still
      builds a Stable from it, starting on devbox; so devbox's
      `ci/job-started.sh` fails every job a pushed tag starts (step 2), and
      a tag on such a commit ships nothing either. A ruleset on `refs/tags/v*` forbids moving and
      deleting a tag, with no one let through; making one stays open.
    - **No tag is pruned**: about 11,000 a year, one line each in a clone's
      refs, and GitHub documents no limit. Agents' clones fetch without tags
      (`remote.origin.tagOpt --no-tags`).
    - **A Dev's release is deleted once it is 7 days old and below the last
      Stable**, unless it was a Stable (question 3): 30 a day of some 700 MB
      would be over 7 TB a year. Its tag stays.
    - The publish sends `make_latest: false`, then checks that Latest did
      not move; if it did, it puts it back and fails.

12. **Updates.** ADR 0041, 0045 and 0072 hold, with these changes.
    - **Each app has its own update source**, electron-updater's `custom`
      provider: the GitHub one takes only tags with the running version's
      word, and falls back from `dev-*.yml` to `latest-*.yml`, which would
      install Banda over Banda Dev.
    - **Banda Dev** reads GitHub's list of releases, which holds no bare
      tag, so a withdrawn release's kept tag is never seen; an hourly look
      needs no token. It takes the highest version above its own whose
      release has `dev-linux.yml` or `dev-mac.yml` (`dev.yml` on Windows,
      from `publish.channel: "dev"`), and only `banda-dev-<version>-…`.
    - **Banda** reads `/releases/latest`, refuses a prerelease or a title
      other than `Banda <version>`, reads `latest-linux.yml` or
      `latest-mac.yml`, and takes only `banda-<version>-…`. Its notes come
      from the release's text.
    - So a Stable is told from a Dev by GitHub's Latest mark, not a word in
      its tag. Neither app sets `allowDowngrade`, nor `autoUpdater.channel`,
      which turns it on (`AppUpdater.js:44`).
    - Both look a minute after the start, then hourly, and at once on
      "Update now" (ADR 0045). After three failed looks in a row, the
      popover says "Could not check for updates since …".
    - **On Linux**, as now, a new version downloads in the background and
      installs at quit or on Restart. The app keeps looking while one is
      ready, and a newer one replaces it. Quitting installs only what the
      last look, at most an hour old, still offered, so a withdrawn one is
      dropped, and never a version at or below the launcher entry's.
    - **On a Mac**, Banda Dev and Banda do the same through Homebrew
      (question 1): `brew update` and `brew fetch --cask` in the background;
      ready once `brew info --cask --json=v2` names a higher version; at
      quit or Restart, a helper that outlives it runs `brew upgrade --cask`
      on its own cask. Where brew is missing or fails, it shows the command,
      as now. The casks say `auto_updates true`, so a plain `brew upgrade`
      leaves the app to update itself.
    - **`BANDA_UPDATES=off`** turns updates off, for trials and CI.

13. **Who does what.** The build, the publish and the morning's run go by
    themselves. Roma alone promotes now, withdraws, edits
    `.github/release.toml` and closes a hold by hand. Agents may hold and
    label a regression's fix. They never start the publish, push a tag, run
    `git push --tags`, change a release, close a hold by hand, or re-run a
    release run from before step 5, which would publish the old way and
    prune tags. AGENTS.md says so.

**Today's installs move.** An installed Banda Dev at `0.1.0-dev.N` takes
only tags with the word `dev` (`GitHubProvider.js:52-88`), and `v0.750.0`
has none. So step 3 ships the new update source while versions are still
`0.1.0-dev.N`. Its own merge publishes a Dev like any other (the
workflow's token tags a commit that changes `release.yml` all the same, as
`v0.1.0-dev.390` and `v0.1.0-dev.400` show); that Dev, say
`0.1.0-dev.420`, is **the bridge**, which today's installs take as any Dev.
Step 4, the plain numbers, is merged once Roma's
Banda Devs on Linux and the Mac run the bridge; its first release, say
`0.750.0`, is above every `0.1.0-dev.N`. On a Mac, `brew upgrade` moves in
any case. A Banda Dev that missed the bridge is installed again. No Banda is
installed yet.

**Not done here:** a GitHub identity of their own for agents; signed update
files (electron-builder 27, in alpha); a fix to a Stable from a branch.

**Plan.** Each step is its own PR, and `scripts/check.sh` passes after each.

1. This ADR.
2. **The old Stable path closes**: the `push: tags` trigger goes
   (`release.yml:21-22`); devbox's `ci/job-started.sh` fails every job a
   pushed tag starts, so a tag on an older commit builds nothing; and
   `promote.mjs` refuses until step 6.
3. **The bridge**: each app's own update source (decision 12);
   `publish.channel: "dev"`, with `latest-*.yml` in `release.yml` (`:4`,
   `:142`, `:150`, `:190`, `:222`) renamed in the same PR, and the Mac's
   retry (`update.ts:312-316`) kept until step 5; hourly looks, also while
   a version is ready; the quit check; `BANDA_UPDATES=off`. Tried with three
   Devs (installed, ready, newer), on Linux and the Mac. A bridge that
   misbehaves is mended with a newer Dev, never by reverting
   `publish.channel: "dev"` or the `dev-*.yml` names: a Banda Dev that took
   the bridge reads only `dev-linux.yml`, and stops at the first release
   without it.
4. **Plain numbers**: `.github/release.toml`; the version from main's
   first-parent count, in one job, with its refusals; `BANDA_COMMIT` and
   `BANDA_DATE`, also in `docs/sharing.md`; `banda --version`'s first line
   and the contracts' numbers after it, with the tests that read it; the
   Mac's bundle numbers; Banda Local; the bar's label for a plain version,
   and the PRs' numbers in the popover's head (ADR 0072), mock first.
   Merged once Roma's Banda Devs run the bridge.
5. **Every release holds both apps**, in four PRs:
   - 5a. The build on GitHub's runners with a read-only token; the publish
     after `ci` and the build, one at a time, from one draft, above the
     line; the notes; the `banda-dev` cask from the release's files; no tag
     deleted, and old Devs' releases as decision 11 says. `release.mjs`
     pages past 100 releases and refuses a tag that has no release.
   - 5b. Banda's files, in pack jobs of their own, each app in its own
     output folder (`package.sh:35-42` and `release.yml:141`, `:184`,
     `:189` read one `dist/`).
   - 5c. The start checks, with the real update check.
   - 5d. The attestation, checked by the publish. Step 6 needs 5b and 5d.
6. **The daily Stable**: the schedule, its second run and `every`; which
   Dev; `hold-stable` and `hold-dev`, read on issues and PRs alike, ended by
   commit; `promote.mjs`; `withdraw.mjs`; the Stable's notes; the `banda`
   cask and `banda-bin`. In a scratch repository first: deleting Latest,
   promoting an immutable release, and a Banda updating from one Stable to
   the next, on Linux and through brew.
7. **A Mac's app updates itself, and the popover, mock first**: brew in the
   background and at quit; the casks' `auto_updates`; Banda's notes since
   its version; "Could not check for updates since …".
8. **Docs**: the README's "Install it" (Banda from `/releases/latest`,
   Banda Dev to test) and "Updates"; the tap's README; the workflows'
   comments; GLOSSARY; AGENTS.md (saying "in Banda Dev within the half
   hour", Dev and Stable, holds and a fix's label, tags, releases,
   `.github/release.toml` and MAJOR, `tagOpt`, no re-run of an old release
   run); the notes in the older ADRs.

Roma does these by hand: turn merge commits off, or require a linear
history in main's ruleset, before step 4, and keep that ruleset's bans on
force-pushes and deleting main, which N rests on; delete the draft
`v0.1.0-dev.241` left on 2026-11-05; run
`git fetch --prune --prune-tags origin` in his clones (his has 192 tags,
GitHub 20, and one `git push --tags` would keep them for good under the
ruleset); set the ruleset once step 5a deletes no tags; and turn on
immutable releases after the first Stable (question 2).

**Consequences.**

- Roma tests each merge in Banda Dev about half an hour after it, with
  nothing to fetch by hand. Banda follows 12 to 36 hours behind main, and
  stops while something is held.
- One number names a commit in both apps and in every release build of it,
  in a Problem, a note and the tap.
- N grows with every commit, about 100 a day, and most numbers never ship.
- Every merge packs twice per platform; releases are twice the size.
- About 11,000 tags a year stay for good; a Dev's release stays at least a
  week, a Stable's for good.
- A Dev that does not start, or cannot open the last release's Projects,
  does not go out, and no release is seen half-made.
- Nothing checks that Roma ran a Dev before it is promoted. A regression
  fixed without the label, in the 12 hours before the promote, reaches
  Banda for a day.

**Changes.** The notes go into the older ADRs with step 8.

- **ADR 0033:** decision 1's "from a checkout" is "from a checkout, a PR or
  a run by hand". Decision 2: the version is `MAJOR.N.PATCH`, N counting
  main's commits, with the commit and its date (decisions 5 and 6); the
  Cargo workspace's version no longer says it. Decision 3 is replaced by
  decisions 3 to 5 and 11 here, and decision 4 by 7 to 10, but for its last
  sentences, that Stable never loses a Person's data. Decision 5: built on
  GitHub's runners; "Banda reads the Stable releases, Banda Dev the
  prereleases" becomes "Banda reads the release marked Latest, Banda Dev
  every release". Decision 6: the apps update themselves through brew, and
  the Mac's files go in before the release is published.
- **ADR 0041:** decision 2: Banda looks hourly too; a Mac's app updates too,
  through brew; Banda Local never updates, by its channel; the app keeps
  looking while a version is ready, and quitting installs only what the
  last look offered. Decision 4: a Dev's notes are its PRs' titles, a
  Stable's its release's text. Decision 5's "Not now: macOS" goes; its
  setting for a Person is still to come.
- **ADR 0045:** "Update now" takes the newest Dev; on a Mac it runs brew.
- **ADR 0072:** decision 1's label `dev.104` and decision 5's head
  `dev.97 → dev.104` become plain versions, which `shortOf` already shows
  whole (`client/web/src/bar/updating.ts:57-61`). The head adds the PRs'
  numbers beside the version, in step 4's mock; the label does not.
  Decision 4's "A Banda that brew updated says nothing" goes. Decision 5's
  Dev note is a list of PR titles.
- **ADR 0090** (PR #690 takes these before it is accepted): Windows is a
  job of `release.yml` and takes its version, not a run number of its own;
  both apps' files go into the one draft; `dev.yml` and `latest.yml`; the
  file version `MAJOR.N.PATCH.0`; a withdrawn version is not installed;
  both apps are signed on every merge; winget takes Banda at the promote.
- **docs/sharing.md:** the commit and its date in every event.
- **GLOSSARY:** one entry for Banda, Banda Dev and Banda Local, with
  _Avoid_: Banda Daily, Banda Nightly, canary, "Banda Stable", "Dev build".
  Dev and Stable as releases, promote, hold and withdraw go in the README
  and AGENTS.md, as nothing a Person sees needs them.

**The three questions**, answered by Roma on 2026-11-08 with the
recommendations.

1. **Banda on a Mac updates itself through brew**, as Banda Dev does: the
   same code, installing when Banda quits, and a Person who installed with
   brew chose brew.
2. **Immutable releases**, turned on by Roma once step 6 has promoted the
   first Stable, so promoting is tried before it cannot be undone. A
   published release's files and tag then never change; it can still be
   deleted, and its title, text, prerelease flag and Latest mark changed.
   It needs decision 8.
3. **A Dev's release stays until it is 7 days old and below the last
   Stable**; a Stable's for good; tags always. That covers the 12 hours, a
   hold of some days, a slower `every`, and a week to compare.

**Weighed and not taken.**

- **One Dev a day, and a Stable a week old** (the first draft): Roma tests
  each merge at once.
- **A Stable with its own tag or word** (`v0.761.0-stable`): two names for
  one commit.
- **N as a count of releases**: the version is fixed when packed, before
  `ci` says whether it ships, so two builds would claim one number. **As the
  build's run number or a PR's number**: see decision 5. **As a date**: it
  overflows Windows' 16 bits. **As a count of all main's commits**, not
  only its first-parent line: a commit inside a merge would count, below
  commits merged before it.
- **The line from tags**: a stray tag, kept for good by the ruleset, would
  stop every release.
- **`releases.atom`**, which electron-updater reads: it lists bare tags
  too, so a withdrawn release's kept tag would be its newest entry.
- **One app with a channel switch**, as Claude Code has: it goes back a
  version over one data folder.
- **Pruning tags**: a tag deleted and made again is a moved tag. **Moving
  a cask back**: it takes a Mac back a version.
- **Promoting only a Dev that was downloaded**: the start checks and brew's
  fetch count as downloads too.
