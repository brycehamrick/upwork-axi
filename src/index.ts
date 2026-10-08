import { runAxiCli } from "axi-sdk-js";
import type { AxiRenderable } from "./lib/output.js";
import { VERSION } from "./version.js";
import { getCommandContext, type CommandContext } from "./context.js";
import { homeCommand } from "./commands/home.js";
import { authCommand, AUTH_HELP } from "./commands/auth.js";
import { browserCommand, BROWSER_HELP } from "./commands/browser.js";
import { jobsCommand, JOBS_HELP } from "./commands/jobs.js";
import { proposalsCommand, proposalGetCommand, PROPOSALS_HELP } from "./commands/proposals.js";
import { messagesCommand, MESSAGES_HELP } from "./commands/messages.js";
import { skillCommand, SKILL_HELP } from "./commands/skill.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";
import { discoverCommand, DISCOVER_HELP } from "./commands/discover.js";

export const DESCRIPTION =
  "Upwork for agents - a persistent authenticated browser session over the client (hiring) app, with ref-based interactive primitives and discovery capture";

const TOP_LEVEL_HELP = `upwork-axi - ${DESCRIPTION}

commands:
  browser open           start/attach the visible Chrome and snapshot Upwork
  browser snapshot       page outline with [ref=eN] tags (--full, --query)
  browser click|fill     act on refs from the snapshot, get a fresh snapshot
  browser goto|find|select|press|eval|screenshot|console|status|close
  jobs list              open job postings (ref, title, counts)
  proposals list|stats   applicant rows / pipeline counts for a job
  proposal get <id>      one proposal packet (cover letter, terms)
  messages rooms|read    message rooms / one thread with out-in roles
  messages unread        unread rooms and counts
  skill install          install the agent skill (npx-able, idempotent)
  auth login             open a visible Chrome window, wait for manual login
  auth status            browser session state (--browser to probe live)
  auth logout            close the browser, clear the record (--purge deletes the profile)
  discover               record a manual client-app session (dev command)
  setup hooks|status     install ambient session context

global flags: --help, -v/--version, update (self-update)

auth: none to configure - the browser transport needs no API key. Login is
manual through the persistent profile (2FA included). Browser state lives
in ~/.upwork-axi/ (override with UPWORK_STATE_DIR). Navigation is scoped
to *.upwork.com; one headed browser at a time.

roadmap: domain commands (jobs list, proposals list/sync, messages
read/send) are built from discovery artifacts once the session is live.
The official GraphQL API transport ships separately when API access is
approved.

run \`upwork-axi <command> --help\` for a command reference.`;

interface HelpEntry {
  help: string;
}

const COMMAND_HELP: Record<string, HelpEntry> = {
  auth: { help: AUTH_HELP },
  browser: { help: BROWSER_HELP },
  jobs: { help: JOBS_HELP },
  proposals: { help: PROPOSALS_HELP },
  proposal: { help: PROPOSALS_HELP },
  messages: { help: MESSAGES_HELP },
  skill: { help: SKILL_HELP },
  setup: { help: SETUP_HELP },
  discover: { help: DISCOVER_HELP },
};

type Command = (args: string[], ctx: CommandContext) => Promise<AxiRenderable>;

function withContext(command: Command): (args: string[]) => Promise<AxiRenderable> {
  return (args: string[]) => command(args, getCommandContext());
}

export async function main(): Promise<void> {
  await runAxiCli({
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_LEVEL_HELP,
    getCommandHelp: (command: string) => COMMAND_HELP[command]?.help ?? null,
    home: withContext(homeCommand),
    commands: {
      auth: withContext(authCommand),
      browser: withContext(browserCommand),
      jobs: withContext(jobsCommand),
      proposals: withContext(proposalsCommand),
      proposal: withContext(proposalGetCommand),
      messages: withContext(messagesCommand),
      skill: (args: string[]) => skillCommand(args),
      discover: withContext(discoverCommand),
      setup: (args: string[]) => setupCommand(args),
    },
  });
}

// Direct execution (node dist/index.js) instead of the bin wrapper.
if (process.argv[1]?.endsWith("index.js")) {
  await main();
}
