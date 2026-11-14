# Bytes

`platform/bytes`: the engine serves a file's bytes to a Pane by a token,
from the machine that has the file (ADR 0106, decision 6).
[The architecture](../../docs/architecture.md#modules) is the map this
page is one part of. A change to this part changes this page in the same
PR.

## What it does

The bytes behind those URLs are the engine's (`platform/bytes`; ADR
0106, decision 6). A Pane asks the engine of its session for a token,
`bytes.issue {path, use}`, with the right and the reach `files.read`
asks, and one function in `@banda/ui/hooks/use-file-url` makes the URL
that names it: `app://files/<token>`, or `app://preview/<token>` for a
page. Main relays those two hosts to the engine's `GET /b/<token>` and
`GET /p/<token>` (`relay` in `@banda/desktop-kit`), passing on only the
range and what tells a frame's navigation from a page's fetch, and
gives back the engine's answer as it came: main reads no file and finds
no Project's folder (`client/desktop/src/architecture.test.ts` holds it
to that). A token serves the one file it was given for, by its real
path, device and inode, through no link, for an hour or until the
engine restarts; `useFileUrl` keeps the Pane's path, never the URL, and
asks again before the hour ends and once the engine's boot changes.
Byte ranges let players seek without reading the whole file. The engine
serves any file, typed by its extension: text as plain text, so an HTML
file never runs, and what it does not know as bytes, each never sniffed
and sandboxed. No frame shows the byte host. The page reads its ranges
with `fetch`, as a PDF is read: the `app` scheme allows CORS, the engine
answers any origin, and the page's `connect-src` names the host.

Main also relays `app://files/<machine>/<token>` and
`app://preview/<machine>/<token>` to the engine of the machine they
name, `<machine>` being this device's name for it in `hosts.toml`,
through its forward as it listens now, so a link goes on working when
ssh comes back on a new port (`client/desktop/src/bytes.ts`). Such a
request waits while its machine is away, as a read may, and goes once
it is back; it never has a refused machine tried again, which only the
Person opening it does. The page knows which machine each session is:
`KeptHosts` hands each host's engine to `relayBytesFrom` with its name
as it makes it, and `bytesUrl` puts that name in the URL, which is never
kept (ADR 0106, law 2). So Files' previewers, Quick Look and a Thread's
media draw another machine's files from that machine. "Save a copy to
this Mac" is the window's `file.save-copy`, on a row of another
machine's in Files: the file's session gives the token, and the device's
`save_file` (`files.save` on the bridge) shows the system's save
dialog, then fetches the bytes by that URL and writes them whole where
the Person picked. It goes now or says why not, so a machine that is
away is told at once.

A page among the Person's files, HTML or an SVG document, is shown by
the sandbox host, `app://preview` (ADR 0073, decision 5), by a token
given for a page. The engine answers a frame's navigation only, never a
page's fetch nor a picture (Electron's handler hears no `Sec-Fetch-*`,
so a navigation is what asks to be upgraded and names no origin), and
its response sandboxes the page whatever the frame says: `sandbox
allow-scripts`, never `allow-same-origin`, with `default-src 'none'`,
pictures inline or from the byte host, inline styles and scripts. The
page's `frame-src` names it beside the modules' hosts.
