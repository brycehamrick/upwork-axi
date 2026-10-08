/**
 * Canonical summarizers over the raw GraphQL/REST payloads: job postings,
 * proposals, and message rooms/stories. Pure functions - unit-testable
 * without a browser.
 */
function asRaw(value) {
    return typeof value === "object" && value !== null ? value : null;
}
function numOf(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function strOf(value) {
    return typeof value === "string" ? value : "";
}
/** Open job postings from clientDashboardRelations (any relation filter). */
export function jobRowsFromRelations(payload) {
    const root = asRaw(asRaw(payload)?.["clientDashboardRelations"]);
    const relations = Array.isArray(root?.["relations"]) ? root["relations"] : [];
    const jobs = [];
    for (const relation of relations) {
        const opening = asRaw(asRaw(relation)?.["opening"]);
        if (!opening)
            continue;
        const messaging = asRaw(opening["messagingInfo"]);
        jobs.push({
            ref: strOf(opening["id"]),
            title: strOf(opening["title"]),
            status: strOf(opening["status"]),
            proposals: numOf(opening["totalProposalsCount"]),
            unread: numOf(opening["unreadProposalsCount"]),
            shortlisted: numOf(opening["shortListedCount"]),
            hired: numOf(opening["hiredTalentsCount"]),
            messaged: numOf(opening["messagedCount"]),
            ...(messaging?.["roomId"] ? { roomId: strOf(messaging["roomId"]) } : {}),
        });
    }
    const counts = {};
    const rawCounts = asRaw(root?.["filterTotalCounts"]);
    for (const [key, value] of Object.entries(rawCounts ?? {})) {
        if (typeof value === "number")
            counts[key] = value;
    }
    return { jobs, counts };
}
function proposalRow(node) {
    const user = asRaw(node["user"]) ?? {};
    const profile = asRaw(user["talentProfile"]) ?? {};
    const personal = asRaw(profile["personalData"]) ?? {};
    const location = asRaw(personal["location"]) ?? {};
    const aggregates = asRaw(profile["profileAggregates"]) ?? {};
    const terms = asRaw(node["terms"]) ?? {};
    const rate = asRaw(terms["chargeRate"]);
    const room = asRaw(node["room"]);
    const status = asRaw(node["status"]) ?? {};
    const locationText = [location["city"], location["country"]]
        .filter((part) => typeof part === "string" && part.length > 0)
        .join(", ");
    const topRated = aggregates["topRatedPlusStatus"] === true
        ? "Top Rated Plus"
        : aggregates["topRatedStatus"] === true
            ? "Top Rated"
            : undefined;
    return {
        id: strOf(node["id"]),
        name: strOf(user["name"]),
        title: strOf(personal["title"]),
        ...(locationText.length > 0 ? { location: locationText } : {}),
        ...(rate?.["rawValue"] !== undefined
            ? { rate: `${String(rate["rawValue"])} ${strOf(rate["currency"])}`.trim() }
            : {}),
        status: strOf(status["status"]),
        ...(room?.["id"] ? { roomId: strOf(room["id"]) } : {}),
        ...(typeof aggregates["nSS100BwScore"] === "number"
            ? { jss: numOf(aggregates["nSS100BwScore"]) }
            : {}),
        ...(topRated ? { topRated } : {}),
        ...(aggregates["totalHours"] !== undefined
            ? { totalHours: numOf(aggregates["totalHours"]) }
            : {}),
        ...(profile["vetted"] === true ? { vetted: true } : {}),
    };
}
/** Proposal rows from clientProposalsByFilter. */
export function proposalRowsFromFilter(payload) {
    const root = asRaw(asRaw(payload)?.["clientProposalsByFilter"]);
    const edges = Array.isArray(root?.["edges"]) ? root["edges"] : [];
    const pageInfo = asRaw(root?.["pageInfo"]);
    return {
        total: numOf(root?.["totalCount"]),
        hasNextPage: pageInfo?.["hasNextPage"] === true,
        endCursor: strOf(pageInfo?.["endCursor"]),
        rows: edges
            .map((edge) => asRaw(asRaw(edge)?.["node"]))
            .filter((node) => node !== null)
            .map(proposalRow),
    };
}
/** Pipeline counts from proposalsStatistics. */
export function statsFromStatistics(payload) {
    const root = asRaw(asRaw(payload)?.["proposalsStatistics"]);
    const out = {};
    for (const [key, value] of Object.entries(root ?? {})) {
        if (typeof value === "number")
            out[key] = value;
    }
    return out;
}
/** Room rows from GET /api/v3/rooms/rooms/simplified. */
export function roomRowsFromSimplified(payload) {
    const rooms = Array.isArray(asRaw(payload)?.["rooms"])
        ? asRaw(payload)["rooms"]
        : [];
    return rooms
        .map((room) => asRaw(room))
        .filter((room) => room !== null)
        .map((room) => ({
        roomId: strOf(room["roomId"]),
        name: strOf(room["roomName"]),
        ...(strOf(room["topic"]).length > 0 ? { topic: strOf(room["topic"]) } : {}),
        unread: numOf(room["numUnread"]),
        ...(numOf(room["recentTimestamp"]) > 0
            ? { recentTimestamp: numOf(room["recentTimestamp"]) }
            : {}),
        ...(strOf(room["jobUid"]).length > 0 ? { jobUid: strOf(room["jobUid"]) } : {}),
    }))
        .filter((room) => room.roomId.length > 0);
}
/**
 * Stories from GET /api/v3/rooms/rooms/<id>/stories/simplified (oldest
 * first). Roles are org-scoped: any story authored by the client
 * organization is "out" (covers teammates), everything else "in".
 */
export function storiesFromSimplified(payload, myOrgId) {
    const root = asRaw(payload);
    const rawStories = Array.isArray(root?.["stories"]) ? root["stories"] : [];
    const stories = rawStories
        .map((story) => asRaw(story))
        .filter((story) => story !== null)
        .map((story) => {
        const system = numOf(story["isSystemStory"]) === 1;
        const createdMs = numOf(story["created"]);
        const orgId = strOf(story["orgId"]);
        return {
            storyId: strOf(story["storyId"]),
            role: system ? "system" : orgId === myOrgId ? "out" : "in",
            at: createdMs > 0 ? new Date(createdMs).toISOString() : "",
            body: strOf(story["message"]),
        };
    })
        .filter((story) => story.storyId.length > 0);
    return {
        total: numOf(root?.["total"]),
        cursor: strOf(root?.["cursor"]),
        stories,
    };
}
/** Unread-per-applicant map from GET /api/v3/rooms/users/jobs/<id>/unreadCountsPerApplicant. */
export function unreadCountsFromApplicants(payload) {
    const root = asRaw(payload);
    const records = Array.isArray(root?.["records"]) ? root["records"] : [];
    const out = {};
    for (const record of records) {
        const entry = asRaw(record);
        if (!entry)
            continue;
        const key = strOf(entry["applicantUserId"] ?? entry["userId"] ?? entry["cipherText"]);
        if (key.length > 0)
            out[key] = numOf(entry["unreadCount"] ?? entry["count"]);
    }
    return out;
}
export function formatTimestamp(ms) {
    return ms > 0 ? new Date(ms).toISOString() : "";
}
/** Full packet from a clientProposalsByFilter list node (cover letter et al). */
export function packetFromListNode(node, job) {
    const user = asRaw(node["user"]) ?? {};
    const profile = asRaw(user["talentProfile"]) ?? {};
    const personal = asRaw(profile["personalData"]) ?? {};
    const location = asRaw(personal["location"]) ?? {};
    const aggregates = asRaw(profile["profileAggregates"]) ?? {};
    const preferences = asRaw(profile["preferences"]) ?? {};
    const terms = asRaw(node["terms"]) ?? {};
    const rate = asRaw(terms["chargeRate"]);
    const room = asRaw(node["room"]);
    const status = asRaw(node["status"]) ?? {};
    const topRated = aggregates["topRatedPlusStatus"] === true
        ? "Top Rated Plus"
        : aggregates["topRatedStatus"] === true
            ? "Top Rated"
            : undefined;
    const skills = Array.isArray(profile["skills"])
        ? profile["skills"]
            .map((skill) => asRaw(skill)?.["prettyName"])
            .filter((name) => typeof name === "string")
            .slice(0, 15)
        : [];
    const milestones = Array.isArray(asRaw(node["projectPlan"])?.["milestones"])
        ? asRaw(node["projectPlan"])["milestones"]
            .map((milestone) => asRaw(milestone))
            .filter((milestone) => milestone !== null)
            .map((milestone) => ({
            description: strOf(milestone["description"]),
            ...(strOf(milestone["dueDate"]).length > 0 ? { dueDate: strOf(milestone["dueDate"]) } : {}),
            ...(milestone["amount"] !== undefined ? { amount: numOf(milestone["amount"]) } : {}),
        }))
        : [];
    const questionsAnswers = Array.isArray(node["questionsAnswers"])
        ? node["questionsAnswers"]
            .map((qa) => asRaw(qa))
            .filter((qa) => qa !== null)
            .map((qa) => ({ question: strOf(qa["question"]), answer: strOf(qa["answer"]) }))
        : [];
    const attachments = Array.isArray(node["attachments"])
        ? node["attachments"]
            .map((entry) => asRaw(entry))
            .filter((entry) => entry !== null)
            .map((entry) => ({
            name: strOf(entry["name"] ?? entry["fileName"]),
            link: strOf(entry["link"]),
            size: numOf(entry["size"] ?? entry["fileSize"]),
        }))
        : [];
    const locationText = [location["city"], location["country"]]
        .filter((part) => typeof part === "string" && part.length > 0)
        .join(", ");
    const showJss = preferences["hideJss"] !== true && typeof aggregates["nSS100BwScore"] === "number";
    return {
        id: strOf(node["id"]),
        job,
        coverLetter: strOf(node["coverLetter"]),
        ...(rate?.["rawValue"] !== undefined
            ? { rate: `${String(rate["rawValue"])} ${strOf(rate["currency"])}`.trim() }
            : {}),
        status: strOf(status["status"]),
        ...(room?.["id"] ? { roomId: strOf(room["id"]) } : {}),
        ...(locationText.length > 0 ? { location: locationText } : {}),
        ...(showJss ? { jss: numOf(aggregates["nSS100BwScore"]) } : {}),
        ...(topRated ? { topRated } : {}),
        ...(aggregates["totalHours"] !== undefined ? { totalHours: numOf(aggregates["totalHours"]) } : {}),
        skills,
        milestones,
        questionsAnswers,
        attachments,
    };
}
