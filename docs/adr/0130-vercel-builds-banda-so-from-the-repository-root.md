---
status: accepted
date: 2026-11-13
---

# Vercel builds banda.so from the repository's root

ADR 0128, decision 4, gave the Vercel project `site/` as its root
directory, with `site/vercel.json`. Vercel builds every branch pushed to
the repository. A branch cut before `site/` existed has no such directory,
so its build failed ("The specified Root Directory "site" does not
exist") and marked the branch's PR red, on work that never touched the
site. Roma, on 2026-11-13 (translated): "Fix Vercel, it paints other
branches' PRs red."

**Decision.** This supersedes ADR 0128, decision 4, in where the config
lives; what it builds and when stays.

1. **The project's root directory is the repository's root**, and its
   config is `vercel.json` there. It installs only the site and what it
   takes from the workspace (`--filter @banda/site...`), builds
   `@banda/site`, and serves `site/dist`.
2. **It builds only when the site, `client/ui`, the tokens, the Mark's
   kit, the lockfile or `vercel.json` changed**; otherwise the build is
   skipped, and the PR's check passes. _ADR 0133, decision 2, narrows the
   list to the files the site reads._
3. **A branch without `vercel.json` is skipped.** The project's own
   setting, its "Ignored Build Step", is `exit 0`; a `vercel.json` in the
   branch overrides it. A branch cut before this ADR has nothing to build.
