---
name: upwork-axi
description: Use upwork-axi for Upwork client (hiring) tasks - listing job postings, reviewing proposals, screening candidates, reading and sending messages, and recording client-app traffic for automation - instead of driving a raw browser. Covers the full interactive browser loop (open, snapshot, find, click, fill) over a persistent authenticated session. First choice whenever a task touches the Upwork client account.
---

# upwork-axi

Agent-ergonomic CLI over the Upwork client (hiring) interface via a
persistent authenticated browser. TOON output, structured errors, `help[]`
next steps. The browser transport needs no API key - everything goes
through the visible Chrome session this tool manages. (Upwork's official
GraphQL API transport ships separately once API access is approved.)

## Session model

One visible Chrome (headed, dedicated profile at `~/.upwork-axi/`) stays
alive between commands (the daemon). Login is manual once: `upwork-axi
auth login` (waits for you to complete 2FA), then the session persists.
Browser commands start the browser automatically when needed - a Chrome
window may appear; that is expected and it is the audit trail.

## The hiring loop (screening candidates today)

There are no domain commands yet (they are built from discovery
artifacts); drive the client app interactively:

1. `upwork-axi browser open` (or `browser goto <upwork-url>`) - navigate
   and get the page outline with `[ref=eN]` tags. Key client URLs:
   `https://www.upwork.com/nx/my-jobs` (job postings + proposals),
   `https://www.upwork.com/messages` (message threads).
2. Narrow with `browser find <terms>`; act with `browser click eN`,
   `fill eN "text" --submit`, `select eN "value"`, `press Enter`. Every
   action returns a fresh snapshot - read it before the next action.
3. Refs reset on every snapshot/navigation; stale refs fail loudly
   (`STALE_REF`). `(offscreen)` elements have no ref: scroll
   (`eval window.scrollBy(0, 800)`), re-snapshot.
4. Diagnostics: `browser console`, `browser screenshot`, `browser eval`.

### Screening a proposal

1. `browser goto https://www.upwork.com/nx/my-jobs` - snapshot, open the
   job posting, then its proposals list.
2. Open each proposal (cover letter, bid, freelancer profile) via refs;
   read and evaluate against the operator's rubric documents (they live
   outside this tool - platform-agnostic by design).
3. Open the message thread for the proposal (`/messages`), read history
   (`find <candidate name>`).
4. Draft the next touchpoint, show the user the exact text, then send it
   in the visible window via `fill` on the message box + `--submit` or a
   send-button click. Narrate before sending - sends are candidate-facing
   and the human approves every one.
5. Shortlist/archive/decline from the proposal's action buttons, again
   only after user approval.

## Safety

- **Human-pace always.** Upwork runs behavioral bot detection and bans
  accounts for automation patterns. No rapid-fire actions, no bulk
  anything, no auto-refresh loops. The visible window + real profile +
  paced actions are the doctrine.
- Anything that submits, sends, or changes state happens in the visible
  window under the user's eye. Narrate before acting on buttons that
  submit/send/reject.
- If a session drops to a login page, stop and tell the user to run
  `upwork-axi auth login` - never enter credentials yourself.
- Proposal/cover-letter data is PII: quote only what the task needs; the
  store stays local.

## Discovery (when building/fixing domain commands)

`upwork-axi discover` records a manual client-app walkthrough (My Jobs ->
proposals -> proposal detail -> message thread -> send) and writes
redacted network/documents artifacts under `~/.upwork-axi/runs/<id>/`.
Those artifacts define the GraphQL queries for the Phase 1 domain
commands (`jobs list`, `proposals list/sync`, `messages read/send`). If a
domain command later fails with APP_API_ERROR, the schema drifted:
re-run discover, re-extract, update the endpoint map doc.

## Auth commands

- `upwork-axi auth status [--browser]` - record, or live probe with `--browser`
- `upwork-axi auth login [--timeout <ms>]` - visible Chrome, manual login wait
- `upwork-axi auth logout [--purge]` - close browser, clear record, optional
  profile delete

## Invocation

Installed globally: `upwork-axi <command>`. Otherwise:
`npx -y upwork-axi@latest <command>`. Default output is TOON; pass
`--json` for machine-readable JSON. Exit codes: 0 success, 2
usage/validation, 1 runtime. Errors carry `error`/`code`/`help[]`.

## Conventions

- Empty results are explicit (`count: 0`), never blank.
- The no-args home view (`upwork-axi`) shows session + daemon state and
  next steps with zero launches.
- Never guess URLs deep into the app: navigate from known roots
  (`/nx/my-jobs`, `/messages`) and follow refs.

## Roadmap context

Phase 0 (transport) is complete: daemon, auth, browser loop, discover,
skill, hooks. Phase 1 adds domain reads (`jobs list`, `proposals
list/sync --job`, `proposal get`, `messages read`) over in-page GraphQL
using queries extracted from discovery. Phase 2 adds gated writes
(`messages send --confirm`, proposal shortlist/archive). An official
OAuth API transport becomes primary once Upwork approves API access.
