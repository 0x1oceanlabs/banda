# Other machines

Banda can reach the engine of another machine you reach over ssh, such as
a devbox, beside this one's (ADR 0081, decision 4: the `ssh` route). So
far the window only reaches it; the sidebar shows its Threads in a later
step.

## hosts.toml

`hosts.toml` sits in Banda's config folder, beside `agents.toml`: for
Banda Dev, `~/.config/banda-dev/` on Linux,
`~/Library/Application Support/banda-dev/` on macOS and
`%LOCALAPPDATA%\banda-dev\config\` on Windows.

```toml
[[hosts]]
name = "devbox"                   # lowercase letters, digits and -; not local or this
ssh = "devbox"                    # what you give ssh: a Host of ~/.ssh/config, or user@machine
banda = "~/.local/bin/banda-dev"  # optional; else this build's own, found there
```

With no `banda`, Banda looks there for this build's own, in this order:
`banda-dev` on the PATH ssh gives, which seldom has `~/.local/bin`; the
newest copy an AppImage keeps in `~/.local/share/banda-dev/engine/`
(`$XDG_DATA_HOME` moves it); `/Applications/Banda Dev.app` on macOS.
With none, the host is refused until you set `banda`, the whole path or
one from `~/`. `ssh` takes letters, digits and `. _ @ : [ ] / -`.
Banda reads the file as it starts: restart Banda after a change. A host
it cannot take is left out, and `window.log` says why.

## What that machine needs

- Banda, where Banda finds it or at the path `banda` names: best the
  same build as this one. An engine there that does not speak this
  window's protocol is refused.
- Its engine as a service that outlives your ssh session:
  `loginctl enable-linger $USER`, once.
- Claude Code, or your other Harnesses, signed in there: the Agents run
  there.
- An ssh that gets in with no question: a key, or Tailscale SSH.
- No `LocalForward`, `RemoteForward` or `DynamicForward` for that host in
  your ssh config. Banda refuses such a host, as it would have to drop its
  own forward with them.

## How it connects

Banda runs your system's ssh twice for each host: one runs
`banda start --with-parent` there, which starts its engine when it does
not run and says where it listens; the other forwards a port of this
machine's loopback to it. Neither takes your agent or X11. The page gets
the address once that ssh itself listens on the port, never another
program that took it first, and loses it as soon as either ssh ends;
Banda tries again, waiting longer each time, up to a minute. When
another program holds the port, the forward takes another.
Quitting Banda ends both; the engine there runs on.

An engine stopped there as asked stays stopped: Banda starts it again
only when the window asks. A refused host, as one with no Banda found
or one of another protocol, is tried again every ten minutes, and at
once when the window asks for it. Each line the other machine prints is
read up to 4 KiB.

With Tailscale SSH in check mode, ssh waits for you to sign in at the link
Tailscale gives (`https://login.tailscale.com/…`); `window.log` has it.
Banda waits up to ten minutes.
