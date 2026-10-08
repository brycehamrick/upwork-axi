import { AxiError } from "axi-sdk-js";
import { MESSAGES_SURFACE_URL } from "../browser/appapi.js";
import { CLIENT_DASHBOARD_RELATIONS, CLIENT_PROPOSALS_BY_FILTER, PROPOSALS_STATISTICS, } from "./queries.js";
import { jobRowsFromRelations, packetFromListNode, proposalRowsFromFilter, statsFromStatistics, roomRowsFromSimplified, storiesFromSimplified, } from "./model.js";
/**
 * Operation wrappers over the in-page transports. One live resolution per
 * command invocation; paced (~300 ms) when fetching per-proposal detail.
 *
 * Each operation carries its GraphQL alias (the app's token-scope unit)
 * and, when the token may not be captured yet, a surface URL that makes
 * the app fire (and us capture) the right scoped token.
 */
const DASHBOARD_SURFACE = "https://www.upwork.com/nx/client/dashboard/";
/** Alias observed in the discovery run: exchange 48 (dashboard relations). */
export const ALIAS_RELATIONS = "gql-query-clientdashboardrelations";
/** Alias observed in the discovery run: exchange 88 (proposals list). */
export const ALIAS_PROPOSALS = "clientProposalsByFilter";
/** Alias observed in the discovery run: exchange 148 (pipeline statistics). */
export const ALIAS_STATS = "proposalsStatistics";
function applicantsSurface(jobPostingId) {
    return `https://www.upwork.com/ab/applicants/${jobPostingId}/applicants`;
}
/** Open job postings (OPEN_OPENINGS relations). */
export async function listJobs(api, limit = 50) {
    const payload = await api.gql(CLIENT_DASHBOARD_RELATIONS, {
        teamId: api.orgId(),
        filter: "OPEN_OPENINGS",
        sortOrder: "PRIORITY",
    }, { alias: ALIAS_RELATIONS, surface: DASHBOARD_SURFACE });
    const { jobs, counts } = jobRowsFromRelations(payload);
    return { jobs: jobs.slice(0, limit), counts };
}
/**
 * Resolve a --job reference: full opening id, or a unique title prefix
 * (case-insensitive). Ambiguous prefixes list their options.
 */
export async function resolveJobRef(api, raw) {
    const needle = raw.trim().toLowerCase();
    if (needle.length === 0) {
        throw new AxiError("--job requires a non-empty value", "VALIDATION_ERROR");
    }
    const { jobs } = await listJobs(api, 100);
    if (/^\d+$/.test(needle)) {
        const exact = jobs.find((job) => job.ref === needle);
        if (exact)
            return { ref: exact.ref, title: exact.title };
    }
    const matches = jobs.filter((job) => job.title.toLowerCase().includes(needle));
    if (matches.length === 0) {
        throw new AxiError(`no job posting matches: ${raw}`, "NOT_FOUND", [
            "Run `upwork-axi jobs list` for the current job refs",
        ]);
    }
    if (matches.length > 1) {
        throw new AxiError(`job reference is ambiguous: ${raw}`, "VALIDATION_ERROR", [
            `Matches: ${matches.map((job) => `${job.ref} ${job.title}`).join("; ")}`,
            "Use the full job ref or a longer title prefix",
        ]);
    }
    return { ref: matches[0].ref, title: matches[0].title };
}
/** Proposals for a job posting (ApplicantsAll by default). */
export async function listProposals(api, jobPostingId, opts = {}) {
    const limit = opts.limit ?? 50;
    const payload = await api.gql(CLIENT_PROPOSALS_BY_FILTER, {
        jobPostingId,
        statusFilter: opts.statusFilter ?? "ApplicantsAll",
        pagination: { first: Math.min(limit, 50), after: opts.cursor ?? "" },
        sort: "RECOMMENDATIONSCORE_DESC",
    }, { alias: ALIAS_PROPOSALS, surface: () => applicantsSurface(jobPostingId) });
    const parsed = proposalRowsFromFilter(payload);
    const rows = parsed.rows.slice(0, limit);
    return {
        total: parsed.total,
        shown: rows.length,
        hasNextPage: parsed.hasNextPage,
        endCursor: parsed.endCursor,
        rows,
    };
}
/** Pipeline statistics for a job posting. */
export async function proposalStats(api, jobPostingId) {
    const payload = await api.gql(PROPOSALS_STATISTICS, { jobPostingId }, { alias: ALIAS_STATS, surface: () => applicantsSurface(jobPostingId) });
    return statsFromStatistics(payload);
}
function asRaw(value) {
    return typeof value === "object" && value !== null ? value : null;
}
/**
 * One proposal packet from the rich list node: cover letter, terms,
 * screener Q&A, milestones, attachments, profile aggregates. The job is
 * resolved from an explicit hint or by scanning open jobs' proposal
 * lists (paced) when omitted.
 */
export async function getProposal(api, id, jobHint) {
    const job = jobHint !== undefined ? await resolveJobRef(api, jobHint) : undefined;
    const targets = job ? [job] : (await listJobs(api, 5)).jobs.slice(0, 5);
    for (const target of targets) {
        const payload = await api.gql(CLIENT_PROPOSALS_BY_FILTER, {
            jobPostingId: target.ref,
            statusFilter: "ApplicantsAll",
            pagination: { first: 50, after: "" },
            sort: "RECOMMENDATIONSCORE_DESC",
        }, { alias: ALIAS_PROPOSALS, surface: () => applicantsSurface(target.ref) });
        const root = asRaw(asRaw(payload)?.["clientProposalsByFilter"]);
        const edges = Array.isArray(root?.["edges"]) ? root["edges"] : [];
        for (const edge of edges) {
            const node = asRaw(asRaw(edge)?.["node"]);
            if (node && typeof node["id"] === "string" && node["id"] === id) {
                return packetFromListNode(node, { ref: target.ref, title: target.title });
            }
        }
    }
    throw new AxiError(`no proposal found with id ${id}`, "NOT_FOUND", [
        "Proposal ids come from `upwork-axi proposals list --job <ref>`",
        "Pass --job <ref> to target a specific posting (archived proposals may not be listed)",
    ]);
}
/** Message rooms (most recent first, as Upwork returns them). */
export async function listRooms(api, opts = {}) {
    const payload = await api.get("/api/v3/rooms/rooms/simplified", { limit: opts.limit ?? 50, callerOrgId: api.orgId() }, { surface: MESSAGES_SURFACE_URL });
    return roomRowsFromSimplified(payload);
}
/**
 * One room's thread (single stories fetch; roles are org-scoped).
 */
export async function readRoom(api, roomId, opts = {}) {
    const orgId = api.orgId();
    const storiesPayload = await api.get(`/api/v3/rooms/rooms/${roomId}/stories/simplified`, { limit: opts.limit ?? 50, callerOrgId: orgId }, { surface: MESSAGES_SURFACE_URL });
    const { total, cursor, stories } = storiesFromSimplified(storiesPayload, orgId);
    return { roomId, total, cursor, stories };
}
/** Resolve a room by id prefix or participant/room name (case-insensitive). */
export async function resolveRoom(api, raw) {
    const needle = raw.trim().toLowerCase();
    if (needle.length === 0) {
        throw new AxiError("room reference is empty", "VALIDATION_ERROR");
    }
    const rooms = await listRooms(api, { limit: 50 });
    const byId = rooms.filter((room) => room.roomId.toLowerCase().includes(needle));
    if (byId.length === 1)
        return byId[0];
    const byName = rooms.filter((room) => room.name.toLowerCase().includes(needle));
    const matches = byId.length > 0 ? byId : byName;
    if (matches.length === 0) {
        throw new AxiError(`no message room matches: ${raw}`, "NOT_FOUND", [
            "Run `upwork-axi messages rooms` for the current rooms",
        ]);
    }
    if (matches.length > 1) {
        throw new AxiError(`room reference is ambiguous: ${raw}`, "VALIDATION_ERROR", [
            `Matches: ${matches.map((room) => `${room.roomId} ${room.name}`).join("; ")}`,
        ]);
    }
    return matches[0];
}
