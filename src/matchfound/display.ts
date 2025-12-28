import { readFileSync } from "fs";
import path from "path";
import { Context, InlineKeyboard, InputFile } from "grammy";
import { prisma } from "../db";
import log from "../log";
import { MAX_COMPATIBILITY_SCORE, MOODS } from "../shared/constants";
import { isUserBanned } from "../shared/database";
import { buildQuizResultsSection } from "../shared/display";
import { getInterestNames } from "../shared/i18n";
import { UserProfile } from "../shared/types";
import { callbacks as callbackQueries } from "./callbackQueries";
import { BOT_NAME } from "./constants";
import {
  calculateCompatibilityScore as calculateCompatibilityScoreCore,
  calculateMatchInfo,
  calculateMutualInterestsCount,
  isAdminContext,
} from "./helpers";
import { admin, buttons, display, profileValues } from "./strings";
import { DisplayMode, MatchUser, SessionData } from "./types";

// Cache placeholder avatars at module load to avoid reading from disk every time
const PLACEHOLDER_AVATARS = (() => {
  try {
    const malePath = path.join(process.cwd(), "assets/avatars/placeholder-avatar-male.jpg");
    const femalePath = path.join(process.cwd(), "assets/avatars/placeholder-avatar-female.jpg");

    return {
      male: new InputFile(readFileSync(malePath), "placeholder-avatar-male.jpg"),
      female: new InputFile(readFileSync(femalePath), "placeholder-avatar-female.jpg"),
    };
  } catch (err) {
    log.error(BOT_NAME + " > Failed to load placeholder avatars", err);
    // Return empty objects as fallback (will cause error later, but at least won't crash on startup)
    return {
      male: new InputFile(Buffer.alloc(0), "placeholder-avatar-male.jpg"),
      female: new InputFile(Buffer.alloc(0), "placeholder-avatar-female.jpg"),
    };
  }
})();

// Helper function to format last_online date in Persian
function formatLastOnline(lastOnline: Date | null): string {
  if (!lastOnline) return display.lastOnlineNever;

  const now = new Date();
  const diffMs = now.getTime() - lastOnline.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return display.lastOnlineJustNow;
  } else if (diffMinutes < 60) {
    return display.lastOnlineMinutesAgo(diffMinutes);
  } else if (diffHours < 24) {
    return display.lastOnlineHoursAgo(diffHours);
  } else if (diffDays < 7) {
    return display.lastOnlineDaysAgo(diffDays);
  } else {
    // Format as date for older entries
    const date = new Date(lastOnline);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}/${month}/${day}`;
  }
}

// Helper function to calculate compatibility score between two users
function calculateCompatibilityScore(currentUser: UserProfile, otherUser: MatchUser): number {
  const currentUserAge = currentUser.age || 0;
  const otherUserAge = otherUser.age || 0;

  // Calculate match information (archetype, MBTI, mutual interests)
  const { archetypeMatch, mbtiMatch, mutualInterestsCount } = calculateMatchInfo(currentUser, otherUser);

  // Use shared compatibility score calculation
  const compatibilityScore = calculateCompatibilityScoreCore(
    archetypeMatch,
    mbtiMatch,
    mutualInterestsCount,
    currentUserAge || 0,
    otherUserAge,
    otherUser.completion_score,
  );

  // Round and cap at MAX_COMPATIBILITY_SCORE
  return Math.min(Math.round(compatibilityScore), MAX_COMPATIBILITY_SCORE);
}

// Helper to build ban status text
async function buildBanStatusText(userTelegramId: number | null): Promise<string> {
  if (!userTelegramId) return "";

  const banStatus = await isUserBanned(userTelegramId);
  if (!banStatus.banned) {
    return `\n${display.banStatusActive}`;
  }

  if (banStatus.bannedUntil === null) {
    return `\n${display.banStatusPermanent}`;
  }

  const now = new Date();
  const diffMs = banStatus.bannedUntil.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return `\n${display.banStatusTemporary(diffDays)}`;
}

// Helper to build interests section
async function buildInterestsSection(
  user: MatchUser,
  userInterests: string[] | undefined,
  viewerId: number | undefined,
): Promise<string> {
  if (!user.interests?.length) return "";

  const [interestNamesMap] = await Promise.all([getInterestNames(viewerId, BOT_NAME)]);

  const interestNames = user.interests
    .map((interest) => interestNamesMap[interest as keyof typeof interestNamesMap] || interest)
    .join(", ");

  const mutualCount = calculateMutualInterestsCount(userInterests, user.interests);
  const mutualInterestsText = mutualCount > 0 ? display.mutualInterests(mutualCount) : "";

  return `\n${display.interestsLabel} ${interestNames}${mutualInterestsText}`;
}

// Helper to build admin info section
async function buildAdminInfoSection(user: MatchUser, isAdmin: boolean): Promise<string> {
  if (!isAdmin) return "";

  let section = `\n\n${display.adminUsername} ${user.username ? `@${user.username}` : display.usernameNotSet}`;
  const lastOnlineText = formatLastOnline(user.last_online);
  section += `\n${display.adminLastActivity} ${lastOnlineText}`;

  if (user.telegram_id) {
    const banStatusText = await buildBanStatusText(user.telegram_id);
    section += banStatusText;
  }

  return section;
}

// Helper to get placeholder avatar image based on gender (uses cached images)
function getPlaceholderAvatar(gender: string | null | undefined): InputFile {
  const genderLower = gender?.toLowerCase();
  // Use cached placeholder avatar based on gender, default to male
  return genderLower === "female" ? PLACEHOLDER_AVATARS.female : PLACEHOLDER_AVATARS.male;
}

// Helper to get user image (profile image or placeholder)
function getUserImage(user: MatchUser): string | InputFile {
  if (user.profile_image) {
    // profile_image is a Telegram file ID (string)
    return user.profile_image;
  }
  // Return placeholder as InputFile
  return getPlaceholderAvatar(user.gender);
}

export async function displayUser(
  ctx: Context,
  user: MatchUser,
  mode: DisplayMode = "match",
  session?: SessionData,
  currentUserProfile?: UserProfile,
  editMessage: boolean = false,
) {
  // Check if viewing user is admin
  const isAdmin = isAdminContext(ctx);

  // Calculate compatibility score
  const compatibilityScore =
    user.compatibility_score ??
    (currentUserProfile ? calculateCompatibilityScore(currentUserProfile, user) : undefined);

  // Derive user interests from currentUserProfile
  const userInterests = currentUserProfile?.interests ?? undefined;

  // Build message sections in parallel where possible
  const [quizResultsSection, interestsSection, adminInfoSection] = await Promise.all([
    buildQuizResultsSection(user, BOT_NAME, ctx.from?.id, false),
    buildInterestsSection(user, userInterests, ctx.from?.id),
    isAdmin ? buildAdminInfoSection(user, isAdmin) : Promise.resolve(""),
  ]);

  // Build main message
  const ageText = user.age ? `${user.age} ${profileValues.year}` : display.unknownAge;
  const nameText = user.display_name || display.noName;
  const bioText = user.biography || display.noBio;
  const compatibilityText = compatibilityScore !== undefined ? display.compatibility(compatibilityScore) : "";

  let message = `${display.namePrefix} ${nameText}\n`;
  message += `${display.agePrefix} ${ageText}${compatibilityText}\n\n`;
  message += `${display.bioPrefix} ${bioText}`;

  if (quizResultsSection) {
    message += `\n${quizResultsSection}`;
  }

  if (user.mood) {
    message += `\n${display.moodLabel} ${MOODS[user.mood] || user.mood}`;
  }

  message += interestsSection;
  message += adminInfoSection;

  const keyboard = new InlineKeyboard();
  // Show like/dislike buttons for all users (including admins)
  keyboard.text(buttons.like, callbackQueries.like(user.telegram_id || 0));
  if (mode === "liked") {
    keyboard.text(buttons.delete, callbackQueries.deleteLiked(user.telegram_id || 0));
    if (user.username) {
      keyboard.url(buttons.chat, `https://t.me/${user.username}`);
    }
  } else {
    // match or admin mode
    keyboard.text(buttons.dislike, callbackQueries.dislike(user.telegram_id || 0));
  }
  keyboard.row();

  // Add Prev/Next navigation buttons for match mode
  if (mode === "match" && session && session.matchIds && session.currentMatchIndex !== undefined) {
    const currentIndex = session.currentMatchIndex;
    const totalMatches = session.matchIds.length;

    // Show prev button if not on first match
    if (currentIndex > 0) {
      keyboard.text(buttons.previous, callbackQueries.prevMatch(user.telegram_id || 0));
    }
    // Show next button if not on last match
    if (currentIndex < totalMatches - 1) {
      keyboard.text(buttons.next, callbackQueries.nextMatch(user.telegram_id || 0));
    }
    if (currentIndex > 0 || currentIndex < totalMatches - 1) {
      keyboard.row();
    }
  }

  // Only show report button if not admin
  if (!isAdmin) {
    keyboard.text(buttons.report, callbackQueries.report(user.telegram_id || 0));
  }

  // Add ban button if admin
  if (isAdmin) {
    keyboard.row();
    keyboard.text(buttons.ban, callbackQueries.ban(user.telegram_id || 0));
  }

  // Get user image (profile image or placeholder)
  const userImage = getUserImage(user);

  try {
    // If editing message, use edit methods instead of reply
    if (editMessage && ctx.callbackQuery?.message) {
      // Always edit as photo (since we always have a placeholder now)
      try {
        await ctx.editMessageMedia({ type: "photo", media: userImage, caption: message }, { reply_markup: keyboard });
      } catch (editErr) {
        // If edit fails, send new message
        log.info(BOT_NAME + " > Edit media failed, sending new message", { error: editErr });
        await ctx.replyWithPhoto(userImage, { caption: message, reply_markup: keyboard });
      }
    } else {
      // Send new message (always with photo now)
      await ctx.replyWithPhoto(userImage, {
        caption: message,
        reply_markup: keyboard,
      });
    }
  } catch (err) {
    const errorContext = mode === "match" ? "match" : "liked user";
    log.error(BOT_NAME + ` > Display ${errorContext} failed`, err);
    // Try to send just the message without image if photo send fails
    if (!editMessage) {
      try {
        await ctx.reply(message, { reply_markup: keyboard });
      } catch (replyErr) {
        log.error(BOT_NAME + ` > Display ${errorContext} reply failed`, replyErr);
        throw err; // Re-throw original error
      }
    } else {
      throw err;
    }
  }
}

export async function displayUsersToAdmin(ctx: Context, page: number = 0, usersPerPage: number = 10) {
  const skip = page * usersPerPage;

  const [users, totalCount] = await Promise.all([
    prisma.user.findMany({
      skip,
      take: usersPerPage,
      orderBy: { created_at: "desc" },
      select: {
        telegram_id: true,
        username: true,
        display_name: true,
        completion_score: true,
        created_at: true,
        last_online: true,
        gender: true,
        looking_for_gender: true,
        language: true,
        archetype_result: true,
        mbti_result: true,
        leftright_result: true,
        politicalcompass_result: true,
        enneagram_result: true,
        bigfive_result: true,
        mentalage_result: true,
      },
    }),
    prisma.user.count(),
  ]);

  if (users.length === 0) {
    await ctx.reply(admin.noUsers);
    return;
  }

  let message = `${admin.allUsersTitle(totalCount)}\n\n`;

  users.forEach((user, index) => {
    const number = skip + index + 1;
    const telegramId = user.telegram_id ? Number(user.telegram_id) : "N/A";
    const username = user.username ? `@${user.username}` : "N/A";
    const displayName = user.display_name || "N/A";
    const completionScore = user.completion_score || 0;
    const createdAt = user.created_at.toLocaleDateString("en-US");
    const lastOnline = user.last_online ? user.last_online.toLocaleDateString("en-US") : "Never";
    const gender = user.gender || "N/A";
    const lookingFor = user.looking_for_gender || "N/A";
    const language = user.language || "N/A";

    message += `${number}. ID: ${telegramId}\n`;
    message += `   Username: ${username}\n`;
    message += `   Name: ${displayName}\n`;
    message += `   Completion: ${completionScore}%\n`;
    message += `   Gender: ${gender} | Looking for: ${lookingFor}\n`;
    message += `   Language: ${language}\n`;

    // Show exam results if available
    const examResults = [];
    if (user.archetype_result) examResults.push(`Archetype: ${user.archetype_result}`);
    if (user.mbti_result) examResults.push(`MBTI: ${user.mbti_result}`);
    if (user.enneagram_result) examResults.push(`Enneagram: ${user.enneagram_result}`);
    if (user.leftright_result) examResults.push(`LeftRight: ${user.leftright_result}`);
    if (user.politicalcompass_result) examResults.push(`PolCompass: ${user.politicalcompass_result}`);
    // if (user.bigfive_result) examResults.push(`BigFive: ${user.bigfive_result.substring(0, 20)}...`);
    if (user.mentalage_result) examResults.push(`MentalAge: ${user.mentalage_result}`);

    if (examResults.length > 0) {
      message += `   Exams: ${examResults.join(" | ")}\n`;
    }

    message += `   Created: ${createdAt} | Last online: ${lastOnline}\n\n`;
  });

  const keyboard = new InlineKeyboard();

  if (page > 0) {
    keyboard.text("◀️ Prev", callbackQueries.adminUsers(page - 1));
  }

  if (skip + usersPerPage < totalCount) {
    keyboard.text("Next ▶️", callbackQueries.adminUsers(page + 1));
  }

  try {
    await ctx.editMessageText(message, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } catch {
    // If message doesn't exist (first time), use reply instead
    await ctx.reply(message, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
}
