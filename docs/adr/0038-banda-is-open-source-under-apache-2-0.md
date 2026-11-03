---
status: accepted
date: 2026-11-03
---

# Banda is open source under Apache-2.0

ADR 0033 made opening the source a step of its own (decision 10, step 4). Until it is done the repository `0x1oceanlabs/banda` is private, its releases install only with `gh release download`, and Banda cannot update itself (ADR 0033, decision 5).

What the repository holds, checked on 2026-11-02:

- **No secrets in its history.** gitleaks read all 526 commits on every branch and tag and found none.
- **No address but GitHub's.** Every commit is signed with an `…@users.noreply.github.com` address.
- **Little that is personal.** ADR 0016's HTML mock shows a masked `r•••@gmail.com`, and the tests write paths under `/home/roma`. Nothing names an IP address or a tailnet.
- **No large files.** None in the history is over 2 MB.
- **Others' code already carries its license.** The parts taken from T3 Code (MIT), Ghostty (MIT) and the Nerd Font keep their licenses beside them in `app/ghostty`.
- **Banda has no license.** `Cargo.toml` says `license = "UNLICENSED"`.
- **The dependencies allow Apache-2.0.** Every Rust crate and every npm package the window ships is MIT, Apache-2.0, BSD, ISC, Zlib, Unicode or Unlicense, or MPL-2.0. MPL-2.0 binds only the files it covers: `option-ext`, and Ghostery's ad blocker with its parts. Nothing is GPL.
- **The runners are on devbox.** `ci.yml` and `release.yml` run every PR on the self-hosted runners labelled `devbox` (`ci/README.md`). On a public repository anyone can open a PR from a fork. GitHub advises self-hosted runners only for private repositories for that reason: a fork's PR can run any code on the machine ([GitHub, self-hosted runner security](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners#self-hosted-runner-security)). A fork's PR gets a read-only token and no secrets, but the runners keep `target/`, cargo's registry and the pnpm store in their volumes between runs, and the next run would build on whatever it left there.
- **GitHub's runners are free on a public repository** ([GitHub, Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).

Roma, 2026-11-03:

- "Apache." (the license)
- No CLA and no DCO.
- The history stays as it is, with the ADRs, the research, the issues and the PRs.
- The research notes that name the old Banda's code stay too.

## Decision

1. **Banda is under the Apache License 2.0.** A permissive license brings people and companies in, and its patent grant protects whoever contributes and whoever uses Banda. `LICENSE` holds its text and `NOTICE` names Banda and the code it took from others. Every crate and package says `Apache-2.0`.

2. **A contribution comes in under the same license, with nothing to sign.** Apache-2.0's section 5 already says so. There is no CLA and no `Signed-off-by`. The price is that the license cannot be changed later without every contributor.

3. **The history opens as it is.** It has no secrets, and the ADRs, the research, the issues and the PRs, Roma's words in them too, are how Banda came to be. Nothing is rewritten.

4. **A fork's PR never runs on devbox.**
   - The runner refuses it. On a `pull_request` event GitHub runs the workflows from the PR's own merge, so a fork could write `runs-on: devbox` back into them. The runner image runs `ci/job-started.sh` before every job, and it fails a job whose PR or `workflow_run` comes from another repository.
   - The workflows route it. In `ci.yml`, a PR whose branch is in a fork runs every job on GitHub's `ubuntu-24.04`, where `ci/tools.sh` installs `ci/Dockerfile`'s Node and `package.json`'s pnpm, and runs the same `scripts/check.sh` parts. The required status `ci` is the same. `release.yml` packs a PR only from a branch of this repository.
   - A branch of this repository runs on devbox as now: Roma's, an agent's, Renovate's. Only people with write access push branches here.
   - Neither workflow uses `pull_request_target`, which runs with the repository's token and secrets.
   - In the repository's settings, every PR from someone outside waits for Roma's approval before its workflows run, so a fork's run costs no GitHub minutes until someone has looked at it.

5. **The repository says what it is to someone who did not build it.**
   - `README.md`: what Banda is, a picture, how to install it, what it needs (Claude Code or Codex, `npx`), and that Banda sends nothing anywhere.
   - `CONTRIBUTING.md` for people; `AGENTS.md` stays for agents.
   - `SECURITY.md`: how to report a vulnerability privately.
   - An issue template asking for the version, the distribution and the desktop.

6. **Roma opens it.** Before the switch the settings turn on secret scanning with push protection, Dependabot alerts and private vulnerability reporting, and the repository gets its description, topics, `banda.so` and a social preview. Then Roma changes its visibility in Settings. It cannot be undone in any way that matters: forks and clones exist from the first minute.

## Steps

1. **CI for a public repository**: the runners' hook, a fork's PR on GitHub's runners, `release.yml` only for this repository (decision 4). Roma rebuilds the runners' image on devbox (`ci/devbox.sh compose up -d --build`) for the hook to take effect.
2. **The license**: `LICENSE`, `NOTICE`, `Apache-2.0` in every crate and package, and a check in `check.sh` that every dependency's license is one that decision 1 allows (decision 1).
3. **The files for people**: the README, `CONTRIBUTING.md`, `SECURITY.md`, the issue template (decision 5).
4. **Opening**: Roma checks that the runners refuse a fork's job, sets the settings and changes the visibility (decision 6). Then ADR 0033's step 5 (updates on Linux) and the macOS Dev builds can start.

## Consequences

- Anyone can read, build, fork and ship Banda, under Apache-2.0's terms.
- A PR from outside costs devbox nothing. It is slower than one from here, as it builds cold on GitHub's runners every time.
- A change to how CI installs its tools is made twice: in `ci/Dockerfile` for devbox and in `ci/tools.sh` for GitHub's runners.
- What Roma decided and wrote in issues and ADRs is public from the switch on.
- Banda cannot later be relicensed, say as source-available, without every contributor's consent.
