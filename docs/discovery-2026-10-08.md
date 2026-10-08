# Upwork client-app endpoint map — discovery 2026-10-08

Source: discovery run `~/.upwork-axi/runs/discover-20261008-122916-d40d`
(431 exchanges, 62 documents). All requests observed from the logged-in
web app on `www.upwork.com`.

## Authentication model (critical)

The web app does **not** use plain cookie auth for its APIs. Every call
carries `authorization: bearer oauth2v2_int_...` — a family of
**per-surface scoped tokens** minted client-side. Replaying one surface's
token against another operation fails with oauth2 scope errors (verified
live: the dashboard token answers `clientDashboardRelations` but is
rejected on `Query.clientProposalsByFilter`).

`src/browser/appapi.ts` therefore captures headers **per GraphQL alias**
(the `?alias=` query param the app appends) and **per REST path prefix**,
then replays the matching set per request. When an alias's token has not
been observed yet, a domain-supplied `surface` URL navigates the page so
the app fires (and we capture) the right token, then the request retries.
Tokens live in memory for one command and are never persisted.

## GraphQL

Endpoint: `POST https://www.upwork.com/api/graphql/v1?alias=<alias>`

| Command | Operation | Alias | Variables (observed) |
| --- | --- | --- | --- |
| `jobs list` | `clientDashboardRelations` | `gql-query-clientdashboardrelations` | `teamId` (org), `filter: "OPEN_OPENINGS"`, `sortOrder: "PRIORITY"` |
| `proposals list` | `clientProposalsByFilter` | `clientProposalsByFilter` | `jobPostingId`, `statusFilter: "ApplicantsAll"` (also `Sponsored` = sponsored tab), `pagination {first, after}`, `sort: "RECOMMENDATIONSCORE_DESC"` |
| `proposals stats` | `proposalsStatistics` | `proposalsStatistics` | `jobPostingId` |
| (mark read) | `markClientProposalAsRead` | `markClientProposalAsRead` | `clientProposalReadRequest {proposalId, jobPostingId}` |

Notes:
- `clientProposalsByFilter` nodes are rich: cover letter, screener
  Q&A, milestones, attachments (signed S3 links), terms, room id,
  talent profile aggregates (JSS with `preferences.hideJss`), skills,
  Top Rated badges, AI-interview data. `proposal get` is built from this
  node — a separate detail query exists (`clientProposal`,
  alias `gql-query-clientproposal`) but its token only mints when a
  proposal modal opens via SPA transition, so it is unused.
- `clientDashboardRelations.filterTotalCounts` carries every relation
  count (OPEN_OPENINGS, ACTIVE_CONTRACTS, ...).
- Org id (`teamId`) is captured from live traffic (`callerOrgId=` in
  URLs or `"teamId":"..."` in GraphQL bodies).

## REST (rooms / messages)

Base: same-origin `GET` on `www.upwork.com` with the rooms token.

| Command | Path | Notes |
| --- | --- | --- |
| `messages rooms` | `/api/v3/rooms/rooms/simplified?limit=&callerOrgId=` | `{rooms: [...]}` — roomId, roomName, topic, numUnread, recentTimestamp, jobUid, context (jobTitle, clientName) |
| `messages read` | `/api/v3/rooms/rooms/<roomId>/stories/simplified?limit=&callerOrgId=` | `{stories, cursor, total}` — storyId, message, created (ms), orgId, isSystemStory, actionType (`eo:post`) |
| (room users) | `/api/v3/rooms/rooms/<roomId>/users?limit=&callerOrgId=` | `{users: [{userId, orgId, role}]}` — client user = orgId match |
| `messages unread` | via `rooms/simplified` `numUnread` | per-job variant: `/api/v3/rooms/users/jobs/<jobPostingId>/unreadCountsPerApplicant` |
| (mark read) | `PUT /api/v3/rooms/rooms/<roomId>/users/<uid>/<orgId>?updateLastReadReason=roomOpened` | fires when a room is opened |

Story roles: `isSystemStory=1` → system; `orgId === <my org>` → out
(team-wide); else in.

## Surfaces (where tokens mint)

| Surface URL | Mints |
| --- | --- |
| `https://www.upwork.com/nx/client/dashboard/` | relations token, org id |
| `https://www.upwork.com/ab/applicants/<jobPostingId>/applicants` | proposals list + stats tokens |
| `https://www.upwork.com/ab/messages/rooms/` | rooms REST token |

Client app path prefixes (auth classification): `/nx`, `/ab`,
`/messages`, `/o`, `/hp`, `/freelancers`. Login:
`/ab/account-security/login`. Everything else on the bare host is
marketing (`away`).

## Not yet captured

- **Message send** — the composer (rooms app or the applicants-page
  `modal-messages` compose dialog) posts only on an actual send. Next
  discovery: with the user's approval, send one test message to capture
  the mutation, then build `messages send --confirm`.
- Proposal shortlist/archive/decline mutations.
- Offers (`CreateOfferInput` exists in the public API; the web flow was
  not exercised in this run).

## Bot-detection surfaces to avoid

`/shitake/suit` (Upwork anti-bot telemetry), `tl.upwork.com/captcha-check`,
Cloudflare `challenge-platform` paths. Domain commands never touch these;
keep it that way. `upi/jslogger` and `upi/metrics` are app telemetry -
not replayed.
