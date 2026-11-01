## Design principles

UNIX composition + deep modules + explicit contracts.

- Small interfaces hide substantial complexity.
- Contracts define ownership, permissions, outcomes and failures, not just
  data formats.
- Splitting code into more packages does not, by itself, make the design
  modular.
- Complexity is added only on a user's request or with a new module.

## Before you change things

- The words: [`GLOSSARY.md`](GLOSSARY.md). Use its terms exactly.
- The shape: [`docs/architecture.md`](docs/architecture.md).
- The decisions: [`docs/adr/`](docs/adr/). A change that contradicts an ADR
  needs a new ADR first.

## Workflow

One change, one branch, one PR. Nothing is pushed straight to `main`.

Each branch has its own worktree in `../banda-worktrees/<slug>`, never
loose beside the main checkout:
`git worktree add -b <kind>/<slug> ../banda-worktrees/<slug> origin/main`.
Remove it once its PR is merged.

Before a PR, run `scripts/check.sh --no-window`. CI runs every part,
the window's end-to-end tests too, on runners on devbox
([`ci/README.md`](ci/README.md)); the `ci` status sums them up. Merge with
`gh pr merge --auto --rebase` and go on: the PR merges itself once `ci` is
green. A red `ci` is yours to fix, on the PR or, after a merge, on `main`.

## Research

`docs/research/` keeps dated evidence with its source and limits. It is
not a decision; ADRs are.
