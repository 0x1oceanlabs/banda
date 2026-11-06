# Banda Cloud: tunnels, relays and sign-in

Research for ADR 0081, 2026-11-06. Roma asked how Banda Cloud can work,
how a relay works, what to build tunnels on, how T3 does it, and how to
sign people in.

## How T3 Code does it (T3 Connect)

Read in T3 Code's source (commit 337c5858, 2026-11-05):
`docs/internals/t3-connect.md`, `docs/internals/remote.md`,
`docs/internals/environment-auth.md`, `docs/operations/connect-setup.md`,
`infra/relay/README.md`.

- **Identity:** Clerk. A public OAuth app for the CLI with PKCE, and the
  device authorization grant for SSH and headless hosts (a beta Clerk
  turns on per account on request).
- **Relay:** a Cloudflare Worker with Postgres (PlanetScale through
  Hyperdrive), Durable Objects and Queues, deployed with Alchemy. It links
  environments to accounts, provisions managed tunnels, issues short-lived
  credentials, registers phones and sends APNs/FCM pushes and Live
  Activities, and forwards webhooks.
- **Tunnels:** Cloudflare Tunnel. `cloudflared`, pinned by version, runs
  on the host with an outbound connection; each environment gets
  `prod-<digest>.<zone>`. After the bootstrap, clients talk to the
  tunnel's hostname directly; the relay is not in the hot path.
- **The trust boundary:** "A relay token is never an environment login."
  The relay asks the environment to mint a one-time bootstrap bound to the
  client's DPoP key; the client trades it with the environment for an
  environment session the relay never sees. The environment issues and
  checks its own scoped sessions.
- **Other routes:** LAN pairing with a code, Tailscale (`tailscale serve`
  for HTTPS), SSH started by the desktop. A client keeps an ordered list of
  routes per environment and takes the first that answers as that
  environment.
- **Hosted web app:** it connects straight to each environment; the
  pairing secret travels in the URL's fragment, so the hosted origin never
  sees it.
- **Limits:** 3 machines free; a T3 Chat plan raises it to 10 or 100.
  Phones and browsers do not count.

What costs them:

- Cloudflare ends TLS at its edge, so it sees terminals, code and Threads
  in clear.
- Push payloads carry `threadTitle` and `projectTitle` in clear.
- Tunnels are billed while idle, so the relay runs a reaper, recovery and
  a pinned `cloudflared` swap.
- Two identity systems: Clerk for T3 Code, WorkOS for T3 Chat, linked by
  consent.

## Three kinds of relay

A host behind NAT cannot be dialled, but it can dial out. A relay is a
public server both sides dial; the host keeps a connection open ("I am X"),
a client asks for X, and the relay joins the two streams. What it sees
depends on where the encryption ends.

| Kind | Examples | What the relay sees | A plain browser |
|---|---|---|---|
| L7, TLS ends at the relay | Cloudflare Tunnel, ngrok, T3 Connect | everything | yes |
| L4, SNI passthrough, TLS to the host | Nabu Casa (SniTun), Plex `*.plex.direct` | the host's name | yes |
| Overlay, own keys, end to end, hole punching | Tailscale (DERP), iroh | ciphertext, and often nothing at all | through the relay only |

## Candidates for the tunnel

- **iroh** (n0): 1.0 released in 2026; dial by public key; QUIC with TLS;
  hole punching, after which the relay leaves the path; relays forward
  traffic they cannot decrypt; `iroh-relay` can be self-hosted. In a
  browser every connection goes through a relay, since a page cannot send
  UDP. https://iroh.computer/blog/the-road-to-iroh-1-0,
  https://docs.iroh.computer/concepts/holepunching,
  https://docs.iroh.computer/languages/wasm-browser
- **Tailscale:** good when the Person already has a tailnet. The embeddable
  Rust library `tailscale-rs` is a preview (April 2026) and refuses to run
  without `TS_RS_EXPERIMENT=this_is_unstable_software`.
  https://tailscale.com/blog/tailscale-rs-rust-tsnet-library-preview
- **Cloudflare Tunnel:** free and reliable, but sees the traffic; 1,000
  tunnels per account; platforms are told to queue API calls and clean up
  idle tunnels. https://developers.cloudflare.com/tunnel/features/tunnels-for-platforms/
- **SNI edge**, as Nabu Casa's SniTun: the edge reads only the TLS SNI and
  forwards the stream over the host's outbound connection; the certificate
  (Let's Encrypt) is on the host. SniTun does no user authentication;
  Home Assistant does. https://pypi.org/project/snitun/

## Sign-in

| Option | For | Against |
|---|---|---|
| Clerk | fast, SDKs for Electron and mobile | per-user price (50k MRU free after February 2026); device grant on request; lock-in |
| WorkOS AuthKit | free to 1M MAU; enterprise SSO later | someone else's; SSO $125 per connection |
| Better Auth at `auth.banda.so` | our service and database; OAuth 2.1/OIDC provider plugin, device authorization, passkeys; no per-user price; open source | security is ours; the provider plugin's maturity to check |
| Zitadel, Ory, Keycloak | mature OIDC servers | heavy to run for a small team |

Roma chose Better Auth on 2026-11-06.

Sources: https://better-auth.com/docs/plugins/oauth-provider,
https://clerk.com/articles/clerk-pricing-explained,
https://workos.com/blog/clerk-pricing,
https://skycloak.io/blog/open-source-authentication-comparison-2026/
