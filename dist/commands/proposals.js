import { AxiError } from "axi-sdk-js";
import { forbidExtraPositionals, optionalInt, parseFlags, requirePositional, } from "../lib/args.js";
import { renderResult, pageCountLine } from "../lib/output.js";
import { truncateText } from "../lib/truncate.js";
import { getProposal, listProposals, proposalStats, resolveJobRef, } from "../upwork/api.js";
export const PROPOSALS_HELP = `upwork-axi proposals - review job applicants

subcommands:
  proposals list --job <ref>       applicant rows for a job posting
  proposals stats --job <ref>      pipeline counts for a job posting
  proposal get <id> [--full]       one proposal packet (cover letter, terms)

flags:
  --job <ref>            job ref (from \`jobs list\`) or unique title prefix
  --status <filter>      ClientProposalStatusFilter (default ApplicantsAll;
                         e.g. Sponsored, Shortlisted, Hired, Archived)
  --limit <n>            max rows (default 20)
  --cursor <cursor>      continue from a previous page (from list output)
  --full                 (get) complete cover letter without truncation
  --json                 machine-readable JSON instead of TOON

Proposal ids come from \`proposals list\`; rooms come from the row's room id
(\`messages read <room>\`).

examples:
  upwork-axi proposals list --job "photo editor"
  upwork-axi proposals list --job 2103617170216336029 --limit 50
  upwork-axi proposal get 2103915344041877505 --full`;
const LIST_FLAGS = {
    job: { type: "string" },
    status: { type: "string" },
    limit: { type: "string" },
    cursor: { type: "string" },
    json: { type: "boolean" },
};
const STATS_FLAGS = {
    job: { type: "string" },
    json: { type: "boolean" },
};
const GET_FLAGS = {
    job: { type: "string" },
    full: { type: "boolean" },
    json: { type: "boolean" },
};
export async function proposalsCommand(args, ctx) {
    const sub = args[0];
    if (sub === undefined) {
        return { help_text: PROPOSALS_HELP };
    }
    if (sub === "list")
        return list(args.slice(1), ctx);
    if (sub === "stats")
        return stats(args.slice(1), ctx);
    throw new AxiError(`proposals: unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Implemented: `proposals list`, `proposals stats`",
        "Run `upwork-axi proposals --help` for the reference",
    ]);
}
async function list(args, ctx) {
    const commandPath = "upwork-axi proposals list";
    const { values, positionals } = parseFlags(args, commandPath, LIST_FLAGS);
    const json = values["json"] === true;
    forbidExtraPositionals(positionals, 0, commandPath);
    const jobRef = values["job"];
    if (typeof jobRef !== "string" || jobRef.trim().length === 0) {
        throw new AxiError(`${commandPath}: --job is required`, "VALIDATION_ERROR", [
            "Run `upwork-axi jobs list` for job refs",
        ]);
    }
    const limit = optionalInt(values, "limit", { min: 1, max: 50 }) ?? 20;
    const statusFilter = typeof values["status"] === "string" ? values["status"] : undefined;
    const cursor = typeof values["cursor"] === "string" ? values["cursor"] : undefined;
    const result = await ctx.app(async (api) => {
        const job = await resolveJobRef(api, jobRef);
        const list = await listProposals(api, job.ref, { statusFilter, limit, cursor });
        return { job, list };
    });
    const { job, list } = result;
    return renderResult({
        job: { ref: job.ref, title: job.title },
        proposals: { total: list.total, shown: list.shown },
        ...(list.rows.length > 0
            ? {
                list: list.rows.map((row) => ({
                    id: row.id,
                    name: row.name,
                    title: row.title,
                    ...(row.rate ? { rate: row.rate } : {}),
                    status: row.status,
                    ...(row.roomId ? { room: row.roomId } : {}),
                    ...(row.jss !== undefined ? { jss: row.jss } : {}),
                    ...(row.topRated ? { badge: row.topRated } : {}),
                    ...(row.totalHours !== undefined ? { hours: row.totalHours } : {}),
                })),
            }
            : { result: "0 proposals" }),
        help: [
            "Run `upwork-axi proposal get <id> --full` for a cover letter packet",
            "Run `upwork-axi messages read <room>` for the thread (room id is in each row)",
            ...(list.hasNextPage
                ? [`More pages: rerun with --cursor ${JSON.stringify(list.endCursor)}`]
                : []),
            ...(pageCountLine(list.shown, list.total, "cursor")?.length
                ? [pageCountLine(list.shown, list.total, "cursor")]
                : []),
        ].filter((line) => line !== undefined),
    }, json);
}
async function stats(args, ctx) {
    const commandPath = "upwork-axi proposals stats";
    const { values, positionals } = parseFlags(args, commandPath, STATS_FLAGS);
    const json = values["json"] === true;
    forbidExtraPositionals(positionals, 0, commandPath);
    const jobRef = values["job"];
    if (typeof jobRef !== "string" || jobRef.trim().length === 0) {
        throw new AxiError(`${commandPath}: --job is required`, "VALIDATION_ERROR", [
            "Run `upwork-axi jobs list` for job refs",
        ]);
    }
    const { job, counts } = await ctx.app(async (api) => {
        const job = await resolveJobRef(api, jobRef);
        const counts = await proposalStats(api, job.ref);
        return { job, counts };
    });
    return renderResult({
        job: { ref: job.ref, title: job.title },
        stats: counts,
        help: [
            "Run `upwork-axi proposals list --job <ref>` for the applicant rows",
        ],
    }, json);
}
export async function proposalGetCommand(args, ctx) {
    if (args[0] === undefined || args[0] !== "get") {
        return { help_text: PROPOSALS_HELP };
    }
    const commandPath = "upwork-axi proposal get";
    const { values, positionals } = parseFlags(args.slice(1), commandPath, GET_FLAGS);
    const json = values["json"] === true;
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const full = values["full"] === true;
    const jobHint = typeof values["job"] === "string" ? values["job"] : undefined;
    const packet = await ctx.app((api) => getProposal(api, id, jobHint));
    const letter = full
        ? packet.coverLetter
        : truncateText(packet.coverLetter, 600).value;
    return renderResult({
        proposal: {
            id: packet.id,
            job: packet.job.title,
            ...(packet.rate ? { rate: packet.rate } : {}),
            ...(packet.status ? { status: packet.status } : {}),
            ...(packet.location ? { location: packet.location } : {}),
            ...(packet.jss !== undefined ? { jss: packet.jss } : {}),
            ...(packet.topRated ? { badge: packet.topRated } : {}),
            ...(packet.totalHours !== undefined ? { hours: packet.totalHours } : {}),
            ...(packet.roomId ? { room: packet.roomId } : {}),
            attachments: packet.attachments.length,
        },
        ...(packet.skills.length > 0 ? { skills: packet.skills } : {}),
        cover_letter: letter.length > 0 ? letter : "(empty)",
        ...(packet.milestones.length > 0
            ? { milestones: packet.milestones }
            : {}),
        ...(packet.questionsAnswers.length > 0
            ? {
                answers: packet.questionsAnswers.map((qa) => ({
                    question: full ? qa.question : truncateText(qa.question, 120).value,
                    answer: full ? qa.answer : truncateText(qa.answer, 300).value,
                })),
            }
            : {}),
        ...(packet.attachments.length > 0
            ? { files: packet.attachments.map((file) => ({ name: file.name, size: file.size, link: file.link })) }
            : {}),
        help: [
            "Run `upwork-axi messages read <room>` for the thread with this freelancer",
            "Room ids come from `proposals list --job <ref>` rows",
        ],
    }, json);
}
