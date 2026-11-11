# Omarchy's themes, as test fixtures

Each file is one of Omarchy's own themes' `colors.toml`, copied unchanged
and named after its theme: `themes/<name>/colors.toml` in Omarchy 4.5.0
(Arch's `omarchy` 4.5.0-3), from https://github.com/omacom/omarchy.
`osaka-jade` is left out: that release has no `colors.toml` for it.

`tests/omarchy.rs` checks that each reads, solid and over glass, once
the resolver has kept it readable (ADR 0100, decision 8).
`client/desktop/e2e/themes.spec.ts` shows the `omarchy` theme in two of
them: tokyo-night dark, catppuccin-latte light (ADR 0100, decision 4).
Banda does not ship them.

They are MIT, `LICENSE-OMARCHY` here: Copyright (c) David Heinemeier
Hansson.
