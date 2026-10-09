import { AxiError } from "axi-sdk-js";
import { forbidExtraPositionals, optionalInt, parseFlags, requirePositional, requiredString, } from "../lib/args.js";
import { renderResult, pageCountLine } from "../lib/output.js";
import { truncateText } from "../lib/truncate.js";
import { listRooms, readRoom, resolveRoom, sendRoomMessage } from "../upwork/api.js";
export const MESSAGES_HELP = `upwork-axi messages - candidate threads

subcommands:
  messages rooms                         message rooms (most recent first)
  messages read <room> [--full]          one thread, out/in roles (--full bodies)
  messages unread                       unread count per room
  messages send <room> --text <t>        preview a single message send (--confirm sends)

flags:
  --limit <n>            max rooms/stories (default 20)
  --unread               (rooms) only rooms with unread messages
  --full                 (read) complete message bodies without truncation
  --text <text>          (send) the exact message body (required, max 5000 chars)
  --confirm              (send) actually send; without it, preview only
  --json                 machine-readable JSON instead of TOON

Room refs: full room id (room_...) from \`messages rooms\` or the room id in
\`proposals list\` rows; a unique participant-name prefix also resolves.

Sends are candidate-facing: the command previews the exact recipient and
text by default and makes zero mutation calls - rerun with --confirm to
send, which verifies delivery by re-reading the thread. One send per
invocation; never bulk.

examples:
  upwork-axi messages rooms --unread
  upwork-axi messages read room_1fc866490953a090d24cac21b7cb3ed3
  upwork-axi messages read "Ghaith" --full
  upwork-axi messages send "Ghaith" --text "Thanks for the update!"
  upwork-axi messages send "Ghaith" --text "Thanks!" --confirm`;
const ROOMS_FLAGS = {
    limit: { type: "string" },
    unread: { type: "boolean" },
    json: { type: "boolean" },
};
const READ_FLAGS = {
    limit: { type: "string" },
    full: { type: "boolean" },
    json: { type: "boolean" },
};
const SEND_FLAGS = {
    text: { type: "string" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const MAX_MESSAGE_CHARS = 5000;
export async function messagesCommand(args, ctx) {
    const sub = args[0];
    if (sub === undefined) {
        return { help_text: MESSAGES_HELP };
    }
    if (sub === "rooms")
        return rooms(args.slice(1), ctx);
    if (sub === "read")
        return read(args.slice(1), ctx);
    if (sub === "unread")
        return unread(args.slice(1), ctx);
    if (sub === "send")
        return send(args.slice(1), ctx);
    throw new AxiError(`messages: unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Implemented: `messages rooms`, `messages read`, `messages unread`, `messages send`",
        "Run `upwork-axi messages --help` for the reference",
    ]);
}
async function rooms(args, ctx) {
    const commandPath = "upwork-axi messages rooms";
    const { values, positionals } = parseFlags(args, commandPath, ROOMS_FLAGS);
    const json = values["json"] === true;
    forbidExtraPositionals(positionals, 0, commandPath);
    const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
    const onlyUnread = values["unread"] === true;
    const all = await ctx.app((api) => listRooms(api, { limit: 100 }));
    const rooms = onlyUnread ? all.filter((room) => room.unread > 0) : all;
    const shown = rooms.slice(0, limit);
    return renderResult({
        rooms: { count: shown.length, ...(onlyUnread ? { filter: "unread" } : {}) },
        ...(shown.length > 0
            ? {
                list: shown.map((room) => ({
                    room: room.roomId,
                    name: room.name,
                    ...(room.topic ? { topic: room.topic } : {}),
                    unread: room.unread,
                })),
            }
            : { result: onlyUnread ? "0 rooms with unread messages" : "0 message rooms" }),
        help: [
            "Run `upwork-axi messages read <room>` for a thread",
            ...(pageCountLine(shown.length, rooms.length, "limit") ? [pageCountLine(shown.length, rooms.length, "limit")] : []),
        ],
    }, json);
}
async function read(args, ctx) {
    const commandPath = "upwork-axi messages read";
    const { values, positionals } = parseFlags(args, commandPath, READ_FLAGS);
    const json = values["json"] === true;
    const rawRoom = requirePositional(positionals, 0, "room", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
    const full = values["full"] === true;
    const { room, thread } = await ctx.app(async (api) => {
        const room = await resolveRoom(api, rawRoom);
        const thread = await readRoom(api, room.roomId, { limit });
        return { room, thread };
    });
    const shown = thread.stories.slice(-limit);
    return renderResult({
        room: {
            room: room.roomId,
            name: room.name,
            ...(room.topic ? { topic: room.topic } : {}),
        },
        messages: { count: shown.length, total: thread.total },
        ...(shown.length > 0
            ? {
                list: shown.map((story) => ({
                    role: story.role,
                    at: story.at,
                    body: full ? story.body : truncateText(story.body, 160).value,
                })),
            }
            : { result: "0 messages in thread" }),
        help: [
            ...(thread.cursor ? ["Older history exists - rerun with a larger --limit"] : []),
            "Reply with `upwork-axi messages send <room> --text \"...\"` (preview first, then --confirm)",
        ],
    }, json);
}
async function unread(args, ctx) {
    const commandPath = "upwork-axi messages unread";
    const { values, positionals } = parseFlags(args, commandPath, ROOMS_FLAGS);
    const json = values["json"] === true;
    forbidExtraPositionals(positionals, 0, commandPath);
    const rooms = await ctx.app((api) => listRooms(api, { limit: 100 }));
    const unreadRooms = rooms.filter((room) => room.unread > 0);
    const totalUnread = unreadRooms.reduce((sum, room) => sum + room.unread, 0);
    return renderResult({
        unread: { rooms: unreadRooms.length, messages: totalUnread },
        ...(unreadRooms.length > 0
            ? {
                list: unreadRooms.map((room) => ({
                    room: room.roomId,
                    name: room.name,
                    unread: room.unread,
                })),
            }
            : { result: "0 unread messages" }),
        help: [
            "Run `upwork-axi messages read <room>` for a thread with unread messages",
        ],
    }, json);
}
async function send(args, ctx) {
    const commandPath = "upwork-axi messages send";
    const { values, positionals } = parseFlags(args, commandPath, SEND_FLAGS);
    const json = values["json"] === true;
    const rawRoom = requirePositional(positionals, 0, "room", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const text = requiredString(values, "text", commandPath);
    if (text.length > MAX_MESSAGE_CHARS) {
        throw new AxiError(`--text exceeds the ${MAX_MESSAGE_CHARS}-character composer limit (${text.length} chars)`, "VALIDATION_ERROR");
    }
    const confirm = values["confirm"] === true;
    // Preview path: resolve the room live, show exactly what would happen,
    // make ZERO mutation calls.
    if (!confirm) {
        const room = await ctx.app((api) => resolveRoom(api, rawRoom));
        return renderResult({
            send: {
                room: { room: room.roomId, name: room.name, ...(room.topic ? { topic: room.topic } : {}) },
                chars: text.length,
            },
            message: text,
            help: [
                "Preview only - zero messages were sent",
                "Rerun with --confirm to send this message",
            ],
        }, json);
    }
    // Confirm path: one send, then verify by an independent thread re-read.
    const result = await ctx.app(async (api) => {
        const room = await resolveRoom(api, rawRoom);
        const sent = await sendRoomMessage(api, room.roomId, text);
        const thread = await readRoom(api, room.roomId, { limit: 50 });
        const verified = thread.stories.some((story) => story.storyId === sent.storyId);
        if (!verified) {
            throw new AxiError(`sent story ${sent.storyId} did not appear in the thread re-read`, "APP_API_ERROR", ["The message may still have been delivered - check `messages read` before retrying"]);
        }
        return { room, sent };
    });
    return renderResult({
        sent: {
            to: { room: result.room.roomId, name: result.room.name },
            story: result.sent.storyId,
            at: result.sent.created,
            chars: text.length,
            verified: true,
        },
        help: [
            "Run `upwork-axi messages read <room>` to see it in the thread",
        ],
    }, json);
}
