import { Bot } from "grammy";
import type { Message, Update } from "grammy/types";
import { vi } from "vitest";
import { setupCommands } from "../../src/inmankist/commands";
import { setupCallbacks } from "../../src/inmankist/callbacks";
import { newUserId } from "./state";
export type Call = { method: string; payload: Record<string, unknown>; message?: Message.TextMessage };
type Button = { text: string; callback_data?: string; url?: string };
export function buttons(call?: Call): Button[] {
  return ((call?.payload.reply_markup as { inline_keyboard?: Button[][] })?.inline_keyboard ?? []).flat();
}
export function createBot(userId = newUserId()) {
  const bot = new Bot("123456:TEST_TOKEN", {
    botInfo: {
      id: 123456,
      is_bot: true,
      first_name: "Test",
      username: "inmankist_test_bot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    },
  });
  const calls: Call[] = [];
  const notify = vi.fn<(message: string) => Promise<void>>(async () => {});
  const failOnce = new Set<string>();
  let sequence = 1;
  const from = { id: userId, is_bot: false as const, first_name: "Test", username: "test_user" };
  const chat = { id: userId, type: "private" as const, first_name: "Test" };
  // Public grammY API transformer: every request terminates here, never on the network.
  bot.api.config.use(async (_previous, method, payload) => {
    if (failOnce.delete(method)) throw new Error("Injected Telegram " + method + " failure");
    const call: Call = { method, payload: payload as Record<string, unknown> };
    calls.push(call);
    if (method === "sendMessage" || method === "sendPhoto" || method.startsWith("editMessage")) {
      const message = {
        message_id: method.startsWith("editMessage") ? Number(call.payload.message_id) : sequence++,
        date: Math.floor(Date.now() / 1000),
        chat,
        from: bot.botInfo,
        text: String(call.payload.text ?? call.payload.caption ?? ""),
        reply_markup: call.payload.reply_markup,
      } as Message.TextMessage;
      call.message = message;
      return { ok: true, result: message } as never;
    }
    return { ok: true, result: true } as never;
  });
  setupCommands(bot, notify);
  setupCallbacks(bot, notify);
  const latest = () =>
    [...calls].reverse().find((call) => call.method === "sendMessage" || call.method === "sendPhoto");
  const latestQuestion = () =>
    [...calls]
      .reverse()
      .find(
        (call) => call.method === "sendMessage" && buttons(call).some((b) => b.callback_data?.startsWith("answer:")),
      );
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    bot,
    userId,
    calls,
    notify,
    failOnce,
    latest,
    latestQuestion,
    async command(text: string) {
      await bot.handleUpdate({
        update_id: sequence++,
        message: {
          message_id: sequence++,
          date: Math.floor(Date.now() / 1000),
          chat,
          from,
          text,
          entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }],
        },
      } as Update);
      await settle();
    },
    async callback(data: string, origin: Call | undefined = latest()) {
      await bot.handleUpdate({
        update_id: sequence++,
        callback_query: {
          id: "query-" + sequence++,
          chat_instance: "test-chat",
          from,
          data,
          message: origin?.message ?? { message_id: sequence++, date: 1, chat, text: "Test" },
        },
      } as Update);
      await settle();
    },
  };
}
