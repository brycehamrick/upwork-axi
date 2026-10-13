# upwork-axi

Agent-ergonomic CLI for the [Upwork](https://www.upwork.com/) client
(hiring) interface. [AXI](https://axi.md)-compliant: TOON output,
structured errors, `help[]` next steps, and a persistent authenticated
browser an agent can actually drive.

This is the **browser transport** for Upwork hiring: a visible Chrome on a
dedicated persistent profile (manual login, 2FA included) that stays alive
between commands, ref-based interactive primitives modeled on
`playwright-axi`, and domain commands (jobs, proposals, messages) that
replay the web app's own per-surface scoped tokens from inside the page.

Upwork also exposes an official GraphQL API for clients; a sanctioned
API-key transport is planned alongside this one (API access pending
approval). Until then - and as the fallback forever - everything goes
through the visible browser session.

## Install

```sh
npm install -g upwork-axi
# or run on demand, identical:
npx -y upwork-axi@latest jobs list
# install the agent skill for coding agents (Claude Code, Codex, OpenCode, ...):
npx -y upwork-axi skill install
```

Requires Node 20+ and a Chrome/Chromium. Set `UPWORK_BROWSER=chromium` to run
the Playwright-installed browser (on macOS its own "Google Chrome for
Testing.app", fully isolated from your daily Chrome; install it with
`npx playwright-core install chromium`). The default is installed Google
Chrome, then any Playwright-installed chromium; `UPWORK_BROWSER_BIN` can point
at a specific binary and always wins.

## Auth

There is nothing to configure - the browser transport needs no API key. Log
in manually once:

```sh
upwork-axi auth login     # opens visible Chrome; you log in (2FA included)
upwork-axi auth status --browser
```

The session lives in a dedicated persistent profile under `~/.upwork-axi/`
(`UPWORK_STATE_DIR` overrides) - never your primary Chrome profile. The
browser stays open after login so commands work immediately.

## Commands

| Command | Description |
| --- | --- |
| `upwork-axi` | Home: session record, daemon state, next steps (zero launches) |
| `upwork-axi jobs list` | Open job postings (ref, title, proposal counts) |
| `upwork-axi proposals list --job <ref>` | Applicant rows (`--status`, `--limit`, `--cursor`) |
| `upwork-axi proposals stats --job <ref>` | Pipeline counts (messaged/hired/shortlisted/...) |
| `upwork-axi proposal get <id>` | One proposal packet: cover letter, Q&A, milestones, files (`--full`) |
| `upwork-axi messages rooms` | Message rooms (`--unread`, `--limit`) |
| `upwork-axi messages read <room>` | One thread, out/in roles (`--full`, `--limit`) |
| `upwork-axi messages unread` | Unread rooms and counts |
| `upwork-axi messages send <room> --text <t>` | Gated single message send: preview by default, `--confirm` sends + verifies |
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

## Domain reads (the web app's own tokens, replayed in-page)

Domain commands run over the same authenticated browser. Upwork's web app
authenticates its APIs with a family of **per-surface scoped OAuth tokens**
minted client-side - so at connect time the CLI sniffs the endpoint, the
org id, and the exact headers the app itself sends per operation family
(`?alias=` for GraphQL, path prefix for REST), keeps them in memory for
one command, and replays them from in-page fetches. When an operation's
token has not been observed yet, the CLI navigates the visible window to
the surface that mints it (dashboard, the job's applicants page, or
messages), captures, and proceeds. Cookies never leave the browser; tokens
are never persisted.

```sh
$ upwork-axi jobs list
jobs:
  count: 1
totals:
  OPEN_OPENINGS: 1
  ACTIVE_CONTRACTS: 6
list[1]{ref,title,proposals,unread,shortlisted,hired}:
  "2103617170216336029","Experienced Event Photo Editor - ...",17,13,0,1

$ upwork-axi proposals list --job "photo editor"
proposals:
  total: 17
  shown: 17
list[17]{id,name,title,rate,status,jss,hours}:
  "2103915344041877505",Ozz P.,"Photographer, Photo retouching, ...",27.0 USD,Created,0,0
  ...

$ upwork-axi messages read "Ghaith" --limit 4
messages:
  count: 4
list[4]{role,at,body}:
  in,"2026-10-08T18:19:29.193Z","Hello Bryce Great, I'll get to retouching them..."
  out,"2026-10-08T18:09:23.374Z","Yes these are better thanks."
  ...
```

The full endpoint map (operations, aliases, surfaces, REST shapes) lives
in `docs/discovery-2026-10-08.md`.

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

- **Phase 0** - scaffold, persistent browser daemon, auth, interactive
  `browser` family, `discover`, skill, hooks.
- **Phase 1** - domain reads replaying the web app's own scoped tokens:
  `jobs list`, `proposals list/stats`, `proposal get`,
  `messages rooms/read/unread`. Endpoint map:
  `docs/discovery-2026-10-08.md`.
- **Phase 2 (this release)** - gated writes: `messages send --confirm`
  (body extracted verbatim from a live send; verified by thread re-read).
  Next: proposal shortlist/archive/decline.
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
`UPWORK_STATE_DIR` (default `~/.upwork-axi`), `UPWORK_BROWSER` (`chrome`
default, or `chromium` for the Playwright-installed build), and
`UPWORK_BROWSER_BIN` (explicit binary path; always wins).

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
