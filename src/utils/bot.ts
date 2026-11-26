import { Bot, Context } from "grammy";
import { run } from "@grammyjs/runner";
import type { Update } from "grammy/types";
import log from "../log";
import { updateLastOnline } from "../shared/database";

/**
 * Creates an admin notification function for a bot
 * @param bot - The bot instance
 * @param botName - The name of the bot for logging
 * @param adminUserId - Optional admin user ID to send notifications to
 * @returns A function to send admin notifications
 */
export function createAdminNotifier(
  bot: Bot,
  botName: string,
  adminUserId?: number
): (message: string) => Promise<void> {
  return async (message: string) => {
    if (!adminUserId) return;
    try {
      await bot.api.sendMessage(adminUserId, `🤖 ${botName}\n${message}`, {
        parse_mode: "HTML",
      });
    } catch (err) {
      log.error(`${botName} > Admin notification failed`, err);
    }
  };
}

/**
 * Sets up standard error handling for a bot
 * @param bot - The bot instance
 * @param botName - The name of the bot for logging
 * @param notifyAdmin - Optional admin notification function
 */
export function setupBotErrorHandling(
  bot: Bot,
  botName: string,
  notifyAdmin?: (message: string) => Promise<void>
): void {
  bot.catch = (err) => {
    log.error(`${botName} > BOT`, err);
    if (notifyAdmin) {
      notifyAdmin(`❌ <b>Critical Bot Error</b>\nError: ${err}`).catch(() => {});
    }
  };
}

/**
 * Middleware to update user's last_online timestamp on any interaction
 * This runs asynchronously and doesn't block the main flow
 * @param bot - The bot instance
 */
export function setupLastOnlineMiddleware(bot: Bot): void {
  bot.use(async (ctx: Context, next) => {
    // Update last_online in the background (fire-and-forget)
    if (ctx.from?.id) {
      updateLastOnline(ctx.from.id).catch(() => {
        // Silently fail - don't log errors for this background operation
      });
    }
    // Continue to next middleware/handler
    await next();
  });
}

/**
 * Initializes and starts a bot with standard setup using grammY runner for concurrent processing
 * @param bot - The bot instance
 * @param pollingTimeout - Polling timeout in seconds (defaults to POLLING_TIMEOUT or 1 second)
 * @param allowedUpdates - Update types requested from Telegram for this bot
 * @returns Promise that resolves when bot is initialized
 */
export async function initializeBot(
  bot: Bot,
  pollingTimeout?: number,
  allowedUpdates: ReadonlyArray<Exclude<keyof Update, "update_id">> = ["message", "callback_query"]
): Promise<void> {
  await bot.init();
  // Use runner for concurrent update processing (better performance)
  // Timeout controls long polling interval - lower values poll more frequently
  const timeout = pollingTimeout ?? parseInt(process.env.POLLING_TIMEOUT || "1", 10);
  run(bot, {
    runner: {
      fetch: {
        allowed_updates: allowedUpdates,
        timeout,
      },
    },
  });
}

