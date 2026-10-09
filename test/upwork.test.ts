import { describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { appApiForTest } from "../src/browser/appapi.js";
import {
  isGraphqlUrl,
  orgIdFromRequest,
  restPrefixKey,
} from "../src/browser/appapi.js";
import {
  jobRowsFromRelations,
  meFromRoomUsers,
  buildMessageId,
  proposalRowsFromFilter,
  packetFromListNode,
  statsFromStatistics,
  roomRowsFromSimplified,
  storiesFromSimplified,
} from "../src/upwork/model.js";

const ORG = "678320150802239488";
const ME = "678320150166175744";

/** A page whose evaluate() routes GraphQL POSTs and REST GETs to fakes. */
function pageWithRoutes(
  routes: Array<{
    match: string | ((url: string) => boolean);
    status?: number;
    body: () => unknown;
  }>,
): Page {
  return {
    evaluate: async (_fn: unknown, arg: { url: string; body?: string }) => {
      const url = arg.url;
      for (const route of routes) {
        const hit =
          typeof route.match === "function"
            ? route.match(url)
            : url.includes(route.match) ||
              (arg.body ?? "").includes(route.match);
        if (hit) {
          return { status: route.status ?? 200, text: JSON.stringify(route.body()) };
        }
      }
      return { status: 200, text: JSON.stringify({ data: null, errors: [{ message: "no route" }] }) };
    },
    waitForTimeout: async () => undefined,
  } as unknown as Page;
}

describe("appapi helpers", () => {
  it("matches the v1 graphql endpoint and aliases", () => {
    expect(isGraphqlUrl("https://www.upwork.com/api/graphql/v1?alias=x")).toBe(true);
    expect(isGraphqlUrl("https://www.upwork.com/graphql")).toBe(true);
    expect(isGraphqlUrl("https://www.upwork.com/api/v3/rooms/rooms/simplified")).toBe(false);
    expect(isGraphqlUrl("https://evil.com/api/graphql/v1")).toBe(false);
  });

  it("extracts the org id from urls and bodies", () => {
    expect(orgIdFromRequest(`https://www.upwork.com/x?callerOrgId=${ORG}`, null)).toBe(ORG);
    expect(orgIdFromRequest("https://www.upwork.com/x", `{"teamId":"${ORG}"}`)).toBe(ORG);
    expect(orgIdFromRequest("https://www.upwork.com/x", null)).toBeUndefined();
  });

  it("derives rest prefix keys", () => {
    expect(restPrefixKey("/api/v3/rooms/rooms/room_1/stories/simplified")).toBe("/api/v3/rooms");
    expect(restPrefixKey("/api/v3/rooms/users/messageCounts")).toBe("/api/v3/rooms");
  });
});

describe("model: jobs", () => {
  it("summarizes open openings and totals", () => {
    const { jobs, counts } = jobRowsFromRelations({
      clientDashboardRelations: {
        relations: [
          {
            opening: {
              id: "2103617170216336029",
              title: "Photo Editor",
              status: "Open",
              totalProposalsCount: 17,
              unreadProposalsCount: 13,
              shortListedCount: 0,
              hiredTalentsCount: 1,
              messagedCount: 2,
              messagingInfo: { roomId: "room_x", numberOfUnreadMessages: 1 },
            },
          },
          { opening: null, contractFixed: { id: "c1" } },
        ],
        filterTotalCounts: { OPEN_OPENINGS: 1, ACTIVE_CONTRACTS: 6 },
      },
    });
    expect(jobs).toEqual([
      {
        ref: "2103617170216336029",
        title: "Photo Editor",
        status: "Open",
        proposals: 17,
        unread: 13,
        shortlisted: 0,
        hired: 1,
        messaged: 2,
        roomId: "room_x",
      },
    ]);
    expect(counts["OPEN_OPENINGS"]).toBe(1);
    expect(counts["ACTIVE_CONTRACTS"]).toBe(6);
  });
});

describe("model: proposals", () => {
  const payload = {
    clientProposalsByFilter: {
      totalCount: 1,
      pageInfo: { endCursor: "cur1", hasNextPage: false },
      edges: [
        {
          node: {
            id: "2103915344041877505",
            status: { status: "Created", reason: null },
            user: {
              id: "u1",
              name: "Ozz P.",
              talentProfile: {
                personalData: {
                  title: "Photographer",
                  location: { city: "Madrid", country: "Spain", timezone: null },
                },
                skills: [{ uid: "s1", prettyName: "Photography" }],
                profileAggregates: {
                  totalHours: 12.5,
                  nSS100BwScore: 0.9,
                  topRatedStatus: true,
                  topRatedPlusStatus: false,
                },
                preferences: { hideEarnings: false, hideJss: false },
                vetted: true,
              },
            },
            room: { id: "room_9" },
            terms: { chargeRate: { rawValue: 27, currency: "USD" } },
            coverLetter: "Hello",
            projectPlan: { milestones: [{ description: "M1", dueDate: "2026-10-01", amount: 100 }] },
            questionsAnswers: [{ question: "Q?", answer: "A." }],
            attachments: [{ id: "a1", link: "https://f", size: 10, name: "cv.pdf" }],
          },
        },
      ],
    },
  };

  it("summarizes list rows", () => {
    const parsed = proposalRowsFromFilter(payload);
    expect(parsed.total).toBe(1);
    expect(parsed.rows[0]).toMatchObject({
      id: "2103915344041877505",
      name: "Ozz P.",
      title: "Photographer",
      rate: "27 USD",
      status: "Created",
      roomId: "room_9",
      jss: 0.9,
      topRated: "Top Rated",
      location: "Madrid, Spain",
      vetted: true,
    });
  });

  it("builds the full packet from the list node", () => {
    const packet = packetFromListNode(
      payload.clientProposalsByFilter.edges[0].node,
      { ref: "2103617170216336029", title: "Photo Editor" },
    );
    expect(packet.coverLetter).toBe("Hello");
    expect(packet.milestones).toEqual([{ description: "M1", dueDate: "2026-10-01", amount: 100 }]);
    expect(packet.questionsAnswers).toEqual([{ question: "Q?", answer: "A." }]);
    expect(packet.skills).toEqual(["Photography"]);
    expect(packet.attachments[0]).toMatchObject({ name: "cv.pdf", size: 10 });
  });

  it("respects hideJss for the score field", () => {
    const node = payload.clientProposalsByFilter.edges[0].node;
    node.user.talentProfile.preferences.hideJss = true;
    expect(packetFromListNode(node, { ref: "j", title: "t" }).jss).toBeUndefined();
    node.user.talentProfile.preferences.hideJss = false;
  });
});

describe("model: stats, rooms, stories", () => {
  it("summarizes statistics", () => {
    const stats = statsFromStatistics({
      proposalsStatistics: { totalApplicants: 17, totalMessaged: 2, totalHired: 1 },
    });
    expect(stats).toEqual({ totalApplicants: 17, totalMessaged: 2, totalHired: 1 });
  });

  it("summarizes rooms", () => {
    const rooms = roomRowsFromSimplified({
      rooms: [
        {
          roomId: "room_1",
          roomName: "Ghaith",
          topic: "Job",
          numUnread: 2,
          recentTimestamp: 1790644329891,
          jobUid: "2103617170216336029",
        },
        { roomId: "", roomName: "broken" },
      ],
    });
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ roomId: "room_1", name: "Ghaith", unread: 2 });
  });

  it("classifies story roles by org (team-wide out)", () => {
    const { total, stories } = storiesFromSimplified(
      {
        total: 3,
        cursor: "c",
        stories: [
          { storyId: "s1", userId: ME, orgId: ORG, created: 1790644329891, message: "mine", isSystemStory: 0 },
          { storyId: "s2", userId: "teammate", orgId: ORG, created: 1790644329000, message: "carlas", isSystemStory: 0 },
          { storyId: "s3", userId: "fl", orgId: "1607693681280081921", created: 1790644320000, message: "", isSystemStory: 1 },
        ],
      },
      ORG,
    );
    expect(total).toBe(3);
    expect(stories.map((story) => story.role)).toEqual(["out", "out", "system"]);
    expect(stories[0].at).toBe("2026-09-29T01:12:09.891Z");
  });
});

describe("model: send helpers", () => {
  it("finds the client user by org", () => {
    expect(
      meFromRoomUsers(
        { users: [{ userId: "1607693681280081920", orgId: "1607693681280081921", role: "admin" }, { userId: ME, orgId: ORG }] },
        ORG,
      ),
    ).toBe(ME);
    expect(meFromRoomUsers({ users: [] }, ORG)).toBeUndefined();
  });

  it("builds app-shaped message ids", () => {
    expect(buildMessageId(ME, 1791556526860, 6681)).toBe(`${ME}-1791556526860-6681`);
  });
});

describe("appapi round-trip (fake page)", () => {
  it("runs gql with the captured alias token and parses data", async () => {
    const api = appApiForTest(
      pageWithRoutes([
        {
          match: (url) => url.includes("clientProposalsByFilter"),
          body: () => ({ data: { clientProposalsByFilter: { totalCount: 0, edges: [] } } }),
        },
      ]),
      { authorization: "Bearer test-token" },
    );
    const data = await api.gql("query { x }", {}, { alias: "clientProposalsByFilter" });
    expect(data).toEqual({ clientProposalsByFilter: { totalCount: 0, edges: [] } });
    expect(api.orgId()).toBe(ORG);
  });

  it("surfaces graphql errors as APP_API_ERROR", async () => {
    const api = appApiForTest(
      pageWithRoutes([
        {
          match: "brokenQuery",
          body: () => ({ errors: [{ message: "scope denied" }] }),
        },
      ]),
    );
    await expect(api.gql("query brokenQuery { x }", {})).rejects.toMatchObject({
      code: "APP_API_ERROR",
    });
  });

  it("runs same-origin REST gets", async () => {
    const api = appApiForTest(
      pageWithRoutes([
        {
          match: (url) => url.startsWith("/api/v3/rooms/rooms/simplified"),
          body: () => ({ rooms: [{ roomId: "room_1", roomName: "G" }] }),
        },
      ]),
    );
    const payload = (await api.get("/api/v3/rooms/rooms/simplified", { limit: 5 })) as {
      rooms: Array<{ roomId: string }>;
    };
    expect(payload.rooms[0]?.roomId).toBe("room_1");
  });

  it("posts stories with the app's exact body shape", async () => {
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    const api = appApiForTest(
      pageWithRoutes([
        {
          match: (url) => url.startsWith("/api/v3/rooms/rooms/room_1/users"),
          body: () => ({ users: [{ userId: ME, orgId: ORG, role: "admin" }] }),
        },
        {
          match: (url) => url.includes("/stories?"),
          body: () => ({ storyId: "story_9", roomId: "room_1", created: 1791556527157 }),
        },
      ]),
    );
    const originalFetch = api.post.bind(api);
    (api as { post: unknown }).post = async (
      path: string,
      body: Record<string, unknown>,
      params?: Record<string, string | number>,
    ) => {
      posts.push({ url: `${path}?${new URLSearchParams(Object.entries(params ?? {}).map(([k, v]) => [k, String(v)])).toString()}`, body });
      return originalFetch(path, body, params);
    };
    const { sendRoomMessage } = await import("../src/upwork/api.js");
    const sent = await sendRoomMessage(api, "room_1", "hello there");
    expect(sent.storyId).toBe("story_9");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toContain("/api/v3/rooms/rooms/room_1/stories?callerOrgId=");
    expect(posts[0]?.body).toMatchObject({
      roomId: "room_1",
      userId: ME,
      message: "hello there",
      sourceClient: "thunder-web",
      actionType: "eo:post",
      orgId: ORG,
      deleted: false,
      isLocked: false,
    });
    expect(String(posts[0]?.body.messageId)).toMatch(new RegExp(`^${ME}-\\d{13}-\\d{4}$`));
  });
});
