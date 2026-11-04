<!-- Written by `cargo test -p banda-sharing` from modules/sharing/engine/src/events.rs: do not edit. -->

# What Banda sends

Banda sends nothing unless you turn it on, in the first run's question or in Settings → Sharing (ADR 0039). Then it sends these two events to PostHog in the US, and nothing else. Each is kept on your computer first, and Settings → Sharing → "Sent by Banda" shows its exact JSON. A Banda run from a checkout, CI and the tests never send, nor a run with `BANDA_SHARING=0`.

What never goes: a Thread's title or words, prompts, answers, paths, addresses, a Project's name, git, the time of day, your IP.

## Every event

| Field | What it is |
|---|---|
| `api_key` | Banda's PostHog project's token. It is public: with it anyone can send, no one can read. |
| `event` | The event's name. |
| `distinct_id` | The random ID, made when sharing turns on and erased when it all turns off. It is not you. |
| `properties.$process_person_profile` | Always `false`: PostHog keeps no profile of a person. |
| `properties.$geoip_disable` | Always `true`: PostHog derives no place from the address. |
| `properties.version` | Banda's version. |
| `properties.channel` | `stable` or `dev`. |
| `properties.os` | `linux`, `macos` or `windows`. |

## `$exception`

While **Send problem reports** is on: a Problem, once per fingerprint, version and day.

| Field | What it is |
|---|---|
| `properties.$exception_fingerprint` | What tells this Problem from another, from its kind, message and frames. |
| `properties.$exception_list` | What broke: its type, its message with paths and addresses taken out, and its frames, as Banda's own files and lines. |
| `properties.source` | Which part of Banda broke: `page`, `main`, `engine` or `crash`. |

An example:

```json
{
  "api_key": "phc_tf7tVXvPn4DyjtNhwGFYggUcKiyfS4ZWYbhgeBuCem7e",
  "distinct_id": "<a random ID>",
  "event": "$exception",
  "properties": {
    "$exception_fingerprint": "3124d1bf35ad",
    "$exception_list": [
      {
        "mechanism": {
          "handled": false,
          "synthetic": false
        },
        "stacktrace": {
          "frames": [
            {
              "filename": "app/web/src/browser/Tabs.tsx",
              "function": "Tabs",
              "in_app": true,
              "lineno": 41,
              "platform": "custom"
            }
          ],
          "type": "raw"
        },
        "type": "TypeError",
        "value": "Cannot read properties of undefined (reading 'tabs')"
      }
    ],
    "$geoip_disable": true,
    "$process_person_profile": false,
    "channel": "stable",
    "os": "linux",
    "source": "page",
    "version": "0.2.0"
  }
}
```

## `day`

While **Send usage counts** is on: once a day, the UTC day before, if it was on all that day and something was counted.

| Field | What it is |
|---|---|
| `timestamp` | That day's midnight, UTC: when it went says no time of day. |
| `properties.day` | The day it counts. |
| `properties.locale` | The system's language and the country in it, from your settings. |
| `properties.country` | The country in the locale. |
| `properties.threads` | The Threads started that day, by Harness. |
| `properties.turns` | The Turns started that day. |
| `properties.panes` | The Panes opened that day, by kind. |
| `properties.projects` | How many Projects there are. |
| `properties.workspaces` | How many workspaces hold a Pane. |

An example:

```json
{
  "api_key": "phc_tf7tVXvPn4DyjtNhwGFYggUcKiyfS4ZWYbhgeBuCem7e",
  "distinct_id": "<a random ID>",
  "event": "day",
  "properties": {
    "$geoip_disable": true,
    "$process_person_profile": false,
    "channel": "stable",
    "country": "DE",
    "day": "2026-11-03",
    "locale": "de_DE",
    "os": "linux",
    "panes": {
      "agents.thread": 6,
      "terminal.terminal": 3
    },
    "projects": 2,
    "threads": {
      "claude": 4,
      "codex": 1
    },
    "turns": 31,
    "version": "0.2.0",
    "workspaces": 3
  },
  "timestamp": "2026-11-03T00:00:00Z"
}
```
