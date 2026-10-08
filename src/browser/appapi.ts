import { AxiError } from "axi-sdk-js";
import type { BrowserContext, Page } from "playwright-core";
import { ensureDaemon, connectDaemon, type DaemonDeps, type DaemonConnection } from "./daemon.js";
import { classifyUrl } from "./session.js";
import { CLIENT_URL } from "./runners.js";

/**
 * In-page GraphQL transport for Upwork's own web-app API, adapted from
 * the manychat-axi appfetch pattern.
 *
 * The Playwright-controlled browser (already authenticated via the
 * persistent profile) performs the fetches from inside an app page -
 * the browser session stays the only client; cookies are never exported.
 *
 * The web app's GraphQL endpoint is observed from live traffic rather
 * than hardcoded: at connect time we sniff the endpoint URL and the
 * exact headers the app itself sends (reloading the page to trigger its
 * request burst when needed), keep both in memory for the duration of
 * one command, and replay them from in-page fetches. Cookie headers are
 * dropped - the browser re-attaches cookies per CORS policy, exactly
 * like the app's own traffic.
 */

/**
 * Default endpoint used when traffic has not been observed yet. The
 * capture step replaces it with whatever the app actually calls.
 */
export const GRAPHQL_URL = "https://www.upwork.com/graphql";

const UPWORK_HOST = /(^|\.)upwork\.com$/i;

/** True for GraphQL documents served from an upwork.com host. */
export function isGraphqlUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return UPWORK_HOST.test(url.hostname) && /\/graphql\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export interface CapturedGraphql {
  url: string;
  headers: Record<string, string>;
}

/** Headers that must never be replayed manually (hop-by-hop / forbidden). */
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
]);

export interface AppApi {
  /** Run one GraphQL document; returns the `data` payload. */
  gql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>>;
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

export interface RequestLike {
  url(): string;
  headers(): Record<string, string>;
}

export interface ContextLike {
  on(event: "request", handler: (request: RequestLike) => void): void;
  off(event: "request", handler: (request: RequestLike) => void): void;
}

/**
 * Capture the GraphQL endpoint URL and auth headers the app itself uses.
 * If nothing is observed within `nudgeMs` and the page is idle on the
 * app, reload it to trigger the SPA's request burst.
 */
export function captureGraphqlHeaders(
  context: ContextLike,
  page: Pick<Page, "url" | "reload" | "waitForTimeout">,
  opts: { timeoutMs?: number; nudgeMs?: number } = {},
): Promise<CapturedGraphql> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const nudgeMs = opts.nudgeMs ?? 2_500;
  return new Promise<CapturedGraphql>((resolve, reject) => {
    let settled = false;
    const handler = (request: RequestLike): void => {
      const url = request.url();
      if (!isGraphqlUrl(url)) return;
      const headers = { ...request.headers() };
      for (const name of Object.keys(headers)) {
        if (SKIP_HEADERS.has(name.toLowerCase())) delete headers[name];
      }
      finish(() => resolve({ url, headers }));
    };
    const failTimer = setTimeout(
      () =>
        finish(() =>
          reject(
            new AxiError(
              `no GraphQL traffic observed within ${timeoutMs}ms - cannot capture auth headers`,
              "AUTH_ERROR",
              ["Run `upwork-axi auth login` to refresh the session, then retry"],
            ),
          ),
        ),
      timeoutMs,
    );
    const nudgeTimer = setTimeout(() => {
      if (settled) return;
      // Reload the idle dashboard to trigger its GraphQL burst. A stale tab
      // can still show an app URL after the session died - the reload
      // is where a logout actually reveals itself, so fail fast there.
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

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 200 ? flat : `${flat.slice(0, 200)}…`;
}

function makeApi(page: Page, endpoint: string, headers: Record<string, string>): AppApi {
  const CONTEXT_DESTROYED = /Execution context|Target closed|navigation|crashed/i;
  return {
    async gql(query, variables) {
      let response: { status: number; text: string };
      const attempt = async () =>
        page.evaluate<
          { status: number; text: string },
          { url: string; headers: Record<string, string>; body: string }
        >(inPageFetch, {
          url: endpoint,
          headers,
          body: JSON.stringify({ query, variables }),
        });
      try {
        try {
          response = await attempt();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!CONTEXT_DESTROYED.test(message)) throw error;
          // The dashboard SPA re-rendered mid-request - let it settle and retry once.
          await page.waitForTimeout(1200);
          response = await attempt();
        }
      } catch (error) {
        throw new AxiError(
          `GraphQL request failed before the server responded: ${
            error instanceof Error ? error.message : String(error)
          }`,
          "APP_API_ERROR",
          ["The browser session may have closed; rerun the command"],
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new AxiError(
          `Upwork rejected the session (HTTP ${response.status})`,
          "AUTH_ERROR",
          ["Run `upwork-axi auth login` to refresh the browser session"],
        );
      }
      if (response.status !== 200) {
        throw new AxiError(
          `GraphQL HTTP ${response.status}: ${snippet(response.text)}`,
          "APP_API_ERROR",
          ["Retry; if it persists, the internal API shape may have changed (re-run discover)"],
        );
      }
      let parsed: { data?: unknown; errors?: Array<{ message?: string }> };
      try {
        parsed = JSON.parse(response.text) as { data?: unknown; errors?: Array<{ message?: string }> };
      } catch {
        throw new AxiError(
          `GraphQL returned non-JSON: ${snippet(response.text)}`,
          "APP_API_ERROR",
        );
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
    },
  };
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
 * Ensure the daemon, land on the app, capture the GraphQL endpoint and
 * auth headers from live traffic, run `fn` with an AppApi, then
 * disconnect. Both live only in memory for the duration of the call.
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
    const captured = await captureGraphqlHeaders(context, conn.page);
    // Let the SPA settle after whatever navigation produced the captured
    // request (reloads destroy execution contexts mid-evaluate otherwise).
    await conn.page
      .waitForLoadState("networkidle", { timeout: 8_000 })
      .catch(() => undefined);
    await conn.page.waitForTimeout(500);
    return await fn(makeApi(conn.page, captured.url, captured.headers));
  } finally {
    await conn.disconnect();
  }
}

/** Test seam: build an AppApi over a fake page with canned fetch results. */
export function appApiForTest(page: Page, headers: Record<string, string> = {}): AppApi {
  return makeApi(page, GRAPHQL_URL, headers);
}

export type { BrowserContext };
