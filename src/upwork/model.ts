/**
 * Canonical summarizers over the raw GraphQL/REST payloads: job postings,
 * proposals, and message rooms/stories. Pure functions - unit-testable
 * without a browser.
 */

export interface JobRow {
  ref: string;
  title: string;
  status: string;
  proposals: number;
  unread: number;
  shortlisted: number;
  hired: number;
  messaged: number;
  roomId?: string;
}

type Raw = Record<string, unknown>;

function asRaw(value: unknown): Raw | null {
  return typeof value === "object" && value !== null ? (value as Raw) : null;
}

function numOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function strOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Open job postings from clientDashboardRelations (any relation filter). */
export function jobRowsFromRelations(payload: unknown): {
  jobs: JobRow[];
  counts: Record<string, number>;
} {
  const root = asRaw(asRaw(payload)?.["clientDashboardRelations"]);
  const relations = Array.isArray(root?.["relations"]) ? (root["relations"] as unknown[]) : [];
  const jobs: JobRow[] = [];
  for (const relation of relations) {
    const opening = asRaw(asRaw(relation)?.["opening"]);
    if (!opening) continue;
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
  const counts: Record<string, number> = {};
  const rawCounts = asRaw(root?.["filterTotalCounts"]);
  for (const [key, value] of Object.entries(rawCounts ?? {})) {
    if (typeof value === "number") counts[key] = value;
  }
  return { jobs, counts };
}

export interface ProposalRow {
  id: string;
  name: string;
  title: string;
  location?: string;
  rate?: string;
  status: string;
  roomId?: string;
  jss?: number;
  topRated?: string;
  totalHours?: number;
  vetted?: boolean;
}

function proposalRow(node: Raw): ProposalRow {
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
  const topRated =
    aggregates["topRatedPlusStatus"] === true
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
export function proposalRowsFromFilter(payload: unknown): {
  total: number;
  hasNextPage: boolean;
  endCursor: string;
  rows: ProposalRow[];
} {
  const root = asRaw(asRaw(payload)?.["clientProposalsByFilter"]);
  const edges = Array.isArray(root?.["edges"]) ? (root["edges"] as unknown[]) : [];
  const pageInfo = asRaw(root?.["pageInfo"]);
  return {
    total: numOf(root?.["totalCount"]),
    hasNextPage: pageInfo?.["hasNextPage"] === true,
    endCursor: strOf(pageInfo?.["endCursor"]),
    rows: edges
      .map((edge) => asRaw(asRaw(edge)?.["node"]))
      .filter((node): node is Raw => node !== null)
      .map(proposalRow),
  };
}

/** Pipeline counts from proposalsStatistics. */
export function statsFromStatistics(payload: unknown): Record<string, number> {
  const root = asRaw(asRaw(payload)?.["proposalsStatistics"]);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(root ?? {})) {
    if (typeof value === "number") out[key] = value;
  }
  return out;
}

export interface RoomRow {
  roomId: string;
  name: string;
  topic?: string;
  unread: number;
  recentTimestamp?: number;
  jobUid?: string;
}

/** Room rows from GET /api/v3/rooms/rooms/simplified. */
export function roomRowsFromSimplified(payload: unknown): RoomRow[] {
  const rooms = Array.isArray(asRaw(payload)?.["rooms"])
    ? ((asRaw(payload) as Raw)["rooms"] as unknown[])
    : [];
  return rooms
    .map((room) => asRaw(room))
    .filter((room): room is Raw => room !== null)
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

export interface StoryRow {
  storyId: string;
  role: "out" | "in" | "system";
  at: string;
  body: string;
}

/**
 * Stories from GET /api/v3/rooms/rooms/<id>/stories/simplified (oldest
 * first). Roles are org-scoped: any story authored by the client
 * organization is "out" (covers teammates), everything else "in".
 */
export function storiesFromSimplified(
  payload: unknown,
  myOrgId: string,
): { total: number; cursor: string; stories: StoryRow[] } {
  const root = asRaw(payload);
  const rawStories = Array.isArray(root?.["stories"]) ? (root["stories"] as unknown[]) : [];
  const stories = rawStories
    .map((story) => asRaw(story))
    .filter((story): story is Raw => story !== null)
    .map((story) => {
      const system = numOf(story["isSystemStory"]) === 1;
      const createdMs = numOf(story["created"]);
      const orgId = strOf(story["orgId"]);
      return {
        storyId: strOf(story["storyId"]),
        role: system ? "system" : orgId === myOrgId ? "out" : "in",
        at: createdMs > 0 ? new Date(createdMs).toISOString() : "",
        body: strOf(story["message"]),
      } satisfies StoryRow;
    })
    .filter((story) => story.storyId.length > 0);
  return {
    total: numOf(root?.["total"]),
    cursor: strOf(root?.["cursor"]),
    stories,
  };
}

/** Unread-per-applicant map from GET /api/v3/rooms/users/jobs/<id>/unreadCountsPerApplicant. */
export function unreadCountsFromApplicants(payload: unknown): Record<string, number> {
  const root = asRaw(payload);
  const records = Array.isArray(root?.["records"]) ? (root["records"] as unknown[]) : [];
  const out: Record<string, number> = {};
  for (const record of records) {
    const entry = asRaw(record);
    if (!entry) continue;
    const key = strOf(entry["applicantUserId"] ?? entry["userId"] ?? entry["cipherText"]);
    if (key.length > 0) out[key] = numOf(entry["unreadCount"] ?? entry["count"]);
  }
  return out;
}

export function formatTimestamp(ms: number): string {
  return ms > 0 ? new Date(ms).toISOString() : "";
}

/** The client-side user of a room from GET /api/v3/rooms/rooms/<id>/users. */
export function meFromRoomUsers(payload: unknown, orgId: string): string | undefined {
  const users = Array.isArray(asRaw(payload)?.["users"])
    ? ((asRaw(payload) as Raw)["users"] as unknown[])
    : [];
  for (const user of users) {
    const entry = asRaw(user);
    if (entry && strOf(entry["orgId"]) === orgId) return strOf(entry["userId"]);
  }
  return undefined;
}

/** The client-generated messageId for a story send: <userId>-<epoch>-<rand4>. */
export function buildMessageId(userId: string, nowMs: number, rand: number): string {
  return `${userId}-${nowMs}-${rand}`;
}

/* ------------------------------------------------------------------ */
/* Proposal packets (from the list query's rich nodes)                 */
/* ------------------------------------------------------------------ */

export interface ProposalPacket {
  id: string;
  job: { ref: string; title: string };
  coverLetter: string;
  rate?: string;
  status?: string;
  roomId?: string;
  location?: string;
  jss?: number;
  topRated?: string;
  totalHours?: number;
  skills: string[];
  milestones: Array<{ description: string; dueDate?: string; amount?: number }>;
  questionsAnswers: Array<{ question: string; answer: string }>;
  attachments: Array<{ name: string; link: string; size: number }>;
}

/** Full packet from a clientProposalsByFilter list node (cover letter et al). */
export function packetFromListNode(
  node: Raw,
  job: { ref: string; title: string },
): ProposalPacket {
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
  const topRated =
    aggregates["topRatedPlusStatus"] === true
      ? "Top Rated Plus"
      : aggregates["topRatedStatus"] === true
        ? "Top Rated"
        : undefined;
  const skills = Array.isArray(profile["skills"])
    ? (profile["skills"] as unknown[])
        .map((skill) => asRaw(skill)?.["prettyName"])
        .filter((name): name is string => typeof name === "string")
        .slice(0, 15)
    : [];
  const milestones = Array.isArray(asRaw(node["projectPlan"])?.["milestones"])
    ? ((asRaw(node["projectPlan"]) as Raw)["milestones"] as unknown[])
        .map((milestone) => asRaw(milestone))
        .filter((milestone): milestone is Raw => milestone !== null)
        .map((milestone) => ({
          description: strOf(milestone["description"]),
          ...(strOf(milestone["dueDate"]).length > 0 ? { dueDate: strOf(milestone["dueDate"]) } : {}),
          ...(milestone["amount"] !== undefined ? { amount: numOf(milestone["amount"]) } : {}),
        }))
    : [];
  const questionsAnswers = Array.isArray(node["questionsAnswers"])
    ? (node["questionsAnswers"] as unknown[])
        .map((qa) => asRaw(qa))
        .filter((qa): qa is Raw => qa !== null)
        .map((qa) => ({ question: strOf(qa["question"]), answer: strOf(qa["answer"]) }))
    : [];
  const attachments = Array.isArray(node["attachments"])
    ? (node["attachments"] as unknown[])
        .map((entry) => asRaw(entry))
        .filter((entry): entry is Raw => entry !== null)
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
