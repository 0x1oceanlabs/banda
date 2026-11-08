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
banda = "~/.local/bin/banda-dev"  # optional; else this build's own (banda-dev) on that PATH
```

Set `banda`: ssh runs it with no login shell, and that PATH seldom has
`~/.local/bin`. `ssh` takes letters, digits and `. _ @ : [ ] / -`.
Banda reads the file as it starts: restart Banda after a change. A host
it cannot take is left out, and `window.log` says why.

## What that machine needs

- Banda, at the path `banda` names: best the same build as this one. An
  engine there that does not speak this window's protocol is refused.
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
program that took it first, and loses it as soon as either ssh ends; Banda tries again, waiting longer each time, up to a minute.
Quitting Banda ends both; the engine there runs on.

With Tailscale SSH in check mode, ssh waits for you to sign in at the link
Tailscale gives (`https://login.tailscale.com/…`); `window.log` has it.
Banda waits up to ten minutes.
