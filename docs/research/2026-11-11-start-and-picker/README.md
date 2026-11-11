# The start screen, the account picker and the model picker: mocks

Dated 2026-11-11. Evidence for
[ADR 0114](../../adr/0114-a-new-thread-says-whom-it-writes-to-and-where-and-the-message-box-says-who-and-how.md),
not a decision.

- `mocks/01-start-and-picker.html`: the first variants. The start screen
  as a phrase, a card, or the box in the middle. The Message box with one,
  two or three triggers. Drawn with the kit in `docs/design/kit/`.
- `mocks/02-chosen.html`: start screen A and Message box D2, as Roma chose
  them, with every state.
- `mocks/03-live.html`: one page with no kit, to click through. Roma looked
  at it in a Visual, as the Files preview cannot load the kit's CSS
  (issue #1503).
- `mocks/04-models.html`: `03` with the menu of models and "All models".
  Roma accepted it after three changes: the account button shows only its
  emblem, there is no search, and there are no keys or key hints.

Limits: the models, accounts and limits in the mocks are made up. Each
model in Banda has only an id, a name and a description
(`OptionChoice`): no family, price or context size. Whether Claude Code's
first three models are the ones the mock shows was not checked.
