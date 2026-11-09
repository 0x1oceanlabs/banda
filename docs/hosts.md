# Other machines

Banda can reach the engine of another machine you reach over ssh, such as
a devbox, beside this one's (ADR 0081, decision 4: the `ssh` route). The
sidebar shows its Projects and Threads under its name, below this
machine's, and its state in words while it is not live. Its row, the
bar's counts, a toast, `Alt+U` and the Banda menu open its Thread on its
engine: you read it and write to it there, as to one of this machine's.
What would reach this machine's files waits for a later step: other
Panes for its Projects say "Not on <name> yet"; in its replies a path or
an image opens nothing, a code block has no Run, and a Visual shows only
its title.

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
newest copy Banda keeps in its data folder there, as that machine's
`uname` says: `~/.local/share/banda-dev/engine/` on Linux
(`$XDG_DATA_HOME` moves it), `~/Library/Application Support/banda-dev/engine/`
on a Mac; `/Applications/Banda Dev.app` on a Mac.
With none, the host is refused until you set `banda`, the whole path or
one from `~/`. `ssh` takes letters, digits and `. _ @ : [ ] / -`.
A host Banda cannot take is left out, and `window.log` says why.

Banda applies the file as it changes, with no restart: a host added is
reached, one taken out has its ssh ended (its Projects stay there), and
one whose `ssh` or `banda` changed is reached again. A file that is not
TOML, as one saved half-written, leaves the hosts as they were.

The window changes the file through Banda's main process, never by
itself: `hostAdd` writes a `[[hosts]]` at its end, its `name` made from
the address when none is given, and `hostRemove` takes one out with the
comment just above it.
`hostSet` changes a host's `ssh` or `banda` in its own line, its comment
kept; an empty `banda` takes that line out.
`hostAdd` and `hostSet` refuse a machine the file reaches already, at that
address or another: `roma@arc` and `arc` are one machine.
Each keeps your other hosts and comments, writes the file whole, and
keeps a change you saved meanwhile. `hostTest` is Test connection, and
Add's Connect: it runs `uname`, `banda --version` and `banda status`
there, which starts nothing, and says the system there and the machine's
own name and icon. `hostStop` is Stop Banda: that machine's own `banda stop`; the
host then shows stopped, and Banda starts nothing there until you start
it, or Banda here starts again, even when the host was away as you
stopped it.
`sshSuggestions` lists the Hosts of `~/.ssh/config`, with no pattern and
none already in the file.

## What that machine needs

- Banda, where Banda finds it or at the path `banda` names: best the
  same build as this one. An engine there that does not speak this
  window's protocol is refused.
- On Linux, its engine as a service that outlives your ssh session:
  `loginctl enable-linger $USER`, once. On a Mac, you logged in at its
  screen; locked is fine (see below).
- Claude Code, or your other Harnesses, signed in there: the Agents run
  there.
- An ssh that gets in with no question: a key, or Tailscale SSH.
- No `LocalForward`, `RemoteForward` or `DynamicForward` for that host in
  your ssh config. Banda refuses such a host, as it would have to drop its
  own forward with them.

## What keeps a machine awake

While an Agent's Turn runs on a machine, in any Project, and for 10
minutes after the last one ends, its engine keeps it from idle sleep, so
the message you send next, from another machine, finds it awake. A Turn
that waits on your Question still runs. That is `awake-while-working` in
the machine's own `machine.toml`, on by default. `awake-plugged-in`, off
by default, keeps it from idle sleep whenever it is on power, Agents or
none, so other machines reach it; a machine with no battery is always on
power (ADR 0097).

Only idle sleep. The display still dims and sleeps, and your own Sleep,
a low battery and a closed lid still sleep the machine. A MacBook sleeps
as its lid closes, whatever any app holds, unless it runs closed with
power and a display. On Linux, logind's lid settings decide
(`HandleLidSwitch…`, and `LidSwitchIgnoreInhibited`, which is on by
default and passes over Banda's locks). Banda never changes the system's
power settings: it runs no `pmset` and edits no `logind.conf`. A machine
that sleeps shows away on the others.

To see the hold: on a Mac, `pmset -g assertions` lists Banda's
`PreventUserIdleSystemSleep`, named "Banda: Agents work" or "Banda:
Plugged in"; on Linux, `systemd-inhibit --list` lists Banda's `idle` and
`sleep` locks, with the same why. An engine that lingers with nobody
logged in may be granted only `idle`, and its log says so once. Windows
holds none yet.

## How it connects

Banda runs your system's ssh twice for each host: one runs
`banda start --with-parent` there, which starts its engine when it does
not run (on a Mac, while you are logged in at its screen) and says where
it listens; the other
forwards a port of this
machine's loopback to it. Neither takes your agent or X11. The page gets
the address once that ssh itself listens on the port, never another
program that took it first, and loses it as soon as either ssh ends;
Banda tries again, waiting longer each time, up to a minute. When
another program holds the port, the forward takes another.
Quitting Banda ends both; the engine there runs on.

An engine stopped there as asked stays stopped while Banda runs here:
Banda starts it again when the window asks, or as Banda here starts
again. A refused host, as one with no Banda found or one of another
protocol, is tried again every ten minutes, and at once when the window
asks for it. Each line the other machine prints is
read up to 4 KiB.

With Tailscale SSH in check mode, ssh waits for you to sign in at the link
Tailscale gives (`https://login.tailscale.com/…`); `window.log` has it.
Banda waits up to ten minutes.

## arc sees the Mac

A Mac's engine is a launchd job (ADR 0086, step 7a): it starts as the
Person logs in at the Mac, unless "Start Banda at login" is off there,
and Banda there starts it when it does not run. Banda on another machine
starts it too, over ssh, while the Person is logged in at the Mac's
screen, locked or not (step 7c): the engine runs in that session, with
the Person's sign-ins, as if started there, and takes its PATH from the
login shell. It does not open Banda.app there yet: from step 7e it
opens it hidden, with no window. So Banda on another machine sees the
Mac's Projects and Agents, Banda's window open there or not. With nobody
logged in at the Mac's screen, as after a logout, or while the Mac
sleeps, the host shows "away" (its tooltip says which), and Banda tries
again each minute. Quit Banda at the Mac stops its engine, and the host
shows stopped until you start it here, or Banda here starts again.

Here arc is a Linux machine, and m1pro a Mac on the same tailnet, at
`100.79.149.28`. On the Mac:

1. Banda Dev in `/Applications/Banda Dev.app`, as new as arc's: what
   starts the engine over ssh is the Mac's Banda, not arc's. One from
   before step 7c starts none while Banda is closed there, and the host
   is away; one from before 2026-11-08 starts an engine of its own over
   ssh, which stops as the link drops. Opened once, so its copy of
   `banda` is in place, and Claude Code signed in: the Agents run there.
2. System Settings → General → Sharing → Remote Login: on. Its ⓘ:
   Allow access for only your user, and leave "Allow full disk access
   for remote users" off, as Banda reads only its own folder there.
3. arc's public key in the Mac's `~/.ssh/authorized_keys`. From arc,
   while the Mac still takes a password (`whoami` on the Mac says its
   user):

   ```sh
   ssh-copy-id <the Mac user>@100.79.149.28
   ssh -o BatchMode=yes <the Mac user>@100.79.149.28 true
   ```

   The second gets in with no question and says nothing: the key works.
   Turn passwords off only once it does: with no key that works, no one
   gets in over ssh.

4. Password login off, in a file of its own:

   ```sh
   printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' |
     sudo tee /etc/ssh/sshd_config.d/010-keys-only.conf
   sudo sshd -T | grep -Ei '^(passwordauthentication|kbdinteractiveauthentication) '
   ```

   Both say `no`. sshd takes the first value it reads, and reads that
   folder in name order, so `010-` comes before macOS's own `100-macos.conf`.
   It holds for the next connection. macOS's sshd listens on every
   network the Mac is on, the LAN and a café's Wi-Fi too, not only the
   tailnet: launchd holds port 22 for it, so `ListenAddress` changes
   nothing. With passwords off, only a key you put there gets in.

5. Optional: ssh to the Mac only over Tailscale. One more line in the
   same file:

   ```sh
   echo 'AllowUsers <the Mac user>@100.64.0.0/10' |
     sudo tee -a /etc/ssh/sshd_config.d/010-keys-only.conf
   sudo sshd -T | grep -i '^allowusers '
   ```

   `100.64.0.0/10` holds every tailnet address; arc's own
   (`tailscale ip -4` on arc) lets in arc alone. After it, only that
   user gets in, only from the tailnet: not from the LAN, key or not.
   Then the check of step 3 again, from arc.

On arc:

1. In `~/.ssh/config`:

   ```
   Host m1pro
     HostName 100.79.149.28
     User <the Mac user>
   ```

2. `ssh m1pro true` once by hand: it gets in with no question, and
   takes the Mac's host key if ssh has not seen it yet. Banda's ssh asks
   nothing, so it would refuse a host key it has not seen.
3. In `~/.config/banda-dev/hosts.toml`; Banda reaches it at once:

   ```toml
   [[hosts]]
   name = "m1pro"
   ssh = "m1pro"
   ```

No `banda` is needed: Banda finds the Mac's own, in its Application
Support or its app.
