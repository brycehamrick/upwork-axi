import { AxiError } from "axi-sdk-js";
import type { BrowserContext, Page } from "playwright-core";
import { ensureDaemon, connectDaemon, type DaemonDeps, type DaemonConnection } from "./daemon.js";
import { classifyUrl } from "./session.js";
import { CLIENT_URL } from "./runners.js";

/**
 * In-page transport for Upwork's own web-app APIs, adapted from the
 * manychat-axi appfetch pattern.
 *
 * The Playwright-controlled browser (already authenticated via the
 * persistent profile) performs the fetches from inside an app page -
 * the browser session stays the only client; cookies are never exported.
 *
 * Upwork's web app talks to its GraphQL endpoint
 * (https://www.upwork.com/api/graphql/v1) and its REST surface
 * (/api/v3/...) with a family of per-surface scoped OAuth tokens
 * (authorization: bearer oauth2v2_int_...) minted client-side. Replaying
 * one surface's token against another operation fails with oauth2 scope
 * errors, so the capture records headers **per GraphQL alias** (the
 * `?alias=` the app appends) and **per REST path prefix**, and `gql`/`get`
 * replay the matching set. When an alias has not been observed yet, a
 * domain-supplied `surface` URL navigates the page so the app fires (and
 * we capture) the right token, then the request retries.
 *
 * Tokens and headers live in memory for the duration of one command and
 * are never persisted. Cookie headers are dropped - the browser
 * re-attaches cookies per CORS policy, exactly like the app's own traffic.
 */

/**
 * Default endpoint used when traffic has not been observed yet. The
 * capture step replaces it with whatever the app actually calls.
 */
export const GRAPHQL_URL = "https://www.upwork.com/api/graphql/v1";

/** The messages app - the surface that mints rooms REST tokens. */
export const MESSAGES_SURFACE_URL = "https://www.upwork.com/ab/messages/rooms/";

const UPWORK_HOST = /(^|\.)upwork\.com$/i;

/** True for GraphQL documents served from an upwork.com host (e.g. /api/graphql/v1). */
export function isGraphqlUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return UPWORK_HOST.test(url.hostname) && /\/graphql(\/v\d+)?\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

const ORG_IN_URL = /[?&](?:callerOrgId|orgId)=(\d{6,})/;
const ORG_IN_BODY = /"teamId"\s*:\s*"(\d{6,})"/;

/** Extract the org id from an observed request URL or JSON body. */
export function orgIdFromRequest(url: string, body: string | null): string | undefined {
  const fromUrl = ORG_IN_URL.exec(url)?.[1];
  if (fromUrl) return fromUrl;
  if (body) return ORG_IN_BODY.exec(body)?.[1];
  return undefined;
}

/** Headers that must never be replayed manually (hop-by-hop / forbidden / tracing). */
const SKIP_HEADERS = new Set([
  "content-length",
  "host",
  "accept-encoding",
  "connection",
  "cookie",
  "user-agent",
  "origin",
  "referer",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-dest",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-ch-ua-full-version-list",
  "sec-ch-viewport-width",
  // per-request tracing ids: replaying stale ones only confuses telemetry
  "vnd-eo-span-id",
  "vnd-eo-parent-span-id",
  "vnd-eo-trace-id",
]);

export interface AppApi {
  /**
   * Run one GraphQL document; returns the `data` payload. `opts.alias` is
   * the app's own `?alias=` for the operation family (the token scope
   * unit); `opts.surface` navigates there first when the alias's token
   * has not been captured yet.
   */
  gql(
    query: string,
    variables: Record<string, unknown>,
    opts?: { alias?: string; surface?: string | (() => string) },
  ): Promise<Record<string, unknown>>;
  /**
   * Same-origin REST GET against the app's /api surface, authenticated by
   * the matching captured token (or navigated to `surface` to mint one).
   */
  get(
    path: string,
    params?: Record<string, string | number>,
    opts?: { surface?: string | (() => string) },
  ): Promise<unknown>;
  /** The client organization id observed from live app traffic. */
  orgId(): string;
}

async function inPageFetch(req: {
  url: string;
  headers: Record<string, string>;
  body: string;
}): Promise<{ status: number; text: string }> {
  const response = await fetch(req.url, {
    method: "POST",
    credentials: "include",
    headers: req.headers,
    body: req.body,
  });
  return { status: response.status, text: await response.text() };
}

async function inPageGet(req: {
  url: string;
  headers: Record<string, string>;
}): Promise<{ status: number; text: string }> {
  const response = await fetch(req.url, {
    method: "GET",
    credentials: "include",
    headers: req.headers,
  });
  return { status: response.status, text: await response.text() };
}

export interface RequestLike {
  url(): string;
  headers(): Record<string, string>;
  postData?(): string | null;
}

export interface ContextLike {
  on(event: "request", handler: (request: RequestLike) => void): void;
  off(event: "request", handler: (request: RequestLike) => void): void;
}

export interface AppContext {
  /** Bare GraphQL endpoint (no ?alias). */
  endpoint: string;
  /** GraphQL alias (the ?alias= value) -> replayable headers. */
  aliases: Map<string, Record<string, string>>;
  /** REST path prefix (first three segments, e.g. /api/v3/rooms) -> headers. */
  rest: Map<string, Record<string, string>>;
  orgId?: string;
}

function safePostData(request: RequestLike): string | null {
  try {
    return request.postData?.() ?? null;
  } catch {
    return null;
  }
}

function replayableHeaders(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!SKIP_HEADERS.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

/** REST prefix key: "/api/v3/rooms/rooms/x" -> "/api/v3/rooms". */
export function restPrefixKey(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return `/${segments.slice(0, 3).join("/")}`;
}

function graphqlAlias(url: string): string {
  try {
    return new URL(url).searchParams.get("alias") ?? "(none)";
  } catch {
    return "(none)";
  }
}

function isAppApiRest(raw: string): boolean {
  try {
    const url = new URL(raw);
    return UPWORK_HOST.test(url.hostname) && /^\/api\/v\d+\//.test(url.pathname);
  } catch {
    return false;
  }
}

export interface CaptureWants {
  /** Resolve early once this GraphQL alias is captured. */
  alias?: string;
  /** Resolve early once this REST prefix is captured. */
  restPrefix?: string;
}

/**
 * Observe the app's own traffic and build the per-surface header map.
 * Resolves once the `want` target (or, absent one, the first GraphQL
 * alias) and the org id are both seen - or at the deadline with whatever
 * was observed.
 */
export function captureAppContext(
  context: ContextLike,
  page: Pick<Page, "url" | "reload" | "waitForTimeout">,
  opts: { timeoutMs?: number; nudgeMs?: number; want?: CaptureWants } = {},
): Promise<AppContext> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const nudgeMs = opts.nudgeMs ?? 2_500;
  return new Promise<AppContext>((resolve, reject) => {
    let settled = false;
    const captured: AppContext = {
      endpoint: GRAPHQL_URL,
      aliases: new Map(),
      rest: new Map(),
    };
    const satisfied = (): boolean =>
      captured.orgId !== undefined &&
      (opts.want
        ? (opts.want.alias === undefined || captured.aliases.has(opts.want.alias)) &&
          (opts.want.restPrefix === undefined || captured.rest.has(opts.want.restPrefix))
        : captured.aliases.size > 0);
    const tryFinish = (): void => {
      if (satisfied()) finish(() => resolve(snapshot(captured)));
    };
    const handler = (request: RequestLike): void => {
      const url = request.url();
      captured.orgId ??= orgIdFromRequest(url, safePostData(request));
      if (isGraphqlUrl(url)) {
        try {
          const parsed = new URL(url);
          captured.endpoint = `${parsed.origin}${parsed.pathname}`;
        } catch {
          // keep the default endpoint
        }
        captured.aliases.set(graphqlAlias(url), replayableHeaders(request.headers()));
        tryFinish();
        return;
      }
      if (isAppApiRest(url)) {
        try {
          const parsed = new URL(url);
          captured.rest.set(restPrefixKey(parsed.pathname), replayableHeaders(request.headers()));
        } catch {
          // not a capturable URL
        }
        tryFinish();
      }
    };
    const failTimer = setTimeout(
      () =>
        finish(() => {
          if (captured.aliases.size > 0) resolve(snapshot(captured));
          else
            reject(
              new AxiError(
                `no GraphQL traffic observed within ${timeoutMs}ms - cannot capture auth headers`,
                "AUTH_ERROR",
                ["Run `upwork-axi auth login` to refresh the session, then retry"],
              ),
            );
        }),
      timeoutMs,
    );
    const nudgeTimer = setTimeout(() => {
      if (settled) return;
      // Reload the idle page to trigger its request burst. A stale tab can
      // still show an app URL after the session died - the reload is where
      // a logout actually reveals itself, so fail fast there.
      void page
        .reload({ waitUntil: "domcontentloaded" })
        .then(() => page.waitForTimeout(1500))
        .then(() => {
          if (settled) return;
          if (classifyUrl(page.url()) !== "logged-in") {
            finish(() =>
              reject(
                new AxiError(
                  `the client session is not signed in (landed on ${page.url()})`,
                  "AUTH_ERROR",
                  ["Run `upwork-axi auth login` to log in (visible Chrome, manual), then retry"],
                ),
              ),
            );
          }
        })
        .catch(() => undefined);
    }, nudgeMs);
    function finish(settle: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(failTimer);
      clearTimeout(nudgeTimer);
      context.off("request", handler);
      settle();
    }
    context.on("request", handler);
  });
}

function snapshot(captured: AppContext): AppContext {
  return {
    endpoint: captured.endpoint,
    aliases: new Map(captured.aliases),
    rest: new Map(captured.rest),
    orgId: captured.orgId,
  };
}

function mergeInto(target: AppContext, update: AppContext): void {
  target.endpoint = update.endpoint;
  for (const [key, value] of update.aliases) target.aliases.set(key, value);
  for (const [key, value] of update.rest) target.rest.set(key, value);
  target.orgId ??= update.orgId;
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 200 ? flat : `${flat.slice(0, 200)}…`;
}

function makeApi(
  page: Page,
  context: ContextLike,
  captured: AppContext,
  recapture: (
    surfaceUrl: string | undefined,
    want?: { alias?: string; restPrefix?: string },
  ) => Promise<void>,
): AppApi {
  const CONTEXT_DESTROYED = /Execution context|Target closed|navigation|crashed/i;
  const run = async <T>(fn: () => Promise<T>, retry = true): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!retry || !CONTEXT_DESTROYED.test(message)) throw error;
      // The SPA re-rendered mid-request - let it settle and retry once.
      await page.waitForTimeout(1200);
      return run(fn, false);
    }
  };
  const surfaceUrl = (surface?: string | (() => string)): string | undefined =>
    typeof surface === "function" ? surface() : surface;
  const aliasError = (alias: string): AxiError =>
    new AxiError(
      `the app never sent a request with alias "${alias}" - no captured token for it`,
      "APP_API_ERROR",
      [
        `Captured aliases: ${[...captured.aliases.keys()].join(", ") || "(none)"}`,
        "Pass a surface URL that triggers this operation, or re-run discover to map it",
      ],
    );
  return {
    orgId(): string {
      if (captured.orgId === undefined) {
        throw new AxiError(
          "the client organization id was not observed in app traffic",
          "APP_API_ERROR",
          ["Open the Upwork dashboard in the browser once (`upwork-axi browser open`), then retry"],
        );
      }
      return captured.orgId;
    },
    async gql(query, variables, opts = {}) {
      const alias = opts.alias ?? "(none)";
      let headers = captured.aliases.get(alias);
      if (headers === undefined) {
        const surface = surfaceUrl(opts.surface);
        if (surface !== undefined) {
          await recapture(surface, { alias });
          headers = captured.aliases.get(alias);
        }
        if (headers === undefined) throw aliasError(alias);
      }
      const url = alias === "(none)" ? captured.endpoint : `${captured.endpoint}?alias=${alias}`;
      const response = await run(() =>
        page.evaluate<{ status: number; text: string }, { url: string; headers: Record<string, string>; body: string }>(
          inPageFetch,
          { url, headers, body: JSON.stringify({ query, variables }) },
        ),
      );
      return checkGraphql(response, "GraphQL");
    },
    async get(path, params, opts = {}) {
      const key = restPrefixKey(path);
      let headers = captured.rest.get(key);
      if (headers === undefined) {
        const surface = surfaceUrl(opts.surface);
        if (surface !== undefined) {
          await recapture(surface, { restPrefix: key });
          headers = captured.rest.get(key);
        }
        if (headers === undefined) {
          throw new AxiError(
            `no captured token for REST prefix ${key}`,
            "APP_API_ERROR",
            [`Captured prefixes: ${[...captured.rest.keys()].join(", ") || "(none)"}`],
          );
        }
      }
      const query = params
        ? `?${new URLSearchParams(
            Object.entries(params).map(([k, v]) => [k, String(v)] as [string, string]),
          ).toString()}`
        : "";
      const response = await run(() =>
        page.evaluate<{ status: number; text: string }, { url: string; headers: Record<string, string> }>(inPageGet, {
          url: `${path}${query}`,
          headers,
        }),
      );
      if (response.status === 401 || response.status === 403) {
        throw new AxiError(
          `Upwork rejected the session (HTTP ${response.status} on ${path})`,
          "AUTH_ERROR",
          ["Run `upwork-axi auth login` to refresh the browser session"],
        );
      }
      if (response.status !== 200) {
        throw new AxiError(
          `REST HTTP ${response.status} on ${path}: ${snippet(response.text)}`,
          "APP_API_ERROR",
          ["Retry; if it persists, the internal API shape may have changed (re-run discover)"],
        );
      }
      try {
        return JSON.parse(response.text) as unknown;
      } catch {
        throw new AxiError(`REST returned non-JSON on ${path}: ${snippet(response.text)}`, "APP_API_ERROR");
      }
    },
  };

  function checkGraphql(response: { status: number; text: string }, label: string): Record<string, unknown> {
    if (response.status === 401 || response.status === 403) {
      throw new AxiError(
        `Upwork rejected the session (HTTP ${response.status})`,
        "AUTH_ERROR",
        ["Run `upwork-axi auth login` to refresh the browser session"],
      );
    }
    if (response.status !== 200) {
      throw new AxiError(
        `${label} HTTP ${response.status}: ${snippet(response.text)}`,
        "APP_API_ERROR",
        ["Retry; if it persists, the internal API shape may have changed (re-run discover)"],
      );
    }
    let parsed: { data?: unknown; errors?: Array<{ message?: string }> };
    try {
      parsed = JSON.parse(response.text) as { data?: unknown; errors?: Array<{ message?: string }> };
    } catch {
      throw new AxiError(`${label} returned non-JSON: ${snippet(response.text)}`, "APP_API_ERROR");
    }
    const firstError = parsed.errors?.[0]?.message;
    if (firstError !== undefined) {
      throw new AxiError(`GraphQL error: ${snippet(firstError)}`, "APP_API_ERROR", [
        "The query may have drifted from the live schema - re-run discover and re-extract",
      ]);
    }
    if (typeof parsed.data !== "object" || parsed.data === null) {
      throw new AxiError("GraphQL returned no data payload", "APP_API_ERROR");
    }
    return parsed.data as Record<string, unknown>;
  }
}

/** An authenticated app page is a valid surface for in-page fetches. */
function isAppPageUrl(raw: string): boolean {
  return classifyUrl(raw) === "logged-in";
}

/** Give client-side redirects a moment to land, then report the final URL. */
async function settleForRedirect(page: Page): Promise<string> {
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(500);
    const current = page.url();
    if (isAppPageUrl(current)) return current;
  }
  return page.url();
}

/**
 * Ensure the daemon, land on the app, capture the per-surface token map
 * from live traffic, run `fn` with an AppApi, then disconnect. Tokens
 * live only in memory for the duration of the call.
 */
export async function withAppApi<T>(
  stateDir: string,
  deps: DaemonDeps,
  fn: (api: AppApi) => Promise<T>,
): Promise<T> {
  await ensureDaemon(stateDir, deps);
  const conn: DaemonConnection = await connectDaemon(stateDir, deps);
  try {
    if (!isAppPageUrl(conn.page.url())) {
      await conn.page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
    // Logged-out sessions bounce app URLs to a marketing or login page -
    // fail fast instead of waiting out the traffic timeout.
    if (!isAppPageUrl(conn.page.url())) {
      const settled = await settleForRedirect(conn.page);
      if (!isAppPageUrl(settled)) {
        throw new AxiError(
          `the client session is not signed in (landed on ${settled})`,
          "AUTH_ERROR",
          ["Run `upwork-axi auth login` to log in (visible Chrome, manual), then retry"],
        );
      }
    }
    const context = conn.context as unknown as ContextLike;
    const captured = await captureAppContext(context, conn.page);
    if (captured.orgId === undefined) {
      // The current surface never mentioned the org id - the dashboard
      // burst always carries it (relations + rooms traffic).
      await conn.page
        .goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
        .catch(() => undefined);
      const update = captureAppContext(context, conn.page, { timeoutMs: 15_000 });
      mergeInto(captured, await update);
      await conn.page.waitForTimeout(500);
    }
    const recapture = async (
      surfaceUrl: string | undefined,
      want?: { alias?: string; restPrefix?: string },
    ): Promise<void> => {
      // Attach the listener first so the navigation burst is observed in
      // full; the nudge-reload cache-busts when the SPA skips refetching.
      const update = captureAppContext(context, conn.page, {
        timeoutMs: 18_000,
        nudgeMs: 6_000,
        ...(want ? { want } : {}),
      });
      const target = surfaceUrl ?? conn.page.url();
      if (isAppPageUrl(target)) {
        await conn.page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
      }
      mergeInto(captured, await update);
      // Let the SPA settle so evaluate() runs against a stable context.
      await conn.page.waitForTimeout(500);
    };
    await conn.page.waitForTimeout(500);
    return await fn(makeApi(conn.page, context, captured, recapture));
  } finally {
    await conn.disconnect();
  }
}

/** Test seam: build an AppApi over a fake page with canned fetch results. */
export function appApiForTest(
  page: Page,
  headers: Record<string, string> = {},
  org = "678320150802239488",
): AppApi {
  const aliases = [
    "(none)",
    "clientProposalsByFilter",
    "gql-query-clientdashboardrelations",
    "proposalsStatistics",
  ];
  const captured: AppContext = {
    endpoint: GRAPHQL_URL,
    aliases: new Map(aliases.map((alias) => [alias, headers])),
    rest: new Map([["/api/v3/rooms", { ...headers, accept: "application/json" }]]),
    orgId: org,
  };
  return makeApi(
    page,
    { on: () => undefined, off: () => undefined },
    captured,
    async () => undefined,
  );
}

export type { BrowserContext };
