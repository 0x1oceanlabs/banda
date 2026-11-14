---
status: accepted
date: 2026-11-14
---

# banda.so counts its visits with Vercel, and builds only from what it reads

_It amends ADR 0128 (decision 1) and ADR 0130 (decision 2). It keeps
[what we build](../what-we-build.md)'s "Not a SaaS with a central server",
as ADR 0128 does: the site stays files on a CDN, and what counts its visits
is Vercel's, not Banda's._

Roma, on 2026-11-14 (translated): "Let's add Vercel Analytics to our site,
and have it rebuild not on every PR, only when it concerns the site."

Vercel built a preview of banda.so on most PRs of the window. ADR 0130's
list of what the site is built of named all of `client/ui` and all of
`sdk/contract/src/generated/look`, and nearly every PR of the window
changes one of them. The site reads three files of them: `@banda/ui`'s
`theme.css`, the tokens it imports, and the Mark's kit. Its `site.css`
also had Tailwind read `client/ui/src/components` for the components a page
takes, and no page takes one.

**Decision.**

1. **The site counts its visits with Vercel Web Analytics**
   (`@vercel/analytics`, its Astro component in the one layout). It sets
   no cookie and keeps nothing that names a visitor; the script is
   Vercel's own, served from the site's host (`/_vercel/insights`). It is
   the one script a page ships without a `client:*` component (ADR 0128,
   decision 1). Web Analytics is switched on in the Vercel project.
2. **Vercel builds the site only when what it reads changed:** `site/`,
   `client/ui/src/styles/theme.css`,
   `sdk/contract/src/generated/look/tokens.css`,
   `docs/design/kit/mark.js`, the lockfile, `pnpm-workspace.yaml` or
   `vercel.json` (its `ignoreCommand`). CI's `site` part reads the same
   list, with its own workflow and `scripts/check.sh`.
3. **Tailwind reads no folder of `@banda/ui` for the site.** A page that
   takes a component of `@banda/ui` adds that folder as an `@source` in
   `site.css` and to the list above, in the same PR.

**Limits.** The list is by hand: a new import of the site from the
workspace has to be added to it, or a change there reaches banda.so only
with the next build. `ignoreCommand` compares a push's last commit with
the one before it, as before.
