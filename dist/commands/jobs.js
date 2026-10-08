import { optionalInt, parseFlags } from "../lib/args.js";
import { renderResult, } from "../lib/output.js";
import { listJobs } from "../upwork/api.js";
export const JOBS_HELP = `upwork-axi jobs list - open job postings

flags:
  --limit <n>            max jobs to fetch (default 50)
  --json                 machine-readable JSON instead of TOON

Live read through the authenticated browser session. Rows show the job ref
(opening id) used by \`proposals list --job <ref>\`, the title, and proposal
counts. Includes the dashboard relation totals.

examples:
  upwork-axi jobs list
  upwork-axi jobs list --json`;
const LIST_FLAGS = {
    limit: { type: "string" },
    json: { type: "boolean" },
};
export async function jobsCommand(args, ctx) {
    const sub = args[0];
    if (sub === undefined || sub !== "list") {
        return { help_text: JOBS_HELP };
    }
    const commandPath = "upwork-axi jobs list";
    const { values, positionals } = parseFlags(args.slice(1), commandPath, LIST_FLAGS);
    const json = values["json"] === true;
    if (positionals.length > 0) {
        return { help_text: JOBS_HELP };
    }
    const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 50;
    const { jobs, counts } = await ctx.app((api) => listJobs(api, limit));
    return renderResult({
        jobs: { count: jobs.length },
        ...(Object.keys(counts).length > 0 ? { totals: counts } : {}),
        ...(jobs.length > 0
            ? {
                list: jobs.map((job) => ({
                    ref: job.ref,
                    title: job.title,
                    proposals: job.proposals,
                    unread: job.unread,
                    shortlisted: job.shortlisted,
                    hired: job.hired,
                })),
            }
            : { result: "0 open job postings" }),
        help: [
            "Run `upwork-axi proposals list --job <ref>` for a job's applicants",
            "Run `upwork-axi proposals stats --job <ref>` for pipeline counts",
        ],
    }, json);
}
