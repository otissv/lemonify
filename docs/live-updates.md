# Live updates

Tabs of the same account stay in step. When one tab saves, undoes, redoes, renames, deletes, reorders or adds a document, or an AI job, result, workflow or the person's key bindings change, every other tab of that person updates without a reload. The same holds for changes made with the command line, or by any other process that runs Lemonify's core.

## How it works

The website holds a WebSocket server of its own, next to the web server, on `LEMONIFY_REALTIME_PORT` (default the website's `PORT` plus one, so 5174, bound to `LEMONIFY_REALTIME_HOST`, default `127.0.0.1`). TanStack Start's production output is a plain request handler that cannot host WebSockets, so the listener is a separate `http.Server` started with the web runtime. The command line never listens: it sends its changes to the web server, which tells the tabs (see below). The browser is told where to connect by `LEMONIFY_REALTIME_URL`; unset, it is `ws://<site host>:<port>/realtime`, or `wss` when the site is `https`.

Events carry only ids and revisions, never content. A tab that hears "document X is now at revision N" reads the document through the usual authorised server functions, so the realtime channel cannot leak data the person could not already read. The hub routes an event only to connections of the user it concerns.

The channel also carries nothing from the browser: the server accepts no messages and closes a connection that sends one. This keeps the transport ready for collaboration (several people, presence, comments) without becoming a second write path with its own rules.

## Changes made by other processes

Every process other than the web server (each CLI command and each job worker) sends what changed to the web server through a local socket, `run/lemonify.sock` in the data folder (`LEMONIFY_DATA_DIR`), and the web server passes each change to the person's tabs as if it had made it. Each change is one line of JSON, `{"v":1,"type":"change","userId":…,"event":…}`, where `event` is the same event the tabs are sent, so it too carries only ids and revisions. The same socket carries `{"v":1,"type":"queued","pools":[…]}` when a process queued jobs, so the web server's workers start on them at once ([architecture](architecture.md)). The web server checks every line against that schema and logs and drops one that fails it; a line longer than 16 KiB closes the connection. A heartbeat is the web server's own and is never accepted from another process.

Only the user who runs Lemonify can reach the socket: its folder is created with mode 0700 (and tightened if it was looser), the web server refuses a folder that belongs to another user, and the socket itself is 0600. Any process of that user can send a change for any person, which is safe because a change says only that something changed, and a `queued` message names no job or person; a tab still reads the content through its own authorised requests.

Sending never slows a command. Publishing writes to the socket without waiting; with no web server running there are no tabs, the connection fails at once and the change is dropped without a word. A command ends by writing what is still waiting, for at most a second. Changes waiting beyond 1 MiB, because the web server is not reading them, are dropped with one warning. A lost connection is opened again by the next change, so a restarted web server hears from processes that were already running.

When the web server starts it removes a socket left by one that was killed. If another web server is still listening on the same data folder it refuses to start, since the two would split the changes between them; give each its own `LEMONIFY_DATA_DIR`. A data folder whose socket path would pass the 103 bytes every supported system allows is refused when the configuration is read, naming `LEMONIFY_DATA_DIR`.

## Edits made in two tabs at once

A tab with edits not yet saved finishes sending them first. If the server refuses one because the document moved on, the tab reads the newer document and replays its waiting edits on top, dropping any that no longer apply and saying so. A tab with nothing waiting simply shows the newer document.

## Connection loss

The browser reconnects by itself, waiting 1 s, 2 s, 4 s and so on up to 30 s with random spread, and starting again once a connection has stayed up. The server sends a heartbeat every 30 s; a tab that hears nothing for 75 s treats the connection as dead. On every (re)connection, when the tab is shown again and when the network returns, the tab reads its lists and open documents, so nothing missed is lost, including a change a command made while the web server was down. After 3 s without a connection a status message says live updates are down. When the server ends a sign-in (close code 4401) the tab stops trying.

## Hardening

- The handshake checks the `Origin` header against the site's trusted origins, so another website cannot open a connection with the person's cookie (cross-site WebSocket hijacking). A missing origin is refused.
- The person must have a valid session cookie at the handshake and the session is checked again every 60 s; an ended session closes the connection with 4401.
- Handshakes are rate limited per address and per user (60 a minute each); a person may hold 20 connections and the server 2000, beyond which it answers 503 with `Retry-After`.
- Messages are limited to 1 KiB, compression is off, and a client whose send buffer passes 1 MiB is dropped (1013) rather than slowing the others.
- Any path other than `/realtime` is 404; plain HTTP requests are 426.

## Running behind a proxy

Cookies are scoped to the host, not the port, so the session cookie reaches the realtime port. In production serve it over TLS: route a path or subdomain of the site to the realtime port at the proxy and set `LEMONIFY_REALTIME_URL` to the public `wss://` address. Keep `LEMONIFY_REALTIME_HOST` on a private interface when a proxy is in front.
