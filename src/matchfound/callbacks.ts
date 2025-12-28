import { Bot, InlineKeyboard } from "grammy";
import { prisma } from "../db";
import log from "../log";
import { ADMIN_USER_ID } from "../shared/constants";
import {
  deleteUserData,
  getUserIdFromTelegramId,
  getUserProfile,
} from "../shared/database";
import { setupProfileCallbacks } from "../shared/profileCallbacks";
import { handleDisplayProfile } from "../shared/profileCommand";
import { invalidateMatchCacheForUsers } from "./cache/matchCache";
import { callbacks as callbackQueries } from "./callbackQueries";
import { BOT_NAME } from "./constants";
import { displayUser, displayUsersToAdmin } from "./display";
import {
  continueProfileCompletion,
  getMatchByIndex,
  getTodayLikesCount,
  handleFind,
  handleLiked,
  isAdminUser,
  removeCurrentMatchAndShowNext,
  showNextUser,
} from "./helpers";
import { getSession } from "./session";
import {
  admin,
  ban,
  callbacks,
  deleteData,
  display,
  errors,
  mainMenuButtons,
  notifications,
  report,
  success,
} from "./strings";

export function setupCallbacks(
  bot: Bot,
  notifyAdmin: (message: string) => Promise<void>
) {
  // Like action
  bot.callbackQuery(/like:(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const likedUserId = parseInt(ctx.match[1]);
    if (userId === likedUserId) {
      await ctx.answerCallbackQuery(errors.cannotLikeSelf);
      return;
    }

    try {
      // Get user ids from telegram_ids
      const userIdBigInt = await getUserIdFromTelegramId(userId);
      const likedUserIdBigInt = await getUserIdFromTelegramId(likedUserId);

      if (!userIdBigInt || !likedUserIdBigInt) {
        await ctx.answerCallbackQuery(errors.userNotFound);
        return;
      }

      // Check if like already exists (to avoid duplicate notifications)
      const existingLike = await prisma.like.findUnique({
        where: {
          user_id_liked_user_id: {
            user_id: userIdBigInt,
            liked_user_id: likedUserIdBigInt,
          },
        },
      });

      const isNewLike = !existingLike;

      // Check daily like limit for new likes only
      if (isNewLike) {
        const todayLikesCount = await getTodayLikesCount(userId);
        if (todayLikesCount >= 5) {
          await ctx.answerCallbackQuery(errors.dailyLikeLimitReached);
          return;
        }
      }

      // Add like (upsert to handle both new and existing likes)
      await prisma.like.upsert({
        where: {
          user_id_liked_user_id: {
            user_id: userIdBigInt,
            liked_user_id: likedUserIdBigInt,
          },
        },
        create: {
          user_id: userIdBigInt,
          liked_user_id: likedUserIdBigInt,
        },
        update: {},
      });

      // Invalidate match cache for both users (matches change when likes are added)
      invalidateMatchCacheForUsers([userIdBigInt, likedUserIdBigInt]).catch(() => {});

      // Check for mutual like
      const mutualLike = await prisma.like.findUnique({
        where: {
          user_id_liked_user_id: {
            user_id: likedUserIdBigInt,
            liked_user_id: userIdBigInt,
          },
        },
      });

      // Only send notifications if this is a new like
      if (isNewLike) {
        if (mutualLike) {
          // Mutual like!
          await ctx.answerCallbackQuery(callbacks.mutualLike);
          await ctx.reply(success.mutualLike);
          
          // Send notification to the other user about the mutual match
          try {
            const likerProfile = await getUserProfile(userId);
            const likerName =
              likerProfile?.display_name ||
              (likerProfile?.username
                ? `@${likerProfile.username}`
                : display.unknownPerson);

            await bot.api.sendMessage(
              likedUserId,
              success.mutualLike + `\n\n${likerName} شما را لایک کرده است!`,
              { parse_mode: "HTML" }
            );
          } catch (notifErr) {
            // Silently fail if user blocked the bot or other errors
            log.info(
              BOT_NAME +
                " > Mutual like notification failed (user may have blocked bot)",
              {
                likedUserId,
                error: notifErr,
              }
            );
          }
        } else {
          await ctx.answerCallbackQuery(callbacks.likeRegistered);

          // Send notification to the liked user
          try {
            const likerProfile = await getUserProfile(userId);
            const likerName =
              likerProfile?.display_name ||
              (likerProfile?.username
                ? `@${likerProfile.username}`
                : display.unknownPerson);

            await bot.api.sendMessage(
              likedUserId,
              notifications.newLike(likerName),
              { parse_mode: "HTML" }
            );
          } catch (notifErr) {
            // Silently fail if user blocked the bot or other errors
            // Don't log as error since this is expected in some cases
            log.info(
              BOT_NAME +
                " > Like notification failed (user may have blocked bot)",
              {
                likedUserId,
                error: notifErr,
              }
            );
          }
        }
      } else {
        // Like already existed, just confirm the action
        if (mutualLike) {
          await ctx.answerCallbackQuery(callbacks.mutualLike);
        } else {
          await ctx.answerCallbackQuery(callbacks.likeRegistered);
        }
      }

      // For match mode, remove current match from list and show next
      // For liked mode, still auto-advance
      const session = await getSession(userId);
      if (
        session.matchIds &&
        session.currentMatchIndex !== undefined
      ) {
        // Remove current match and show next
        await removeCurrentMatchAndShowNext(ctx, userId, session);
      } else if (
        session.likedUserIds &&
        session.currentLikedIndex !== undefined
      ) {
        await showNextUser(ctx, userId, "liked");
      }
    } catch (err) {
      log.error(BOT_NAME + " > Like action failed", err);
      await ctx.answerCallbackQuery(errors.likeActionFailed);
      notifyAdmin(
        `❌ <b>Like Action Failed</b>\nUser: <code>${userId}</code>\nLiked User: <code>${likedUserId}</code>\nError: ${err}`
      );
    }
  });

  // Dislike action
  bot.callbackQuery(/dislike:(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    await ctx.answerCallbackQuery(callbacks.disliked);

    try {
      const session = await getSession(userId);
      // Remove current match from list and show next (for match mode)
      if (
        session.matchIds &&
        session.currentMatchIndex !== undefined
      ) {
        await removeCurrentMatchAndShowNext(ctx, userId, session);
      }
    } catch (err) {
      log.error(BOT_NAME + " > Dislike action failed", err);
      // Don't show error to user, just log it
    }
  });

  // Prev match action (navigate to previous match)
  bot.callbackQuery(/prev_match:(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    await ctx.answerCallbackQuery();

    try {
      const session = await getSession(userId);
      if (!session.matchIds || session.currentMatchIndex === undefined) {
        await ctx.answerCallbackQuery(errors.noMatches);
        return;
      }

      const currentIndex = session.currentMatchIndex;
      if (currentIndex <= 0) {
        await ctx.answerCallbackQuery("❌ Already at first match");
        return;
      }

      const prevIndex = currentIndex - 1;
      session.currentMatchIndex = prevIndex;
      const match = await getMatchByIndex(session, prevIndex);
      if (!match) {
        await ctx.answerCallbackQuery(errors.noMatches);
        return;
      }

      const profile = await getUserProfile(userId);
      await displayUser(ctx, match, "match", session, profile || undefined, true);
    } catch (err) {
      log.error(BOT_NAME + " > Prev match failed", err);
      await ctx.answerCallbackQuery(errors.findFailed);
    }
  });

  // Next match action (navigate to next match)
  bot.callbackQuery(/next_match:(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    await ctx.answerCallbackQuery();

    try {
      const session = await getSession(userId);
      if (!session.matchIds || session.currentMatchIndex === undefined) {
        await ctx.answerCallbackQuery(errors.noMatches);
        return;
      }

      const currentIndex = session.currentMatchIndex;
      const totalMatches = session.matchIds.length;
      if (currentIndex >= totalMatches - 1) {
        await ctx.answerCallbackQuery("❌ Already at last match");
        return;
      }

      const nextIndex = currentIndex + 1;
      session.currentMatchIndex = nextIndex;
      const match = await getMatchByIndex(session, nextIndex);
      if (!match) {
        await ctx.answerCallbackQuery(errors.noMatches);
        return;
      }

      const profile = await getUserProfile(userId);
      await displayUser(ctx, match, "match", session, profile || undefined, true);
    } catch (err) {
      log.error(BOT_NAME + " > Next match failed", err);
      await ctx.answerCallbackQuery(errors.findFailed);
    }
  });

  // Delete liked user (add to ignored)
  bot.callbackQuery(/delete_liked:(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const likedUserId = parseInt(ctx.match[1]);
    try {
      // Get user ids from telegram_ids
      const userIdBigInt = await getUserIdFromTelegramId(userId);
      const likedUserIdBigInt = await getUserIdFromTelegramId(likedUserId);

      if (!userIdBigInt || !likedUserIdBigInt) {
        await ctx.answerCallbackQuery(errors.userNotFound);
        return;
      }

      await prisma.ignored.upsert({
        where: {
          user_id_ignored_user_id: {
            user_id: userIdBigInt,
            ignored_user_id: likedUserIdBigInt,
          },
        },
        create: {
          user_id: userIdBigInt,
          ignored_user_id: likedUserIdBigInt,
        },
        update: {},
      });

      // Invalidate match cache for both users (matches change when ignores are added)
      invalidateMatchCacheForUsers([userIdBigInt, likedUserIdBigInt]).catch(() => {});

      await ctx.answerCallbackQuery(callbacks.deleted);
      await showNextUser(ctx, userId, "liked");
    } catch (err) {
      log.error(BOT_NAME + " > Delete liked failed", err);
      await ctx.answerCallbackQuery(errors.deleteLikedFailed);
      notifyAdmin(
        `❌ <b>Delete Liked User Failed</b>\nUser: <code>${userId}</code>\nLiked User: <code>${likedUserId}</code>\nError: ${err}`
      );
    }
  });

  // Report user
  bot.callbackQuery(/report:(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const reportedUserId = parseInt(ctx.match[1]);
    if (userId === reportedUserId) {
      await ctx.answerCallbackQuery(errors.cannotReportSelf);
      return;
    }

    // Store in session for reason collection
    const session = await getSession(userId);
    session.reportingUserId = reportedUserId;

    await ctx.answerCallbackQuery();
    await ctx.reply(report.prompt);
  });

  // Ban action (admin only)
  bot.callbackQuery(/ban:(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdminUser(userId)) {
      await ctx.answerCallbackQuery(errors.accessDenied);
      return;
    }

    const bannedUserId = parseInt(ctx.match[1]);
    if (userId === bannedUserId) {
      await ctx.answerCallbackQuery(ban.cannotBanSelf);
      return;
    }

    // Store in session for duration selection
    const session = await getSession(userId);
    session.banningUserId = bannedUserId;

    await ctx.answerCallbackQuery();

    // Create inline keyboard with ban duration options
    const keyboard = new InlineKeyboard()
      .text(ban.twoDays, callbackQueries.banDuration(bannedUserId, "2days"))
      .text(ban.twoWeeks, callbackQueries.banDuration(bannedUserId, "2weeks"))
      .row()
      .text(ban.twoMonths, callbackQueries.banDuration(bannedUserId, "2months"))
      .text(ban.forever, callbackQueries.banDuration(bannedUserId, "forever"))
      .row()
      .text(ban.cancelButton, callbackQueries.banCancel(bannedUserId));

    await ctx.reply(ban.prompt, { reply_markup: keyboard });
  });

  // Handle ban duration selection
  bot.callbackQuery(/ban_duration:(\d+):(.+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdminUser(userId)) {
      await ctx.answerCallbackQuery(errors.accessDenied);
      return;
    }

    const bannedUserId = parseInt(ctx.match[1]);
    const duration = ctx.match[2];

    const session = await getSession(userId);
    if (session.banningUserId !== bannedUserId) {
      await ctx.answerCallbackQuery(ban.operationCancelled);
      return;
    }

    await ctx.answerCallbackQuery();

    try {
      // Get user ids from telegram_ids
      const bannerIdBigInt = await getUserIdFromTelegramId(userId);
      const bannedUserIdBigInt = await getUserIdFromTelegramId(bannedUserId);

      if (!bannerIdBigInt || !bannedUserIdBigInt) {
        delete session.banningUserId;
        await ctx.reply(errors.userNotFound);
        return;
      }

      // Calculate banned_until date based on duration
      let bannedUntil: Date | null = null;
      let durationText = "";
      const now = new Date();

      switch (duration) {
        case "2days":
          bannedUntil = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
          durationText = ban.twoDays;
          break;
        case "2weeks":
          bannedUntil = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
          durationText = ban.twoWeeks;
          break;
        case "2months":
          bannedUntil = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // Approximate 2 months
          durationText = ban.twoMonths;
          break;
        case "forever":
          bannedUntil = null; // null means forever
          durationText = ban.forever;
          break;
        default:
          delete session.banningUserId;
          await ctx.reply(ban.invalidDuration);
          return;
      }

      // Create ban record
      await prisma.ban.create({
        data: {
          banned_user_id: bannedUserIdBigInt,
          banner_id: bannerIdBigInt,
          banned_until: bannedUntil,
        },
      });

      // Notify admin
      notifyAdmin(
        `🚫 <b>User Banned</b>\n\n` +
          `Banned User ID: <code>${bannedUserId}</code>\n\n` +
          `Duration: ${durationText}\n` +
          `Banned by: <code>${userId}</code>`
      );

      delete session.banningUserId;
      await ctx.reply(ban.success(durationText));
    } catch (err) {
      log.error(BOT_NAME + " > Ban failed", err);
      delete session.banningUserId;
      await ctx.reply(ban.banFailed);
      notifyAdmin(
        `❌ <b>Ban Failed</b>\nBanned User: <code>${bannedUserId}</code>\nBanner: <code>${userId}</code>\nError: ${err}`
      );
    }
  });

  // Handle ban cancellation
  bot.callbackQuery(/ban_cancel:(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdminUser(userId)) {
      await ctx.answerCallbackQuery(errors.accessDenied);
      return;
    }

    const session = await getSession(userId);
    delete session.banningUserId;

    await ctx.answerCallbackQuery();
    await ctx.reply(ban.cancelled);
  });

  // Handle report reason
  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = await getSession(userId);
    if (session.reportingUserId) {
      const reportedUserId = session.reportingUserId;
      const reason = ctx.message.text;

      if (reason === "/cancel") {
        delete session.reportingUserId;
        await ctx.reply(report.cancelled);
        return;
      }

      try {
        // Get user ids from telegram_ids
        const userIdBigInt = await getUserIdFromTelegramId(userId);
        const reportedUserIdBigInt =
          await getUserIdFromTelegramId(reportedUserId);

        if (!userIdBigInt || !reportedUserIdBigInt) {
          await ctx.reply(errors.userNotFound);
          delete session.reportingUserId;
          return;
        }

        await prisma.report.create({
          data: {
            reporter_id: userIdBigInt,
            reported_user_id: reportedUserIdBigInt,
            reason,
          },
        });

        // Notify admin immediately
        notifyAdmin(
          `🚨 <b>New Report</b>\n\n` +
            `Reporter ID: <code>${userId}</code>\n\n` +
            `Reported ID: <code>${reportedUserId}</code>\n\n` +
            `Reason: ${reason}`
        );

        delete session.reportingUserId;
        await ctx.reply(success.reportSubmitted);
      } catch (err) {
        log.error(BOT_NAME + " > Report failed", err);
        delete session.reportingUserId; // Clear session state on error
        await ctx.reply(errors.reportFailed);
        notifyAdmin(
          `❌ <b>Report Submission Failed</b>\nReporter: <code>${userId}</code>\nReported: <code>${reportedUserId}</code>\nError: ${err}`
        );
      }
      return;
    }

    // Handle main menu button labels
    const text = ctx.message.text;
    if (text === mainMenuButtons.find) {
      try {
        await handleFind(ctx, userId, true, notifyAdmin);
      } catch (err) {
        log.error(BOT_NAME + " > Find from button failed", err);
        await ctx.reply(errors.findFailed);
      }
      return;
    }

    if (text === mainMenuButtons.liked) {
      try {
        await handleLiked(ctx, userId);
      } catch (err) {
        log.error(BOT_NAME + " > Liked from button failed", err);
        await ctx.reply(errors.likedFailed);
      }
      return;
    }

    if (text === mainMenuButtons.profile) {
      try {
        await handleDisplayProfile(ctx, userId, BOT_NAME, notifyAdmin);
      } catch (err) {
        log.error(BOT_NAME + " > Profile from button failed", err);
        await ctx.reply(errors.getProfileFailed);
      }
      return;
    }

    // Profile editing is now handled by setupProfileCallbacks
    await next();
  });

  // Callback: profile (from /start command) - shows profile with completion status
  bot.callbackQuery(callbackQueries.profile, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    await handleDisplayProfile(ctx, userId, BOT_NAME, notifyAdmin);
  });

  // Callback: find:start - triggers find functionality (same as /find command)
  bot.callbackQuery(callbackQueries.findStart, async (ctx) => {
    ctx.react("🤔").catch(() => {});
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      // Note: Rate limiting is skipped for button clicks to improve UX
      // Users can still use /find command which has rate limiting
      await handleFind(ctx, userId, false, notifyAdmin);
    } catch (err) {
      log.error(BOT_NAME + " > Find callback failed", err);
      await ctx.reply(errors.findFailed);
      notifyAdmin(
        `❌ <b>Find Callback Failed</b>\nUser: <code>${userId}</code>\nError: ${err}`
      );
    }
  });

  // Profile editing callbacks are now handled by setupProfileCallbacks
  // This is called at the end of setupCallbacks

  // Wipe data confirmation
  bot.callbackQuery(callbackQueries.wipeDataConfirm, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    await ctx.answerCallbackQuery();

    try {
      await deleteUserData(userId);

      // Clear session data
      const session = await getSession(userId);
      Object.keys(session).forEach(
        (key) => delete (session as Record<string, unknown>)[key]
      );

      await ctx.editMessageText(success.dataDeleted);

      // Notify admin
      notifyAdmin(
        `🗑️ <b>User Data Deleted</b>\nUser: <code>${userId}</code>\nAll data has been permanently deleted.`
      );
    } catch (err) {
      log.error(BOT_NAME + " > Delete user data failed", err);
      await ctx.editMessageText(errors.deleteFailed);
      notifyAdmin(
        `❌ <b>Delete User Data Failed</b>\nUser: <code>${userId}</code>\nError: ${err}`
      );
    }
  });

  bot.callbackQuery(callbackQueries.wipeDataCancel, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    await ctx.answerCallbackQuery();

    await ctx.editMessageText(deleteData.cancelled);
  });

  // Settings: wipe_data callback
  bot.callbackQuery(callbackQueries.settingsWipeData, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    await ctx.answerCallbackQuery();

    try {
      const profile = await getUserProfile(userId);
      if (!profile) {
        await ctx.editMessageText(errors.startFirst);
        return;
      }

      const keyboard = new InlineKeyboard()
        .text(deleteData.buttons.confirm, callbackQueries.wipeDataConfirm)
        .row()
        .text(deleteData.buttons.cancel, callbackQueries.wipeDataCancel);

      await ctx.editMessageText(deleteData.confirmPrompt, {
        reply_markup: keyboard,
        parse_mode: "HTML",
      });
    } catch (err) {
      log.error(BOT_NAME + " > Settings wipe_data callback failed", err);
      await ctx.editMessageText(errors.commandFailed);
      notifyAdmin(
        `❌ <b>Settings Wipe Data Callback Failed</b>\nUser: <code>${userId}</code>\nError: ${err}`
      );
    }
  });

  // Photo uploads for profile image are now handled by setupProfileCallbacks

  // Admin callbacks
  if (ADMIN_USER_ID) {
    // Admin: Users list with pagination
    bot.callbackQuery(/^admin:users:(\d+)$/, async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId || userId !== ADMIN_USER_ID) {
        await ctx.answerCallbackQuery(errors.accessDenied);
        return;
      }

      await ctx.answerCallbackQuery();

      try {
        const page = parseInt(ctx.match[1]);
        await displayUsersToAdmin(ctx, page);
      } catch (err) {
        log.error(BOT_NAME + " > Admin users failed", err);
        await ctx.reply(errors.usersFailed);
      }
    });

    // Admin: Reports
    bot.callbackQuery(/^admin:reports$/, async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId || userId !== ADMIN_USER_ID) {
        await ctx.answerCallbackQuery(errors.accessDenied);
        return;
      }

      await ctx.answerCallbackQuery();

      try {
        // Only show unresolved reports
        const reports = await prisma.report.findMany({
          where: {
            resolved: false,
          },
          take: 50, // Show last 50 unresolved reports
          orderBy: { created_at: "desc" },
          include: {
            reporter: {
              select: {
                telegram_id: true,
                display_name: true,
                username: true,
              },
            },
            reportedUser: {
              select: {
                telegram_id: true,
                display_name: true,
                username: true,
              },
            },
          },
        });

        if (reports.length === 0) {
          await ctx.reply(admin.noReports);
          return;
        }

        const keyboard = new InlineKeyboard();
        let message = `${admin.reportsTitle(reports.length)}\n\n`;
        
        for (const report of reports) {
          const reporterName =
            report.reporter.display_name ||
            report.reporter.username ||
            `${admin.userPrefix} ${report.reporter.telegram_id}`;
          const reportedName =
            report.reportedUser.display_name ||
            report.reportedUser.username ||
            `${admin.userPrefix} ${report.reportedUser.telegram_id}`;
          const reason = report.reason || admin.noReason;
          const date = report.created_at.toLocaleDateString("fa-IR");

          message += `${admin.reportLabels.reporter} ${reporterName} (<code>${report.reporter.telegram_id}</code>)\n`;
          message += `${admin.reportLabels.reported} ${reportedName} (<code>${report.reported_user_id}</code>)\n`;
          message += `${admin.reportLabels.reason} ${reason}\n`;
          message += `${admin.reportLabels.date} ${date}\n`;
          
          // Add resolve button for each report
          keyboard.text(admin.resolveReport, callbackQueries.resolveReport(Number(report.id))).row();
          message += "\n";
        }

        await ctx.reply(message, { 
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
      } catch (err) {
        log.error(BOT_NAME + " > Admin reports failed", err);
        await ctx.reply(errors.reportsFailed);
      }
    });

    // Admin: Resolve report
    bot.callbackQuery(/^resolve_report:(\d+)$/, async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId || userId !== ADMIN_USER_ID) {
        await ctx.answerCallbackQuery(errors.accessDenied);
        return;
      }

      const reportId = BigInt(ctx.match[1]);
      await ctx.answerCallbackQuery();

      try {
        // Update report as resolved
        await prisma.report.update({
          where: { id: reportId },
          data: { resolved: true },
        });

        await ctx.reply(admin.reportResolved);
        
        // Get updated reports list to show remaining unresolved reports
        const reports = await prisma.report.findMany({
          where: {
            resolved: false,
          },
          take: 50,
          orderBy: { created_at: "desc" },
          include: {
            reporter: {
              select: {
                telegram_id: true,
                display_name: true,
                username: true,
              },
            },
            reportedUser: {
              select: {
                telegram_id: true,
                display_name: true,
                username: true,
              },
            },
          },
        });

        if (reports.length === 0) {
          await ctx.reply(admin.noReports);
          return;
        }

        const keyboard = new InlineKeyboard();
        let message = `${admin.reportsTitle(reports.length)}\n\n`;
        
        for (const report of reports) {
          const reporterName =
            report.reporter.display_name ||
            report.reporter.username ||
            `${admin.userPrefix} ${report.reporter.telegram_id}`;
          const reportedName =
            report.reportedUser.display_name ||
            report.reportedUser.username ||
            `${admin.userPrefix} ${report.reportedUser.telegram_id}`;
          const reason = report.reason || admin.noReason;
          const date = report.created_at.toLocaleDateString("fa-IR");

          message += `${admin.reportLabels.reporter} ${reporterName} (<code>${report.reporter.telegram_id}</code>)\n`;
          message += `${admin.reportLabels.reported} ${reportedName} (<code>${report.reported_user_id}</code>)\n`;
          message += `${admin.reportLabels.reason} ${reason}\n`;
          message += `${admin.reportLabels.date} ${date}\n`;
          
          keyboard.text(admin.resolveReport, callbackQueries.resolveReport(Number(report.id))).row();
          message += "\n";
        }

        await ctx.reply(message, { 
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
      } catch (err) {
        log.error(BOT_NAME + " > Resolve report failed", err);
        await ctx.reply(admin.resolveReportFailed);
        notifyAdmin(
          `❌ <b>Resolve Report Failed</b>\nReport ID: <code>${reportId}</code>\nAdmin: <code>${userId}</code>\nError: ${err}`
        );
      }
    });
  }

  // Setup shared profile callbacks (all profile editing)
  setupProfileCallbacks(bot, {
    botName: BOT_NAME,
    getSession,
    onContinueProfileCompletion: continueProfileCompletion,
    notifyAdmin,
  });
}
