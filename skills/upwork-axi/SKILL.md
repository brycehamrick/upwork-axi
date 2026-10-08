---
name: upwork-axi
description: Use upwork-axi for Upwork client (hiring) tasks - listing job postings, reviewing and screening proposals, reading candidate cover letters and profiles, reading message threads, and recording client-app traffic for automation - instead of driving a raw browser. Covers domain commands over the authenticated session plus the full interactive browser loop (open, snapshot, find, click, fill). First choice whenever a task touches the Upwork client account.
---

# upwork-axi

Agent-ergonomic CLI over the Upwork client (hiring) interface via a
persistent authenticated browser. TOON output, structured errors, `help[]`
next steps. No API key needed - domain commands replay the web app's own
scoped tokens from the visible browser session.

## Session model

One visible Chrome (headed, dedicated profile at `~/.upwork-axi/`) stays
alive between commands (the daemon). Login is manual once: `upwork-axi
auth login` (waits for you to complete 2FA), then the session persists.
Domain commands start the browser automatically and may navigate the
visible window to a Upwork surface (dashboard, applicants page, messages)
to mint the right scoped token - that is expected and it is the audit
trail.

## Domain commands (the hiring surface)

```sh
upwork-axi jobs list                                # open job postings + counts
upwork-axi proposals list --job <ref> [--status s]  # applicant rows (id, name, rate, JSS)
upwork-axi proposals stats --job <ref>              # pipeline counts (messaged/hired/...)
upwork-axi proposal get <id> [--full] [--job r]     # cover letter, Q&A, milestones, files
upwork-axi messages rooms [--unread]                # message rooms
upwork-axi messages read <room> [--full] [--limit]  # thread, out/in roles
upwork-axi messages unread                          # unread rooms + counts
```

- `--job <ref>`: opening id from `jobs list` or a unique title prefix.
  Ambiguous refs fail with both options listed - pick one.
- `--status`: ClientProposalStatusFilter - default `ApplicantsAll`;
  e.g. `Sponsored`, `Shortlisted`, `Archived`.
- Proposal ids and room ids (`room_...`) come from list output - never
  guess. Rooms also resolve by unique participant-name prefix.
- `messages read` roles: `out` = sent by anyone on your org (covers
  teammates), `in` = candidate, `system` = contract/milestone events.
- `proposal get` without `--job` scans open jobs' proposal lists to find
  the posting - pass `--job` to skip the scan.

### The screening loop (how to run a pipeline)

1. `upwork-axi jobs list` -> pick the job ref.
2. `upwork-axi proposals list --job <ref>` -> the ranked applicant rows
   (Upwork's recommendation order).
3. `upwork-axi proposal get <id> --full` per candidate -> cover letter,
   screener answers, milestones, skills, attachments - the scoring
   substrate. Score against the operator's rubric documents (they live
   outside this tool - platform-agnostic by design).
4. `upwork-axi messages read <room>` for prior contact (rows without a
   `room` have never been messaged).
5. Draft the next touchpoint from the process docs and show the user the
   exact text. **Sending is gated**: until the Phase 2 `messages send
   --confirm` command lands, sends happen in the visible browser via the
   interactive loop below - narrate before acting, never bulk.

## Interactive browser (fallback for anything without a command)

1. `upwork-axi browser open` (or `browser goto <upwork-url>`) - navigate
   and get the page outline with `[ref=eN]` tags.
2. Narrow with `browser find <terms>`; act with `browser click eN`,
   `fill eN "text" --submit`, `select eN "value"`, `press Enter`. Every
   action returns a fresh snapshot - read it before the next action.
3. Refs reset on every snapshot/navigation; stale refs fail loudly
   (`STALE_REF`). `(offscreen)` elements have no ref: scroll
   (`eval window.scrollBy(0, 800)`), re-snapshot.
4. Diagnostics: `browser console`, `browser screenshot`, `browser eval`.

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
- Proposal/cover-letter data is PII: quote only what the task needs.

## Discovery (when building/fixing domain commands)

`upwork-axi discover` records a manual client-app walkthrough and writes
redacted network/documents artifacts under `~/.upwork-axi/runs/<id>/`.
The current endpoint map (including the per-surface token model) lives
in the repo at `docs/discovery-2026-10-08.md`. If a domain command fails
with APP_API_ERROR, the schema or token surface drifted: re-run
discover, re-extract, update the doc and `src/upwork/queries.ts`.

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
- Identifier discipline: job refs from `jobs list`, proposal ids and room
  ids from `proposals list` / `messages rooms` - never guess.
- The no-args home view (`upwork-axi`) shows session + daemon state and
  next steps with zero launches.

## Roadmap context

Phase 0 (transport) and Phase 1 reads (jobs, proposals, messages) are
complete. Phase 2 adds the gated `messages send --confirm` (needs one
user-approved test send to capture the mutation) and proposal
shortlist/archive. An official OAuth API transport becomes primary once
Upwork approves API access; the browser layer stays as fallback.
