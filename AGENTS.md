# AGENTS.md

Guidance for AI agents working in this repository.

## What this is

`upwork-axi` is an AXI-compliant CLI over the Upwork **client (hiring)
interface** via a persistent authenticated browser. Phase 0 (this) covers
the transport: browser daemon, auth, ref-based interactive primitives, and
discovery capture. Later phases add domain commands (jobs, proposals,
messages) built from discovery artifacts. Upwork also has an official
GraphQL API; an OAuth API-key transport is planned as the primary path
once access is approved - this browser layer then becomes the fallback.
Keep the AXI principles in mind for every change:

1. TOON output by default, `--json` opt-in
2. Minimal list schemas by default
3. Truncate with size hints, `--full` escape hatch
4. Pre-computed aggregates (counts, summaries)
5. Definitive empty states ("0 matches")
6. Structured errors on stdout; exit 2 usage / 1 runtime; unknown flags fail
   loud; never prompt
7. Ambient context via `setup hooks`, opt-in only
8. No-args home view is live content, not help
9. `help[]` next-step suggestions after output
10. Every command has a concise `--help`

## Hard rules

- **Never commit secrets or candidate PII.** The repo holds code and skill
  docs only. Proposals, cover letters, threads, and captured documents
  live under `~/.upwork-axi/` (user-level, gitignored). Tests must pass
  with no browser running.
- **Commit `dist/` with every source change.** After editing `src/`, run
  `npm run build` and commit `dist/` in the same change.
- **Network/browser access lives in `src/browser/` only.** Commands
  receive injected daemon connections and runners; tests pass fakes. Do
  not call `fetch`, spawn Chrome, or import playwright outside
  `src/browser/`.
- **All browsing is headed.** Never headless, never a background daemon
  doing invisible work - the daemon is a *visible* Chrome window the user
  can watch. One browser at a time, enforced by the launch lock.
- **Upwork-only scoping.** Navigation and actions are limited to
  `*.upwork.com`; the authenticated profile is never pointed elsewhere.
- **The Playwright-controlled browser is the only web client for
  upwork.com.** No cookie export, no replaying requests through a separate
  HTTP client. Domain-command reads/writes go through in-page same-origin
  fetches from the authenticated session (the endpoint and auth headers
  are sniffed from the app's own live traffic, held in memory for one
  command, never persisted).
- **Never log or persist cookies, headers, or credential-shaped keys.**
  Captured artifacts pass through `redactJsonText()`; error paths through
  `redact()`.
- **Human-pace always.** Upwork enforces against automation
  behaviorally. Real Chrome, real profile, visible window, paced actions.
  No bulk-blast anything, no rapid-fire loops, no auto-refresh patterns.
- **This is an internal tool** operating on accounts I am authorized to
  manage. Visible, user-invoked Playwright interaction through the normal
  Upwork interface is direct user interaction.
- **Exit codes:** `VALIDATION_ERROR` (and only it) maps to exit 2;
  everything else is 1. The SDK's error mapping owns this - do not
  hand-roll it.

## Layout

```
bin/upwork-axi.js     entrypoint; fast-path version probe, then dist/
src/lib/              args (strict parseArgs), output, guard, truncate,
                      dotenv (working-dir .env, env wins)
src/browser/session.ts  state dir (~/.upwork-axi), session record, launch
                        lock, Upwork auth classification (path-based: the
                        client app lives under /nx, /ab, /messages, ... -
                        no employer subdomain exists), login wait
src/browser/daemon.ts   persistent headed Chrome: spawn (detached, CDP
                        port), state file, connect-over-CDP, stop;
                        in-page error collector init script
src/browser/appapi.ts   in-page GraphQL transport: endpoint + auth-header
                        sniff from live app traffic (any upwork.com
                        */graphql URL; memory only), in-page fetch,
                        settle+retry for SPA context churn
src/browser/snapshot.ts ref-based page outline (in-page script + pure
                        helpers: clipLines, filterLines, parseTarget)
src/browser/capture.ts  discovery network recorder (Upwork hosts only,
                        redacted)
src/browser/artifacts.ts run dirs + sanitized snapshots
src/browser/runners.ts  login / probe / discover orchestration (daemon)
src/commands/           one file per command family (Phase 0: home, auth,
                        browser, discover, skill, setup)
src/index.ts            runAxiCli registration
test/                   vitest, fully mocked daemon + pages
skills/upwork-axi/      installable agent skill
```

## Snapshot ref rules

- Refs (`[ref=eN]`) are assigned per snapshot via a `data-ua-ref`
  attribute; click/fill/select resolve them to locators. Public Playwright
  API only.
- Refs reset on every snapshot and navigation. Stale refs fail as
  `STALE_REF` with re-snapshot guidance - never retry blindly.
- Only viewport-intersecting interactive elements get refs. Hidden/off-canvas
  elements render as `(offscreen)` without a ref; below-fold content becomes
  actionable after scrolling + re-snapshot.

## Auth classification

Upwork has no employer subdomain (unlike Indeed). The client app lives on
`www.upwork.com` under path prefixes: `/nx/*` (app shell, My Jobs, home),
`/ab/*` (account pages - including the login page, which is classified
`auth` first), `/messages*`, `/o/*`, `/hp/*`, `/freelancers*`.
`classifyUrl()` returns `logged-in` only for those prefixes on an
upwork.com host; login-ish paths return `auth`; everything else
(marketing pages, other hosts) is `away`. The DOM check
(`looksLikeLoginPage`) guards SPA false positives. Revise the prefix list
after live discovery if Upwork adds sections.

## Domain commands (post-discovery)

The GraphQL transport (`src/browser/appapi.ts`) works like this: ensure the
daemon, land on the app, sniff the GraphQL endpoint URL and exact headers
the app itself sends (reloading the page to trigger its burst when idle;
both live in memory for one command and are never persisted), let the SPA
settle, then run in-page same-origin fetches with those headers. 401/403
surfaces as `AUTH_ERROR` with a login hint; GraphQL `errors[]` surfaces as
`APP_API_ERROR` suggesting a re-discovery.

Queries for domain commands are extracted verbatim from discovery runs and
live in `src/upwork/queries.ts` (created in Phase 1). If a schema drift
breaks one, re-run `discover`, re-extract, and keep the discovery doc
updated. Never hand-write queries.

Proposal packets (cover letters, freelancer profiles, threads) are PII:
they persist only under `~/.upwork-axi/store/` and never in the repo.
Syncs pace per-proposal fetches (~300 ms) - keep it human-pace.

## Gated writes

Mutations (`messages send`, proposal shortlist/archive/decline) are
plan-preview by default: live resolution + full preview output + **zero
mutation calls**; each gate has a test proving the mutation document is
never sent without `--confirm`. With `--confirm`: one write per
invocation, verify-by-reread (send -> thread re-read), and never any bulk
operations. Sends are candidate-facing - the human approves every one.

## Commands

```
npm run build       # tsc -> dist/ (committed to the repo; rebuild on change)
npm test            # vitest run
npm run typecheck
```

Run the CLI locally with `node bin/upwork-axi.js` (after `npm run build`).
It works with no browser running: the home view, `auth status`, and
`browser status` read state files and never launch anything.

Live Upwork testing is an explicit local operation. Prefer read-only
commands (`browser open`, `snapshot`, `find`, `goto`) when verifying
against production. Anything that mutates state (clicks on buttons that
submit, sends) happens under the user's eye in the visible window -
narrate what you are about to do first, and keep actions human-paced
(Upwork's trust systems flag automation patterns).
