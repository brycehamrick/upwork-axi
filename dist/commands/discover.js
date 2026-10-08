import { AxiError } from "axi-sdk-js";
import { forbidExtraPositionals, optionalInt, parseFlags, requireHttpUrl, } from "../lib/args.js";
import { renderResult } from "../lib/output.js";
export const DISCOVER_HELP = `upwork-axi discover - record a manual client-app session (dev command)

flags:
  --url <url>            starting URL (default https://www.upwork.com/nx/my-jobs)
  --timeout <ms>         max wait for manual login (default 300000)
  --max-wait <ms>        max recording time before auto-finish (default 3600000)
  --json                 machine-readable JSON instead of TOON

Uses the running browser (starting it if needed) and records every Upwork
XHR/JSON exchange - including candidate and message document bodies, with
credential-shaped keys redacted - while you manually demonstrate the hiring
workflow (open My Jobs, open a job posting, open a proposal,
read a message thread, send a message, shortlist/archive).
Press Enter in the terminal to finish.

Artifacts land in ~/.upwork-axi/runs/discover-<id>/:
  trace.zip             Playwright trace, when available over CDP
  network.json          redacted exchange log with sizes and status codes
  documents/            captured JSON bodies (candidate/message documents)
  console-errors.txt    page console errors, when any
  final-screenshot.png  last visible state
  aria.yml, dom.html    sanitized final snapshots
  index.json            artifact index

This is a development command: its output feeds the domain-command build
(candidates, messages, pipeline moves), not the agent surface.

examples:
  upwork-axi discover
  upwork-axi discover --url https://www.upwork.com/nx/my-jobs`;
const DISCOVER_FLAGS = {
    url: { type: "string" },
    timeout: { type: "string" },
    "max-wait": { type: "string" },
    json: { type: "boolean" },
};
const UPWORK_HOST = /(^|\.)upwork\.com$/i;
export async function discoverCommand(args, ctx) {
    const commandPath = "upwork-axi discover";
    const { values, positionals } = parseFlags(args, commandPath, DISCOVER_FLAGS);
    const json = values["json"] === true;
    forbidExtraPositionals(positionals, 0, commandPath);
    const url = requireHttpUrl(typeof values["url"] === "string" && values["url"].trim().length > 0
        ? values["url"].trim()
        : "https://www.upwork.com/nx/my-jobs", "--url");
    if (!UPWORK_HOST.test(new URL(url).hostname.toLowerCase())) {
        throw new AxiError(`--url must target upwork.com, got ${new URL(url).hostname}`, "VALIDATION_ERROR", ["Discovery records Upwork client-app traffic only"]);
    }
    const loginTimeoutMs = optionalInt(values, "timeout", { min: 10_000, max: 3_600_000 }) ?? 300_000;
    const maxWaitMs = optionalInt(values, "max-wait", { min: 1_000, max: 86_400_000 }) ?? 3_600_000;
    const result = await ctx.browser.discover({
        stateDir: ctx.stateDir,
        url,
        loginTimeoutMs,
        maxWaitMs,
    });
    return renderResult({
        discover: {
            run: result.runDir,
            url: result.url,
            network: {
                exchanges: result.exchanges.length,
                documents: result.documentCount,
                console_errors: result.consoleErrors.length,
            },
            artifacts: result.files,
        },
        help: [
            "Point your agent at the run directory to derive the endpoint map and candidate/message schemas",
            "Rerun after any Upwork UI change that breaks a domain command",
        ],
    }, json);
}
