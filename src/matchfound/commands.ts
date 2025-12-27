import { Bot, InlineKeyboard, InputFile } from "grammy";
import { prisma } from "../db";
import log from "../log";
import { MIN_COMPLETION_THRESHOLD, ADMIN_USER_ID } from "../shared/constants";
import { ensureUserExists, getUserProfile } from "../shared/database";
import { setupProfileCommand } from "../shared/profileCommand";
import { generateDailyActiveUsersChart } from "./charts";
import { BOT_NAME } from "./constants";
import {
  createMainActionsKeyboard,
  createMainMenuKeyboard,
  getMissingRequiredFields,
  handleFind,
  handleLiked,
  promptNextRequiredField,
} from "./helpers";
import { callbacks as callbackQueries } from "./callbackQueries";
import {
  admin,
  errors,
  general,
  getWelcomeMessage,
  profileCompletion,
  settings,
} from "./strings";

const ADMIN_DAU_DAYS = 14;

export function setupCommands(
  bot: Bot,
  notifyAdmin: (message: string) => Promise<void>
) {
  // /start command
  bot.command("start", async (ctx) => {
    ctx.react("❤‍🔥").catch(() => {});
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      const username = ctx.from?.username;
      const firstName = ctx.from?.first_name;
      const lastName = ctx.from?.last_name;
      await ensureUserExists(
        userId,
        username,
        async (uid) => {
          notifyAdmin(
            `👤 <b>New User Registration</b>\nUser ID: <code>${uid}</code>`
          );
        },
        firstName,
        lastName
      );

      const profile = await getUserProfile(userId);
      if (!profile) {
        await ctx.reply(errors.getProfileFailed);
        return;
      }

      // Notify admin about /start command usage (privacy-respecting: only user ID)
      notifyAdmin(
        `🔄 <b>User Started Bot</b>\nUser ID: <code>${userId}</code>`
      );

      // Always show welcome message first
      const completionScore = profile.completion_score || 0;
      const welcomeMessage = getWelcomeMessage(completionScore);
      await ctx.reply(welcomeMessage, {
        reply_markup: createMainMenuKeyboard(profile),
      });

      // Check for missing required fields
      const missingFields = getMissingRequiredFields(profile);

      if (missingFields.length > 0) {
        // Start profile completion flow
        await ctx.reply(profileCompletion.welcome);
        await promptNextRequiredField(ctx, bot, userId, missingFields, 0);
      } else {
        // All required fields completed, show action buttons
        await ctx.reply(general.useButtonsBelow, {
          reply_markup: createMainActionsKeyboard(),
        });
      }
    } catch (err) {
      log.error(BOT_NAME + " > Start command failed", err);
      await ctx.reply(errors.commandFailed);
      notifyAdmin(
        `❌ <b>Start Command Failed</b>\nUser: <code>${userId}</code>\nError: ${err}`
      );
    }
  });

  // /find command
  bot.command("find", async (ctx) => {
    ctx.react("🤔").catch(() => {});
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      await handleFind(ctx, userId, true, notifyAdmin);
    } catch (err) {
      log.error(BOT_NAME + " > Find command failed", err);
      await ctx.reply(errors.findFailed);
      notifyAdmin(
        `❌ <b>Find Command Failed</b>\nUser: <code>${userId}</code>\nError: ${err}`
      );
    }
  });

  // /liked command
  bot.command("liked", async (ctx) => {
    ctx.react("❤").catch(() => {});
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      await handleLiked(ctx, userId);
    } catch (err) {
      log.error(BOT_NAME + " > Liked command failed", err);
      await ctx.reply(errors.likedFailed);
      notifyAdmin(
        `❌ <b>Liked Command Failed</b>\nUser: <code>${userId}</code>\nError: ${err}`
      );
    }
  });

  // /profile command (using shared module)
  setupProfileCommand(bot, {
    botName: BOT_NAME,
    notifyAdmin,
  });

  // /settings command
  bot.command("settings", async (ctx) => {
    ctx.react("🤔").catch(() => {});
    const userId = ctx.from?.id;
    try {
      const keyboard = new InlineKeyboard().text(
        settings.wipeDataButton,
        callbackQueries.settingsWipeData
      );

      await ctx.reply(settings.title, {
        reply_markup: keyboard,
      });
    } catch (err) {
      log.error(BOT_NAME + " > Settings command failed", err);
      await ctx.reply(errors.settingsFailed);
      notifyAdmin(
        `❌ <b>Settings Command Failed</b>\nUser: <code>${userId}</code>\nError: ${err}`
      );
    }
  });

  // /admin command
  bot.command("admin", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    // Check if user is admin
    if (!ADMIN_USER_ID || userId !== ADMIN_USER_ID) {
      await ctx.reply(errors.accessDenied);
      return;
    }

    ctx.react("👏").catch(() => {});

    try {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dauStart = new Date();
      dauStart.setHours(0, 0, 0, 0);
      dauStart.setDate(dauStart.getDate() - (ADMIN_DAU_DAYS - 1));

      const [
        totalUsers,
        completedProfiles,
        newUsers,
        totalLikes,
        totalReports,
        mutualLikesRows,
      ] = await prisma.$transaction([
        prisma.user.count(),
        prisma.user.count({
          where: { completion_score: { gte: MIN_COMPLETION_THRESHOLD } },
        }),
        prisma.user.count({
          where: { created_at: { gte: since24h } },
        }),
        prisma.like.count(),
        prisma.report.count(),
        prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint AS count
            FROM likes l1
            JOIN likes l2
              ON l1.user_id = l2.liked_user_id
             AND l1.liked_user_id = l2.user_id
           WHERE l1.user_id < l1.liked_user_id
          `,
      ]);

      const mutualLikes = Number(mutualLikesRows?.[0]?.count ?? 0);

      const dailyActiveRows = await prisma.$queryRaw<
        { day: Date; active_users: bigint }[]
      >`
          SELECT
            date_trunc('day', updated_at) AS day,
            COUNT(*)::bigint AS active_users
          FROM users
          WHERE updated_at >= ${dauStart}
          GROUP BY 1
          ORDER BY 1;
        `;

      const dailyNewRows = await prisma.$queryRaw<
        { day: Date; new_users: bigint }[]
      >`
          SELECT
            date_trunc('day', created_at) AS day,
            COUNT(*)::bigint AS new_users
          FROM users
          WHERE created_at >= ${dauStart}
          GROUP BY 1
          ORDER BY 1;
        `;

      const totalBeforeWindow = await prisma.user.count({
        where: { created_at: { lt: dauStart } },
      });

      // Helper to convert date row to day key
      const getDayKey = (day: Date | string): string => {
        const date =
          day instanceof Date ? day : new Date(day as unknown as string);
        return date.toISOString().slice(0, 10);
      };

      const dailyActiveMap = new Map<string, number>();
      for (const row of dailyActiveRows) {
        const dayKey = getDayKey(row.day);
        dailyActiveMap.set(dayKey, Number(row.active_users ?? 0));
      }

      const dailyNewMap = new Map<string, number>();
      for (const row of dailyNewRows) {
        const dayKey = getDayKey(row.day);
        dailyNewMap.set(dayKey, Number(row.new_users ?? 0));
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const dailyActiveSeries = [];
      const dailyTotalSeries = [];
      let runningTotal = totalBeforeWindow;
      for (let i = ADMIN_DAU_DAYS - 1; i >= 0; i--) {
        const day = new Date(today);
        day.setDate(today.getDate() - i);
        const dayKey = day.toISOString().slice(0, 10);
        runningTotal += dailyNewMap.get(dayKey) ?? 0;
        dailyActiveSeries.push({
          date: day,
          active: dailyActiveMap.get(dayKey) ?? 0,
        });
        dailyTotalSeries.push({
          date: day,
          active: runningTotal,
        });
      }

      const chartBuffer = generateDailyActiveUsersChart(
        dailyActiveSeries,
        dailyTotalSeries,
        {
          title: admin.chartTitle(ADMIN_DAU_DAYS),
          activeLabel: admin.chartLabels.activeUsers,
          totalLabel: admin.chartLabels.totalUsers,
        }
      );

      const keyboard = new InlineKeyboard()
        .text(admin.buttons.reports, callbackQueries.adminReports)
        .text(admin.buttons.users, callbackQueries.adminUsers(0))
        .row();

      const statsMessage = admin.statsMessage(
        totalUsers,
        newUsers,
        completedProfiles,
        totalLikes,
        mutualLikes,
        totalReports,
        MIN_COMPLETION_THRESHOLD
      );

      await ctx.replyWithPhoto(new InputFile(chartBuffer, "dau.png"), {
        caption: statsMessage,
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } catch (err) {
      log.error(BOT_NAME + " > Admin stats failed", err);
      await ctx.reply(errors.statsFailed);
    }
  });
}
