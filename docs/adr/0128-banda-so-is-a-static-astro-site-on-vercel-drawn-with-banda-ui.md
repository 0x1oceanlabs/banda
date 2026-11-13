---
status: accepted
date: 2026-11-13
---

# banda.so is a static Astro site on Vercel, drawn with Banda UI

Banda had no site. ADR 0038 gave the repository `banda.so` as its link,
and ADR 0081 put the account at `auth.banda.so` and the control plane at
`api.banda.so`. Roma, on 2026-11-13 (translated): "We need a beautiful site
for Banda; the domain is banda.so. Astro or Next? It is an information
site. Authentication will be at auth.banda.so, and the web will be served
elsewhere too." Then: Astro, with shadcn/ui, on Vercel, at the latest
versions.

It serves "What Banda is not" in [what we build](../what-we-build.md): not
a SaaS with a central server. The site is files on a CDN; nothing of Banda
runs behind it, and no machine needs it.

**Decision.**

1. **The site is Astro, and static.** Each page is HTML at build; it ships
   no JavaScript unless it marks a component `client:*`. Next.js was
   weighed: its server parts (server components, actions, middleware,
   sessions) are what the site does not need, since the account and the
   web client live on other hosts. Astro builds on Vite, as the window
   does.
2. **It lives in `site/`, a package of the workspace** (`@banda/site`),
   not in `client/`: it is not a client of the engine, and it reads
   nothing of the contract but the look's tokens.
3. **It is drawn with Banda UI.** shadcn/ui is `@banda/ui`'s, the same
   preset (`base-nova`) and the same tokens, and its React components
   render through `@astrojs/react`. `site/components.json` sends a new
   shadcn component to `client/ui`, as the window's are, and the site's own
   blocks to `site/src/components`.
   - `@banda/ui/theme.css` is the theme without the window: the tokens
     (`@banda/contract/tokens.css`), shadcn on them, the type and the base.
     The window's `globals.css` takes it and adds what only the window
     needs: the glass, the Mark's loops, Markdown's and KaTeX's styles, and
     the window's sources.
   - The site follows the system's light or dark, by the `dark` class.
4. **Vercel serves it** from `site/` as its root directory
   (`site/vercel.json`). It installs only the site and what it takes from
   the workspace (`--filter @banda/site...`), with the repository's pnpm,
   and builds only when the site, `client/ui`, the tokens or the lockfile
   changed. A PR gets a preview; `main` is `banda.so`.
5. **Astro and its build tools are the site's devDependencies**, as they
   are not shipped in Banda: the license check (ADR 0038, decision 1)
   reads what Banda ships.

**Not decided here.** What the site says and how it looks: it is shown as
mocks first (AGENTS.md, "Show it first"). Until then `/` is a placeholder
with the thesis. Docs, the ADRs as pages, a changelog from the releases.
