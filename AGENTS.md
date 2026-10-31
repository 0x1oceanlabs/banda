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
