# Other machines

Banda can reach the engine of another machine you reach over ssh, such as
a devbox, beside this one's (ADR 0081, decision 4: the `ssh` route). The
sidebar shows its Projects and Threads under its name, below this
machine's, and its state in words while it is not live. Away or stopped,
its rows stay as they were, dim, each with its own words, its timers
standing, and its label says once what they are as of: "away · as of
14:02", "stopped · as of 13:51". Its row, the bar's counts, a toast,
`Alt+U` and the Banda menu open its Thread on its engine: you read it
and write to it there, as to one of this machine's.
A toast for its Thread names it after the title, and its Allow, Reject and
Try again go to its engine too. While it is not live, they, the Thread
menu's rename, Later, wake, mark and archive, and what its Thread sends,
as Stop, an answer, Implement, Try again, Fork, Edit or a new model or
mode, say so at once in a toast, in the words of its pill and the act's
("arc is away: Stop was not sent."), and send nothing to run later. One
on its way as it goes says so too ("arc went away; Stop may have gone
through."), and is not sent again once it is back. Words the Banda menu
starts a new Thread on it with are refused the same way, and wait in
that Thread's composer for you to send.

A message to a started Thread waits for its machine (ADR 0105). While
that machine is away, stopped or on another build, Send reads "Send when back", its tooltip says until when ("Sends once arc is
back, until 14:42 ↵"), and Enter does the same. The message waits at the
end of the Thread, dim, as "Waits for arc · until 14:42", with Edit and
Cancel, and the pill counts it: "arc is away · 2 min · 1 waiting". It
waits 10 minutes from when you pressed Send: "until 14:42", or a right
click on the message, opens Keep for, which keeps it 10 min, 1 hour, 1
day or 7 days from then. Once the machine is live again it goes once, by
the ID it was given as it was queued, and nothing says so. Past its time
it is not sent: its words and images go back into the draft, above
anything new there, and a toast says so ("Not sent: arc was still away
at 14:42."). One on its way as the machine goes again may have gone
through ("arc went away; your message may have gone through.").

What waits is this device's, kept in its storage per machine for its
time, so it is still there after the window starts again: the row, and
what the Pane needs before arc answers, the Thread's title, its Project,
its Harness's name and the skills its composer offers; the pill then
says "arc is away · 1 waiting", with no minutes, as the window does not
know since when. One past its time while the window was closed comes
back into the draft as it starts, with the toast, and is kept until it
is; one whose machine is live goes at once. It is one queue for every
window on the device: a message sent from a Pane in a window of its own
counts in the main window's pill, and stays as that window closes. The
main window alone sends it, and gives it back to the window that shows
its Thread. A draft is kept the same way, a new Thread's too, whatever
its machine does (#838).

A machine whose link looks up but which answers nothing, as one asleep
before ssh notices or an engine that hangs, is away too (ADR 0082,
decision 11): the window pings its engine every 15 s, and two pings in a
row that hear nothing make it away, as does a connection its engine
never opens; an act after 5 s of quiet asks it first, and with no answer
in 3 s it is away and the act says so at once. Its label's tooltip says
"arc has not answered since 14:02", and its pill and its rows count from
then. Anything it says brings it back, and what it wrote meanwhile shows.
What would reach this machine's files waits for a later step: other
Panes for its Projects say "Not on <name> yet"; in its replies a path or
an image opens nothing, a code block has no Run, and a Visual shows only
its title.

## Moving a Thread to another machine

A Thread moves from two places. "Move to Project" on its card in the
sidebar lists this machine's other Projects, then each other machine's
under its name; "Move to Project…" in the Thread menu, a click on its
title in its Pane, opens Move Thread, which lists the Projects of every
machine this window reaches, the Thread's own machine first. A machine
that is away shows its name and no Projects. A Project of the Thread's
own machine takes it at once. One on another machine opens Move Thread
with it picked, which first says what goes (ADR 0116):

- **The Thread, whole**: its conversation, images and Visuals, its marks
  and its Later. Claude Code goes on there in the same session; another
  Harness, whose session stays on the old machine, starts one there and
  is handed the Thread's history.
- **The folder's work**, when both folders are the same git repository
  and the other one has nothing of its own to commit: the branch, its
  commits that were never pushed and the files changed and not
  committed, as a git snapshot, with no push. The other folder comes out
  on the same branch at the same commit, the changes not committed.
  Ignored files stay, as `.env` and `node_modules`.
- Where a folder is no git repository, or the other has none of the
  branch's commits, the Thread moves alone, and the dialog says the code
  stays.
- A folder there with changes that are not committed refuses the move:
  commit or stash them there first.

The box under it takes a message for the Agent on the other machine. It
is sent once the Thread arrived, so the work goes on there and this
machine may close. A Thread at work moves once its turn ends, while this
window is open.

The window carries it: it reads the Thread from its machine and writes it
to the other, and a toast says how far it is. Cancel there stops it
while nothing changed yet. Once the other machine unpacks, it goes
through; then the Thread's Pane shows it where it went, and its line
says where it came from. Both machines must be live, and run a Banda
that keeps a Thread the same way; one that does not says which to
update. A machine with none of the Thread's Harness refuses it.

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
own name and icon. Where no Banda is found, it runs this build's
`install.sh` there with `--check`, which takes nothing, and says what
Install would put there. `hostInstall` is Install: `install.sh` there,
its lines told as they come (`hostInstalling`), until
`hostInstallCancel`. `hostStop` is Stop Banda: that machine's own `banda stop`; the
host then shows stopped, and Banda starts nothing there until you start
it, or Banda here starts again, even when the host was away as you
stopped it.
`sshSuggestions` lists the Hosts of `~/.ssh/config`, with no pattern and
none already in the file.

## What that machine needs

- Banda, where Banda finds it or at the path `banda` names: best the
  same build as this one. An engine there that does not speak this
  window's protocol is refused. On a Linux or macOS machine with none,
  Add → Connect offers **Install Banda on <name>**, which does it: that
  machine downloads this window's version of the engine itself, checks
  it and puts it in its own data folder, no root asked, and from then on
  it updates itself (ADR 0119). By hand, it is the same script:
  `curl -fsSL https://github.com/0x1oceanlabs/banda/releases/download/v<version>/install.sh | sh -s -- <version>`.
- On Linux, its engine as a service that outlives your ssh session:
  `loginctl enable-linger $USER`, once. With "Start Banda at login" on
  there (`machine.toml`'s `start-at-login`, on by default), its unit is
  enabled, so with linger the engine starts as the machine boots, before
  anyone logs in: `systemctl --user is-enabled <folder>-engine` says
  `enabled` once Banda has run there. On a Mac, you logged in at its
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
power settings: it only reads `pmset -g batt`, sets nothing with
`pmset` and edits no `logind.conf`. A machine
that sleeps shows away on the others.

To see the hold: on a Mac, `pmset -g assertions` lists Banda's
`PreventUserIdleSystemSleep`, named "Banda: Agents work" or "Banda:
Plugged in"; on Linux, `systemd-inhibit --list` lists Banda's `idle` and
`sleep` locks, with the same why. An engine that lingers with nobody
logged in may be granted only `idle`, and its log says so once. Windows
holds none yet.

The engine also says its battery, and why it is kept awake now, in the
stream `machine.power`: the charge, whether it charges or is on power,
and the time left where the system knows it. It reads the battery each
minute while a window listens, and not at all while none does. A
machine with no battery says none, and Windows says no battery and no
why yet.

Another machine's window shows that battery while the machine is live,
in its row in Settings → Machines and in the card its label opens in
the sidebar, with why it is awake; a machine with no battery shows only
why, as Awake; away, it shows none. While Agents work there and it is on
battery at 20% or less, the window warns once with a toast, and again
only after it was on power: seen so, or back on battery over 25%,
charged while it was out of sight.

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
login shell. It opens Banda.app there hidden, with no window, so the
Mac's menu bar shows Banda's icon (step 7e). So Banda on another
machine sees the Mac's Projects and Agents, Banda's window open there
or not. With nobody logged in at the Mac's screen, as after a logout,
or while the Mac sleeps, the host shows "away" (its tooltip says which),
and Banda tries again each minute. Quit Banda at the Mac stops its
engine, and the host shows stopped until you start it here, or Banda
here starts again.

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
