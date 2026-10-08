# upwork-axi

Agent-ergonomic CLI for the [Upwork](https://www.upwork.com/) client
(hiring) interface. [AXI](https://axi.md)-compliant: TOON output,
structured errors, `help[]` next steps, and a persistent authenticated
browser an agent can actually drive.

This is the **browser transport** for Upwork hiring: a visible Chrome on a
dedicated persistent profile (manual login, 2FA included) that stays alive
between commands, ref-based interactive primitives modeled on
`playwright-axi`, and a `discover` command that records the client app's
own JSON traffic for building domain commands (jobs, proposals, messages)
next.

Upwork also exposes an official GraphQL API for clients; a sanctioned
API-key transport is planned alongside this one (API access pending
approval). Until then - and as the fallback forever - everything goes
through the visible browser session.

## Install

```sh
npm install -g upwork-axi
# or run on demand, identical:
npx -y upwork-axi@latest browser open
# install the agent skill for coding agents (Claude Code, Codex, OpenCode, ...):
npx -y upwork-axi skill install
```

Requires Node 20+ and a Chrome/Chromium (`UPWORK_BROWSER_BIN` can point to a
specific binary; installed Google Chrome is auto-detected, then any
Playwright-installed chromium).

## Auth

There is nothing to configure - the browser transport needs no API key. Log
in manually once:

```sh
upwork-axi auth login     # opens visible Chrome; you log in (2FA included)
upwork-axi auth status --browser
```

The session lives in a dedicated persistent profile under `~/.upwork-axi/`
(`UPWORK_STATE_DIR` overrides) - never your primary Chrome profile. The
browser stays open after login so `browser` commands work immediately.

## Commands

| Command | Description |
| --- | --- |
| `upwork-axi` | Home: session record, daemon state, next steps (zero launches) |
| `upwork-axi auth login` | Open visible Chrome, wait for manual login |
| `upwork-axi auth status` | Session state (`--browser` probes live) |
| `upwork-axi auth logout` | Close the browser, clear the record (`--purge` deletes the profile) |
| `upwork-axi browser open` | Start/attach the browser, navigate, snapshot |
| `upwork-axi browser status` / `close` | Daemon liveness / stop the browser |
| `upwork-axi browser goto <url>` | Navigate to an upwork.com URL (scoped) |
| `upwork-axi browser snapshot` | Page outline with `[ref=eN]` tags (`--full`, `--query`) |
| `upwork-axi browser find <terms>` | Filtered outline lines with context |
| `upwork-axi browser click <ref>` | Click a ref, get a fresh snapshot |
| `upwork-axi browser fill <ref> <text>` | Fill a field (`--submit` presses Enter) |
| `upwork-axi browser select <ref> <value>` | Choose a dropdown option |
| `upwork-axi browser press <key>` | Press a key (Enter, Tab, Control+A, ...) |
| `upwork-axi browser eval <expr>` | Evaluate JS on the page, JSON result |
| `upwork-axi browser screenshot` | Save a PNG (runs dir by default) |
| `upwork-axi browser console` | Collected in-page errors |
| `upwork-axi discover` | Record a manual client-app session (dev command) |
| `upwork-axi setup hooks` | Ambient session context (Claude Code, Codex, OpenCode) |

Every command supports `--json` and `--help`.

## The interactive loop (screening candidates today)

Domain commands land after the first discovery run; the interactive loop
already covers the hiring workflow:

```sh
$ upwork-axi browser open
browser:
  started: true
  port: 54525
page:
  url: "https://www.upwork.com/nx/home"
snapshot:
  lines: 89
  refs: 13
outline[89]:
  - link "My Jobs" [ref=e1]
  - button "Message" [ref=e2]
  ...

$ upwork-axi browser find proposal     # narrow the outline
$ upwork-axi browser click e1          # act, fresh snapshot comes back
$ upwork-axi browser fill e7 "..." --submit
```

Refs come from the most recent snapshot and reset on every snapshot or
navigation - stale refs fail loudly as `STALE_REF`. Elements that are not
currently in the viewport appear as `(offscreen)` without a ref: scroll
(`browser press End`, `eval window.scrollBy(0, 800)`) and re-snapshot to
make them actionable. Ghost elements (hidden nav clones) never get refs.

## Browser daemon

All commands share one headed Chrome (the daemon): launched detached on the
persistent profile with a local DevTools port, reattached over CDP per
command. `browser close` (or `auth logout`) stops it; a stale state file is
self-healing. One browser at a time, always headed, always Upwork-only:

- Navigation and actions are scoped to `*.upwork.com`.
- Cookies never leave the browser; nothing is exported or replayed.
- Captured discovery artifacts pass through redaction (no headers, cookies,
  or credential-shaped keys).

## Human-pace by design

Upwork runs behavioral bot detection and enforces against automation
aggressively. This tool is deliberately slow-shaped: a real Chrome, a real
persistent profile, a visible window, human-paced actions, no bulk
anything. Every candidate-facing action happens under your eye in the
visible window.

## Discovery

`discover` records a manual walkthrough of the client app (open My Jobs,
open a job's proposals, open a proposal, read a message thread, send a
message, shortlist/archive) and writes `trace.zip` (when available),
`network.json`, `documents/` (captured JSON bodies), `console-errors.txt`,
final screenshot, `aria.yml`, `dom.html`, and `index.json` under
`~/.upwork-axi/runs/discover-<id>/`. Those artifacts feed the
domain-command roadmap (`jobs`, `proposals`, `messages`).

## Roadmap

- **Phase 0 (this release)** - scaffold, persistent browser daemon, auth,
  interactive `browser` family, `discover`, skill, hooks.
- **Phase 1** - domain reads over in-page GraphQL: `jobs list`,
  `proposals list/sync`, `proposal get`, `messages read`, local proposal
  store. Queries extracted from discovery artifacts.
- **Phase 2** - gated writes: `messages send --confirm` (verified by thread
  re-read), proposal shortlist/archive/decline.
- **API transport** - the official Upwork GraphQL API (OAuth 2.0) becomes
  the primary transport once API access is approved; the browser family
  stays as fallback for API gaps.

## Set up on another machine

```sh
npm install -g upwork-axi
npx -y upwork-axi skill install      # writes the agent skill to ~/.agents/skills/
upwork-axi auth login                # visible Chrome; log in manually (2FA included)
```

The skill installer is idempotent (`--force` overwrites a changed version,
`--dir <path>` targets another skills directory). Optional env:
`UPWORK_STATE_DIR` (default `~/.upwork-axi`) and `UPWORK_BROWSER_BIN`.

## Development

```sh
npm install
npm run build        # tsc -> dist/ (committed; rebuild on every change)
npm test             # vitest, fully mocked - no browser needed
npm run typecheck
```

Run locally with `node bin/upwork-axi.js`. Network/browser access is
isolated to `src/browser/`; commands receive injected daemon connections and
tests pass fakes. See `AGENTS.md` for the full house rules.

## License

MIT
