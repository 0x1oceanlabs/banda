// Promote now (ADR 0092, decision 9): on Roma's word, a Dev becomes Banda
// at once. It comes with the daily Stable, in ADR 0092's step 6:
//
//   node scripts/promote.mjs [0.761.0]
//
// Until then it refuses, and pushes nothing. It used to push the tag
// v0.X.Y on a Dev's commit, which started the release workflow (ADR 0033,
// decision 4). That workflow no longer starts on a tag, and devbox fails
// a tag's jobs (ci/job-started.sh), so a tag pushed by hand ships nothing
// (ADR 0092, step 2).
console.error(`promote.mjs: no Stable is made yet, and no tag is pushed (ADR 0092, step 2).
Banda will be promoted from a Dev once a day, and this script will promote
one at once, with step 6 of
docs/adr/0092-every-merge-is-a-banda-dev-banda-is-promoted-from-it-once-a-day-and-one-number-names-both.md
Until then only Banda Dev ships, from every merge to main.`)
process.exit(1)
