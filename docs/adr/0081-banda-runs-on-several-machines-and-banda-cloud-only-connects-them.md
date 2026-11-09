---
status: accepted
date: 2026-11-06
---

# Banda runs on several machines, and Banda Cloud only connects them

_Accepted as v1 by Roma on 2026-11-06, with Better Auth for the sign-in
(decision 7) and iroh for the transport (decision 4). One question stays
open and is marked so: where the control plane runs (decision 9). Nothing here
is built. Research: docs/research/2026-11-06-banda-cloud.md._

ADR 0062 makes Banda a kernel, a platform and Apps, with the host where
the work is and clients that only show it (decision 3), one client over
several hosts and the arrangement on the Person's home host (decision 13).
It left several machines to an ADR of its own. ADR 0001 decision 9 set
the rule: the engine always checks rights itself, an identity provider
only says who someone is, and a relay only connects and never signs
anyone in.

What stands in the way today:

- The engine listens on `127.0.0.1` only (`engine/src/places.rs`).
- Each machine has its own owner (`owner.json`), and a client gets in with
  a secret that lives as long as the engine (`OwnerSecret`).
- `hello` refuses any protocol but its own (`PROTOCOL = 1`, matched
  exactly).
- Who calls the Person is worked out in the window (ADR 0056), so nothing
  calls while the window is closed.
- The window's road goes to the window that asked last (ADR 0029).
- The engine is the window's child (`serve --with-parent`); ADR 0062
  decision 19 takes PR #460 for that.

**Decision.**

1. **Every record has one writer.** A Project's records are its host's;
   the Person's (the arrangement, themes, which display takes which) are
   the home host's; the view is each device's. Banda Cloud adds no second
   writer: it connects, delivers pushes, keeps backups, or is a host
   itself. So there is nothing to merge, and no CRDT.
   _Amended 2026-11-09 by
   [ADR 0101](0101-machines-are-peers-and-there-is-no-home-host.md):
   machines are peers, and there is no home host. One writer still holds for
   a Project (its machine), a machine's files and the view. The Person's
   shared files are a full copy on every machine, copied whole later, last
   edit wins, the other kept beside; still no CRDT. The arrangement is the
   machine's whose window shows it._

2. **One Person across hosts, by keys.** Each host and each device has an
   Ed25519 key. Pairing joins a device or a host to the Person: a code or
   a QR on the host, or by itself over SSH. A host paired in takes the
   same PersonId, so the Inboxes join. `hello` signs a challenge in place
   of the secret; the kernel's `Identity` port already allows it. No
   account is needed.

3. **The engine signs its own sessions; a cloud token never opens it.**
   A Banda Cloud account only finds the Person's hosts and brokers a
   pairing: the cloud asks the host to mint a one-time bootstrap bound to
   the new device's key (DPoP), and the device trades it with the host
   itself for the host's session, which the cloud never sees (as T3
   Connect does). Sessions carry scopes, and a trade can narrow them,
   never widen them.

4. **The transport is a port, and a route list picks one.**
   - `local` as today; `ssh`, which installs and starts the engine's
     service and forwards a port (as Zed and VS Code Remote do); `direct`,
     TLS over a LAN or a tailnet; `relay`, through Banda Cloud or one's
     own.
   - A client keeps an ordered list of routes for each host and takes the
     first that answers as that host (its key), as T3's do.
   - `direct` and `relay` are **iroh** (Roma, 2026-11-06): Rust, dial by
     public key (the host's key of decision 2 is its address), QUIC with
     TLS end to end, hole punching so most traffic goes direct, and a
     relay anyone can run (`iroh-relay`). Cloudflare Tunnel is not taken
     for data: it ends TLS at its edge and sees every byte.
   - A browser cannot send UDP, so a browser either speaks iroh in
     WebAssembly through the relay, or reaches an SNI edge
     (`https://<host>.banda.host`) that passes the TLS stream, unopened,
     into the host's iroh connection, with the certificate on the host (as
     Nabu Casa's SniTun and Plex's `plex.direct` do). A spike picks one.
   - A tailnet the Person already has is a `direct` route; Banda does not
     embed Tailscale (`tailscale-rs` is a preview).

5. **Devices say what they are and where the Person is.** A client
   registers on connecting: its kind (desktop, web, phone), its device
   capabilities (notify, sound, clipboard, a browser, a file picker), and
   whether it is in front, awake or away. The window's road (ADR 0029)
   goes to a named device or to where the Person is; with the Person
   nowhere, it becomes a call and a push.

6. **Who calls the Person is worked out on the host.** Each App's calls
   become a projection on its host (the notice is data already, ADR 0056
   decision 2). A host streams its Person's Inbox; a client merges the
   streams of every host. With no device present, the host pushes: Web
   Push straight from the host (a PWA on iOS 16.4 and later too), or,
   for a native app, through Banda Cloud's push gateway, which holds the
   APNs and FCM keys. The payload is sealed to the device's key; the
   gateway sees a blob (T3's carries the Thread's title in clear).

7. **The account is Banda's own, at `auth.banda.so`, on Better Auth**
   (Roma, 2026-11-06). An OIDC issuer through its OAuth 2.1 provider
   plugin, passkeys, and the device authorization grant for `banda login`
   over SSH; PKCE on the desktop. The engine speaks plain OIDC, so a
   company's own provider works the same, and the vendor behind
   `auth.banda.so` could change without the engine knowing. One account
   from the start (T3 links Clerk to T3 Chat's WorkOS by consent).

8. **Versions are agreed, not matched.** `hello` carries a range of
   protocol versions and the host picks; each App's manifest names its API
   version; a client works with the host one version behind. A client
   shows an older host and offers its update (ADR 0072).

9. **Banda Cloud is services, each a choice, and each can be one's own.**

   | Service | What it gives | Without it |
   |---|---|---|
   | `auth.banda.so` | one account, a new device finds its hosts | pairing by hand |
   | `api.banda.so` | the list of hosts and devices, the pairing broker, push registrations, billing | QR pairing |
   | relay, in regions | reach from any network, end to end | SSH, a tailnet |
   | push gateway | a native phone app in a pocket | Web Push, ntfy |
   | the Person's home | the arrangement while every host sleeps | the home host |
   | backup and moves | the log of a Project, sealed, in object storage; a Project moved between hosts on command | git and a copy |
   | hosts | Agents on day and night with no server of one's own | one's own server |
   | webhooks | a stable address that forwards to a host | none |

   _Amended 2026-11-09 by
   [ADR 0101](0101-machines-are-peers-and-there-is-no-home-host.md): "the
   Person's home" row goes. A host in Banda Cloud is one more peer, up more:
   it keeps a copy of the shared files and may pass copies on while the
   others sleep. Without it, each machine's own copy is used._

   _Open:_ the control plane (`api.banda.so`) on Cloudflare Workers and
   Durable Objects (as T3's relay is) or as a Rust service on the relay's
   VMs.

10. **A host in the cloud is one VM per Person, running the same `banda
    serve`.** No multi-tenant engine: the walls and passes assume one
    machine, one owner. The Person signs in to their Harness on that VM,
    so Banda keeps no provider's credentials (ADR 0001 decision 9); the
    operator of the VM could reach them, and Banda says so.

11. **A Project lives on one host and moves on command.** Its code moves
    through git, its uncommitted work as a patch, its log as a copy. No
    two hosts write one Project.

12. **Each settings file says whose it is**: the host's
    (`harnesses.toml`, accounts, MCP servers, the Agents' browser), the
    Person's (themes, `keys.toml`, `sidebar.toml`, the Flow, `[notify]`),
    or a device's (its theme, zoom, the Person's own browser).
    `browser.toml` and `agents.toml` are cut in two.
    _Amended 2026-11-08 by [ADR 0095](0095-a-machine-names-itself-a-name-and-an-icon-and-no-colour.md),
    decision 2: the host's `machine.toml` gives its name and icon;
    `hosts.toml` is a device's, and its `name` is that device's key for an
    ssh entry, not the name a window shows._
    _Amended 2026-11-08 by [ADR 0096](0096-seen-and-archive-are-thread-data-on-its-host.md):
    the Person's files do not hold seen marks, as ADR 0082 had them; seen
    and archive are the Thread's, in its Project on its host._
    _Amended 2026-11-09 by
    [ADR 0101](0101-machines-are-peers-and-there-is-no-home-host.md),
    decision 3: each file, or part of one, is shared (a copy on every
    machine: the sidebar, `[notify]`, the Flow, the Person's theme folders,
    the keys' binds), the device's (which theme, mode, glass, columns, bar,
    zoom, `mod`, `hosts.toml`, `terminal.toml`) or the machine's
    (`machine.toml`, `harnesses.toml`, `agents.toml [start]`,
    `sharing.toml`, the Agents' browser, Files' pinned places, read and
    written through its engine)._

13. **The CLI names its host**: `banda hosts add | list | use | pair`,
    `banda --host server …`, as kubectl's contexts. An Agent's `banda`
    goes to its own engine.

14. **Banda Cloud runs on a few plain VMs, with no Kubernetes.**

    | What | Where | How many at first |
    |---|---|---|
    | relays (`iroh-relay`, with the SNI edge if chosen) | Hetzner: cheap, traffic included, Germany, Finland, the US and Singapore | two, Europe and the US (iroh's advice: two regions at least) |
    | `auth` and `api`, the push gateway | a Hetzner VM; Postgres managed (Neon or PlanetScale), so its backups are not ours to run | one |
    | backups | Cloudflare R2, which charges nothing to read out | a bucket |
    | hosts in the cloud | Fly.io Machines: made and removed by API, billed by the second, suspended while the Agents are idle | one per Person who buys one |

    - A relay holds up to 60,000 connections and keeps no state; each host
      and each open device holds one. Two small VMs carry thousands of
      Persons; most traffic goes direct, but a browser's always crosses
      the relay. Growth adds a relay in Singapore, a second in each region,
      a second `api`.
    - No AWS or GCP for the relays (they charge for traffic out, which is
      all a relay does), and no Workers (no long-lived UDP server).
    - Deployed by OpenTofu (the VMs, DNS) and Kamal or systemd (the
      services), from `infra/` in this repository, so anyone can run their
      own Banda Cloud the same way.
    - n0's public relays serve development only: rate-limited, no SLA.
    - Hetzner's prices rose in 2026 and some of its plans were not on sale
      in the autumn; check before buying.

15. **What Banda Cloud runs, a company can run too** (Roma, 2026-11-06).
    Banda needs no Kubernetes for itself, but what it writes must run in
    one, as companies' platform teams expect a Helm chart. The heavy part,
    the engine and the work, already runs on the company's machines, so a
    company deploys little: `api`, perhaps a relay (most have a VPN
    already), perhaps push; its own IdP takes the place of `auth`.
    From the first day:
    - **Every service is a container** (relay, `auth`, `api`, push),
      configured by env and one file, with Postgres its only state. One
      image runs under Kamal on Banda's VMs, under docker compose for a
      small team, and from a Helm chart in a bank.
    - **Where a host is made is a port**: Fly Machines for Banda Cloud,
      Kubernetes pods or Terraform for a company (as Coder makes its
      workspaces). Fly is not written in.
    - **Sign-in is OIDC only**: Better Auth for Banda's own, the company's
      Okta or Entra ID in its place. The engine sees no difference.
    - **`api` knows organisations** from the start, not only Persons
      (Better Auth's organisation and SSO plugins, their maturity to
      check).
    - **The region is a setting**: where `api` and the backups live, so a
      European customer gets a European stack.

    Later, in an ADR of its own: SAML and SCIM, roles and teams (ADR 0001's
    teams), the audit log out to a SIEM (the append-only log helps),
    managed policies (which Harnesses, MCP servers and sites, the Agents'
    ceilings), models through the company's gateway (a Harness's setting),
    offline updates, SOC 2, keys of the company's own. The ways to sell
    it: SaaS, a dedicated stack Banda runs, self-hosted, or BYOC.

**Plan.** Each step its own PR; `scripts/check.sh` passes after each.

1. The engine as the machine's service (ADR 0062 decision 19, PR #460).
2. Keys, pairing, one PersonId; `hello` by signature.
3. The protocol's range of versions.
4. Spikes: iroh in the engine and in a browser; the SNI edge; Better
   Auth's OIDC provider and device grant.
5. Routes: `ssh` and `direct`; the client's route list.
   _Amended 2026-11-08 (Roma): `ssh` comes first, alone, before step 2.
   The window's main runs the system's ssh twice for each host in
   `hosts.toml`: one follows `banda start --with-parent` there, one
   forwards a loopback port to its engine, and the page gets that address
   (`client/desktop/src/hosts.ts`, `docs/hosts.md`). It installs nothing
   yet: that machine has the same build. It opens no listener beyond
   loopback and gives no more than the ssh login gives, so it does not
   wait for the fence (ADR 0083, decision 7)._
6. One client over several hosts: the home host, the merged Inbox (ADR
   0062 decision 13).
   _Amended 2026-11-09 by
   [ADR 0101](0101-machines-are-peers-and-there-is-no-home-host.md): one
   client over several machines, the merged Inbox. Copying the shared files
   is that ADR's E5._
7. Calls on the host, the devices' register, the road to a device.
8. The web client, served by the host, as a PWA with Web Push.
9. Banda Cloud, a service at a time: `auth` and `api`, the relay, push,
   backup and moves, hosts.

**Consequences.**

- Banda works across machines with no account and no cloud; the cloud
  makes it easier, never possible.
- The relay and the push gateway see only ciphertext, so a breach of
  Banda Cloud leaks who connects to what, not the work.
- The engine gains a listener beyond loopback, so its sessions, scopes and
  key checks become the wall that matters.
