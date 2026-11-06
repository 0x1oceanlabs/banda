---
status: proposed
date: 2026-11-06
---

# Banda runs on several machines, and Banda Cloud only connects them

_Draft. Roma liked the proposal on 2026-11-06 and chose Better Auth for
the sign-in (decision 7). The transport (decision 4) and where the
control plane runs (decision 9) are still open. Nothing here is built.
Research: docs/research/2026-11-06-banda-cloud.md._

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

4. **The transport is a port, and a route list picks one.** _Open._
   - `local` as today; `ssh`, which installs and starts the engine's
     service and forwards a port (as Zed and VS Code Remote do); `direct`,
     TLS over a LAN or a tailnet; `relay`, through Banda Cloud or one's
     own.
   - A client keeps an ordered list of routes for each host and takes the
     first that answers as that host (its key), as T3's do.
   - The proposal for `direct` and `relay` is **iroh**: Rust, dial by
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

13. **The CLI names its host**: `banda hosts add | list | use | pair`,
    `banda --host server …`, as kubectl's contexts. An Agent's `banda`
    goes to its own engine.

**Plan.** Each step its own PR; `scripts/check.sh` passes after each.

1. The engine as the machine's service (ADR 0062 decision 19, PR #460).
2. Keys, pairing, one PersonId; `hello` by signature.
3. The protocol's range of versions.
4. Spikes: iroh in the engine and in a browser; the SNI edge; Better
   Auth's OIDC provider and device grant.
5. Routes: `ssh` and `direct`; the client's route list.
6. One client over several hosts: the home host, the merged Inbox (ADR
   0062 decision 13).
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
