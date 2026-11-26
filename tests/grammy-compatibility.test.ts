import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, BotConfig, Context } from "grammy";
import type { Update } from "grammy/types";
import { newUserId } from "./support/state";

type ApiCall = { method: string; payload: Record<string, unknown> };
const boundary = vi.hoisted(() => ({
  calls: new Map<string, ApiCall[]>(),
  run: vi.fn(),
}));
vi.mock("dotenv", () => ({ configDotenv: vi.fn() }));
vi.mock("@grammyjs/runner", () => ({ run: boundary.run }));
vi.mock("../src/redis", async () => {
  const { redis } = await import("./support/state");
  return {
    ...redis,
    connectRedis: vi.fn(),
    default: {
      get: vi.fn(async () => null),
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
    },
  };
});
vi.mock("grammy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("grammy")>();
  class BoundaryBot extends actual.Bot {
    constructor(token: string, config?: BotConfig<Context>) {
      super(token, config);
      const calls: ApiCall[] = [];
      boundary.calls.set(token, calls);
      this.api.config.use(async (_previous, method, payload) => {
        calls.push({ method, payload: payload as Record<string, unknown> });
        if (method === "getMe") {
          return {
            ok: true,
            result: {
              id: Number(token.split(":")[0]),
              is_bot: true,
              first_name: "Compatibility",
              username: "compatibility_test_bot",
              can_join_groups: true,
              can_read_all_group_messages: false,
              supports_inline_queries: true,
              can_connect_to_business: false,
              has_main_web_app: false,
              supports_guest_queries: false,
              needs_inline_query_location: false,
              has_topics_enabled: false,
              allows_users_to_create_topics: false,
              has_topic_sidebar: false,
              can_manage_bots: false,
              supports_join_request_queries: false,
            },
          } as never;
        }
        if (method === "sendMessage") {
          return {
            ok: true,
            result: {
              message_id: calls.length,
              date: 1,
              chat: { id: Number((payload as { chat_id: number }).chat_id), type: "private" },
              text: (payload as { text: string }).text,
            },
          } as never;
        }
        if (
          [
            "setMyCommands",
            "setMessageReaction",
            "answerCallbackQuery",
            "editMessageText",
            "answerInlineQuery",
          ].includes(method)
        ) {
          return { ok: true, result: true } as never;
        }
        throw new Error("Unexpected Telegram method in isolated test: " + method);
      });
    }
  }
  return { ...actual, Bot: BoundaryBot };
});

const modules = {
  inmankist: () => import("../src/inmankist"),
  ivwhat: () => import("../src/ivwhat"),
  converslation: () => import("../src/converslation"),
  matchfound: () => import("../src/matchfound"),
};
type BotName = keyof typeof modules;
const names = Object.keys(modules) as BotName[];
let updateId = 1;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ADMIN_USER_ID", "");
  vi.stubEnv("POLLING_TIMEOUT", "1");
  boundary.calls.clear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function start(name: BotName) {
  const token = newUserId() + ":TEST_TOKEN";
  const module = await modules[name]();
  const bot = await module.default.startBot(token, undefined);
  return { bot, calls: boundary.calls.get(token)! };
}
async function command(bot: Bot, text: string, userId = newUserId()) {
  await bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: updateId++,
      date: 1,
      chat: { id: userId, type: "private", first_name: "Test" },
      from: { id: userId, is_bot: false, first_name: "Test" },
      text,
      entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }],
    },
  } as Update);
  await Promise.resolve();
  return userId;
}

describe("grammY compatibility across every bot", () => {
  it.each(names)("%s initializes, registers commands and configures polling", async (name) => {
    const { bot, calls } = await start(name);
    expect(bot.botInfo.username).toBe("compatibility_test_bot");
    expect(calls.filter((call) => call.method === "getMe")).toHaveLength(1);
    const registration = calls.find((call) => call.method === "setMyCommands")!;
    expect(registration).toBeDefined();
    expect(registration.payload.commands).toEqual(
      expect.arrayContaining([expect.objectContaining({ command: "start" })]),
    );
    expect(boundary.run).toHaveBeenCalledTimes(1);
    const [polledBot, options] = boundary.run.mock.calls[0];
    expect(polledBot).toBe(bot);
    expect(options.runner.fetch.timeout).toBe(1);
    expect(options.runner.fetch.allowed_updates).toEqual(
      name === "converslation" ? ["message", "callback_query", "inline_query"] : ["message", "callback_query"],
    );
    expect(calls.some((call) => call.method === "getUpdates")).toBe(false);
  });

  it.each(names)("%s processes a representative command through its real handlers", async (name) => {
    const { bot, calls } = await start(name);
    await command(bot, name === "matchfound" ? "/settings" : "/start");
    const replies = calls.filter((call) => call.method === "sendMessage");
    expect(replies.length).toBeGreaterThan(0);
    const text = replies.map((call) => String(call.payload.text)).join("\n");
    if (name === "ivwhat") expect(text).toContain("Hi give me a link");
    if (name === "converslation") expect(text).toContain("Welcome to Converslation");
    if (name === "inmankist" || name === "matchfound") {
      expect(replies.some((call) => call.payload.reply_markup)).toBe(true);
    }
  });

  it("IVWhat converts a supported URL using the upgraded message/filter APIs", async () => {
    const { bot, calls } = await start("ivwhat");
    const userId = newUserId();
    await bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: updateId++,
        date: 1,
        chat: { id: userId, type: "private", first_name: "Test" },
        from: { id: userId, is_bot: false, first_name: "Test" },
        text: "https://nature.com/articles/example",
      },
    } as Update);
    const reply = calls.find((call) => call.method === "sendMessage");
    expect(reply?.payload.text).toBe(
      "Here's your iv link: https://t.me/iv?url=https%3A%2F%2Fnature.com%2Farticles%2Fexample&rhash=70d5d3c1fc0f12",
    );
  });

  it("Converslation selects a language and builds an inline translation result", async () => {
    const { bot, calls } = await start("converslation");
    const userId = await command(bot, "/setlang");
    const menu = calls.filter((call) => call.method === "sendMessage").at(-1)!;
    expect(menu.payload.reply_markup).toBeDefined();
    await bot.handleUpdate({
      update_id: updateId++,
      callback_query: {
        id: "language",
        chat_instance: "test",
        data: "lang:fa",
        from: { id: userId, is_bot: false, first_name: "Test" },
        message: {
          message_id: 1,
          date: 1,
          chat: { id: userId, type: "private", first_name: "Test" },
          text: "Select language",
        },
      },
    } as Update);
    expect(calls.some((call) => call.method === "answerCallbackQuery")).toBe(true);
    vi.stubEnv("OPENAI_API_KEY", "TEST_ONLY_NOT_A_CREDENTIAL");
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "سلام" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    await bot.handleUpdate({
      update_id: updateId++,
      inline_query: {
        id: "inline",
        from: { id: userId, is_bot: false, first_name: "Test" },
        query: "Hello!",
        offset: "",
      },
    } as Update);
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(request.messages.at(-1).content).toBe("Hello");
    const answer = calls.find((call) => call.method === "answerInlineQuery")!;
    expect(answer).toBeDefined();
    expect(answer.payload.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "article",
          input_message_content: {
            message_text: "سلام",
          },
        }),
      ]),
    );
  });
});
