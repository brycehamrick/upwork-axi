import type { AxiRenderable } from "../lib/output.js";
import { parseFlags, type FlagDefinition } from "../lib/args.js";
import { renderResult } from "../lib/output.js";
import { profileExists, readSessionRecord } from "../browser/session.js";
import type { CommandContext, DaemonProbeInfo } from "../context.js";

const HOME_FLAGS: Record<string, FlagDefinition> = {
  json: { type: "boolean" },
};

/**
 * AXI principle 8: bare invocation is live content - session state, daemon
 * state, and next steps. It reads files and (cheaply) probes the daemon's
 * DevTools endpoint; it never launches a browser.
 */
export async function homeCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const { values } = parseFlags(args, "upwork-axi", HOME_FLAGS);
  const json = values["json"] === true;

  const record = readSessionRecord(ctx.stateDir);
  const daemon = await ctx.daemon.probe().catch((): DaemonProbeInfo => ({ running: false }));

  return renderResult(
    {
      auth: {
        browser_session: {
          profile: profileExists(ctx.stateDir) ? "present" : "missing",
          last_login: record?.lastLogin ?? null,
          ...(record ? { last_url: record.url } : {}),
        },
      },
      browser: daemon.running
        ? {
            running: true,
            port: daemon.port,
            pid: daemon.pid,
            ...(daemon.browserVersion ? { version: daemon.browserVersion } : {}),
          }
        : { running: false },
      help: [
        "Run `upwork-axi auth login` to establish the Upwork client session (visible Chrome, manual login)",
        "Run `upwork-axi browser open` to start browsing the Upwork client app",
        "Run `upwork-axi discover` to record client-app traffic for domain commands",
        "Run `upwork-axi setup hooks` for ambient session context",
      ],
    },
    json,
  );
}
