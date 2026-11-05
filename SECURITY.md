# Security

Banda runs Agents that read and change files and run commands on your
computer, so a hole in it matters. Thank you for reporting one.

## Report a vulnerability

Report it privately on GitHub: the repository's **Security** tab, then
**Report a vulnerability**. Please do not open a public issue or PR for it.

Say what an attacker can do, and how: the steps, the version (the name of
the AppImage you run, or the commit), and your system. You will hear back
within a week. Once it is fixed and released, the advisory is published
with your name, unless you would rather it were not.

## What counts

- Banda letting an Agent, a web page or another program do what its Person
  did not allow: outside its Project, past a permission, into another
  Project's data.
- The engine's API or the window reachable by another user or another
  machine.
- A release that is not what this repository built.

The Agents' own models and their providers (Claude Code, Codex) are their
makers' to answer for; report those to them.

## Supported versions

Only the newest Banda and Banda Dev get fixes. There is no bounty.
