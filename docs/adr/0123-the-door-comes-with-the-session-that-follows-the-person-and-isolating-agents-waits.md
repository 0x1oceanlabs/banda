---
status: accepted
date: 2026-11-12
---

# The door comes with the session that follows the Person, and isolating Agents waits

Roma, on 2026-11-12 (translated): "yes, I agree, we split it". He agreed
to split the fence in two. This amends ADR 0083, decision 7.

**Where it stands.**

- ADR 0083, decision 7, puts the whole fence first: the fence (F0), one
  access rule (B14), the browser wall (F1) and hardened bookkeeping (F2)
  come before pairing (ADR 0081, step 2), and no listener leaves loopback
  before them. The `ssh` route opens no listener, so it came first.
- Earlier the same day Roma set the fence aside: isolating Agents is not
  the priority now, the architecture toward the App SDK is.
- Later the same day, [what we build](../what-we-build.md) put story 1
  first: the session follows the Person from the Mac to devbox, to the
  phone and to arc. A phone cannot run ssh, so it needs a way in from
  outside, which decision 7 holds back until the whole fence is done.

The fence guards against two different things, and only one of them stands
in story 1's way:

- **People and devices from outside.** A listener beyond loopback can be
  reached by them. Device keys, pairing, revocation and one access rule
  keep them out. This is the **door**.
- **An Agent on the machine itself.** An Agent runs with its Person's
  rights on that machine, with a listener or without one. Keeping it out
  of Banda's own state and inside a sandbox is **isolating Agents**: the
  rest of F0, the OS sandbox, containers and isolated Projects (ADR 0084).

## Decision

1. **Decision 7 of ADR 0083 splits in two.** No listener leaves loopback
   before the door. It no longer waits for isolating Agents.
2. **The door comes with story 1.** It holds device keys, pairing
   (ADR 0081, step 2), revocation and one access rule. Its own ADR, written
   for story 1's door slice, says exactly what of B14, F1 and F2 it needs
   and which route the phone and the web take (a tailnet with `direct` TLS,
   or a relay reached by an outbound connection).
   _Amended by [ADR 0124](0124-every-client-reaches-every-machine-by-one-road-at-its-door-by-its-own-key.md): every client reaches every machine at its door by its own key; the routes add the tailnet through `tailscale serve`, and the ssh route carries the door, not the owner._
3. **Isolating Agents waits, with no date.** The rest of F0, the OS
   sandbox, containers and isolated Projects come back when Roma puts them
   back in the order.
4. **The `ssh` route does not change.** It still opens no listener and
   gives no more than the ssh login gives.
   _Amended by [ADR 0124](0124-every-client-reaches-every-machine-by-one-road-at-its-door-by-its-own-key.md): every client reaches every machine at its door by its own key; the routes add the tailnet through `tailscale serve`, and the ssh route carries the door, not the owner._

## Consequences

- The roadmap's stage 3, "the fence, finished, then pairing", becomes the
  door slice inside story 1 ([the roadmap](../research/2026-11-08-roadmap-in-slices.md)).
- While Agents are not isolated, an Agent can do on its machine what its
  Person can, as it can today. The door adds no new way for it to act; it
  only lets the Person's own devices in.
- What ADR 0083 built stays: the stopgap, the browser wall, the Project's
  trust flag and the part of the fence already merged.
