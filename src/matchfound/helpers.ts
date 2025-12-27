import { Bot, Context, InlineKeyboard, Keyboard } from "grammy";
import { prisma } from "../db";
import {
  ARCHETYPE_MATCH_SCORE,
  FIELD_KEY,
  MAX_AGE_BONUS,
  MAX_AGE_DIFFERENCE,
  MAX_COMPATIBILITY_SCORE,
  MAX_COMPLETION_BONUS,
  MAX_COMPLETION_SCORE,
  MAX_INTERESTS,
  MAX_INTERESTS_SCORE,
  MBTI_MATCH_SCORE,
  type ProfileFieldKey,
  INMANKIST_BOT_USERNAME,
  INTERESTS,
  ITEMS_PER_PAGE,
  MIN_INTERESTS,
  MIN_COMPLETION_THRESHOLD,
} from "../shared/constants";
import { callbacks as callbackQueries } from "./callbackQueries";
import {
  getUserIdFromTelegramId,
  getUserProfile,
  updateUserField,
  isUserBanned,
} from "../shared/database";
import { getInterestNames } from "../shared/i18n";
import { UserProfile } from "../shared/types";
import { getWithPrefix, setWithPrefix } from "../redis";
import {
  BOT_NAME,
  BOT_PREFIX,
  FIND_RATE_LIMIT_MS,
  FIND_RATE_LIMIT_SECONDS,
  archetypeCompatibility,
  mbtiCompatibility,
} from "./constants";
import { ADMIN_USER_ID } from "../shared/constants";
import { displayUser } from "./display";
import { findMatches } from "./matching";
import { getSession } from "./session";
import {
  buttons,
  display,
  editPrompts,
  errors,
  fields,
  general,
  mainMenuButtons,
  profileCompletion,
  profileValues,
  success,
} from "./strings";
import { MatchUser, MatchMetadata, DisplayMode } from "./types";

/**
 * Calculate mutual interests count between two users
 */
export function calculateMutualInterestsCount(
  userInterests: string[] | null | undefined,
  otherUserInterests: string[] | null | undefined
): number {
  if (
    !userInterests ||
    !otherUserInterests ||
    userInterests.length === 0 ||
    otherUserInterests.length === 0
  ) {
    return 0;
  }

  const otherInterestsSet = new Set(otherUserInterests);
  // Iterate over user interests and count matches (more efficient than Array.from + filter)
  let count = 0;
  for (const interest of userInterests) {
    if (otherInterestsSet.has(interest)) {
      count++;
    }
  }
  return count;
}

/**
 * Calculate match information between two users (archetype, MBTI, mutual interests)
 */
export function calculateMatchInfo(
  user: { archetype_result?: string | null; mbti_result?: string | null; gender?: string | null; interests?: string[] | null },
  otherUser: { archetype_result?: string | null; mbti_result?: string | null; gender?: string | null; interests?: string[] | null }
): {
  archetypeMatch: boolean;
  mbtiMatch: boolean;
  mutualInterestsCount: number;
} {
  // Check archetype compatibility
  let archetypeMatch = false;
  if (user.archetype_result && otherUser.archetype_result) {
    const userArchetype = user.archetype_result.toLowerCase();
    const targetArchetype = otherUser.archetype_result.toLowerCase();

    if (user.gender === otherUser.gender) {
      // Same-gender matching: same archetype
      archetypeMatch = userArchetype === targetArchetype;
    } else {
      // Opposite-gender matching: use compatibility matrix
      const compatible = archetypeCompatibility[userArchetype] || [];
      archetypeMatch = compatible.includes(targetArchetype);
    }
  }

  // Check MBTI compatibility
  let mbtiMatch = false;
  if (user.mbti_result && otherUser.mbti_result) {
    const userMBTI = user.mbti_result.toUpperCase();
    const targetMBTI = otherUser.mbti_result.toUpperCase();
    const compatible = mbtiCompatibility[userMBTI] || [];
    mbtiMatch = compatible.includes(targetMBTI);
  }

  // Calculate mutual interests
  const mutualInterestsCount = calculateMutualInterestsCount(
    user.interests,
    otherUser.interests
  );

  return {
    archetypeMatch,
    mbtiMatch,
    mutualInterestsCount,
  };
}

/**
 * Calculate mutual interests score contribution to compatibility
 * Returns score from 0 to MAX_INTERESTS_SCORE based on number of mutual interests
 */
function calculateInterestsScore(mutualInterestsCount: number): number {
  if (mutualInterestsCount <= 0) {
    return 0;
  }
  // Mutual interests: up to MAX_INTERESTS_SCORE (scaled by number of mutual interests, max MAX_INTERESTS)
  // Formula: (mutualInterestsCount / MAX_INTERESTS) * MAX_INTERESTS_SCORE
  return Math.min(
    (mutualInterestsCount / MAX_INTERESTS) * MAX_INTERESTS_SCORE,
    MAX_INTERESTS_SCORE
  );
}

/**
 * Calculate compatibility score (0-MAX_COMPATIBILITY_SCORE)
 */
export function calculateCompatibilityScore(
  archetypeMatch: boolean,
  mbtiMatch: boolean,
  mutualInterestsCount: number,
  userAge: number,
  matchUserAge: number | null,
  matchUserCompletionScore: number
): number {
  let compatibilityScore = 0;

  // Archetype match
  if (archetypeMatch) {
    compatibilityScore += ARCHETYPE_MATCH_SCORE;
  }

  // MBTI match
  if (mbtiMatch) {
    compatibilityScore += MBTI_MATCH_SCORE;
  }

  // Mutual interests score
  compatibilityScore += calculateInterestsScore(mutualInterestsCount);

  // Age difference bonus: up to MAX_AGE_BONUS (smaller difference = higher bonus)
  // Max age difference is MAX_AGE_DIFFERENCE years
  const ageDiff = Math.abs((matchUserAge || 0) - userAge);
  const ageBonus = Math.max(
    0,
    MAX_AGE_BONUS - (ageDiff / MAX_AGE_DIFFERENCE) * MAX_AGE_BONUS
  );
  compatibilityScore += ageBonus;

  // Completion score bonus: up to MAX_COMPLETION_BONUS (higher score = higher bonus)
  const completionBonus = Math.min(
    (matchUserCompletionScore / MAX_COMPLETION_SCORE) * MAX_COMPLETION_BONUS,
    MAX_COMPLETION_BONUS
  );
  compatibilityScore += completionBonus;

  // Cap at MAX_COMPATIBILITY_SCORE
  return Math.min(compatibilityScore, MAX_COMPATIBILITY_SCORE);
}

// Helper to check if a user is admin
export function isAdminUser(userId: number | undefined): boolean {
  return ADMIN_USER_ID !== undefined && userId === ADMIN_USER_ID;
}

// Helper to check if the current context user is admin
export function isAdminContext(ctx: { from?: { id?: number } }): boolean {
  return isAdminUser(ctx.from?.id);
}

// Helper to convert MatchUser[] to optimized session format (IDs + metadata)
export function storeMatchesInSession(
  matches: MatchUser[],
  session: {
    matchIds?: number[];
    matchMetadata?: Record<number, MatchMetadata>;
  }
): void {
  session.matchIds = matches.map((m) => m.telegram_id || 0);
  session.matchMetadata = {};
  for (const match of matches) {
    if (match.telegram_id) {
      session.matchMetadata[match.telegram_id] = {
        match_priority: match.match_priority,
        compatibility_score: match.compatibility_score,
      };
    }
  }
}

// Helper to fetch a MatchUser by telegram_id with metadata
async function getMatchUserById(
  telegramId: number,
  metadata?: MatchMetadata
): Promise<MatchUser | null> {
  const profile = await getUserProfile(telegramId);
  if (!profile) return null;

  return {
    ...profile,
    age: profile.age || null,
    match_priority: metadata?.match_priority ?? 999,
    compatibility_score: metadata?.compatibility_score,
  };
}

// Helper to get current match from session
async function getCurrentMatch(session: {
  matchIds?: number[];
  matchMetadata?: Record<number, MatchMetadata>;
  currentMatchIndex?: number;
}): Promise<MatchUser | null> {
  if (
    !session.matchIds ||
    session.currentMatchIndex === undefined ||
    session.currentMatchIndex < 0 ||
    session.currentMatchIndex >= session.matchIds.length
  ) {
    return null;
  }

  const telegramId = session.matchIds[session.currentMatchIndex];
  const metadata = session.matchMetadata?.[telegramId];
  return await getMatchUserById(telegramId, metadata);
}

// Validate profile for find command (shared between /find and find:start callback)
export async function validateProfileForFind(
  profile: UserProfile | null,
  ctx: Context,
  userId?: number
): Promise<boolean> {
  if (!profile) {
    await ctx.reply(errors.startFirst);
    return false;
  }

  // Check if user is banned
  if (userId) {
    const banStatus = await isUserBanned(userId);
    if (banStatus.banned) {
      await ctx.reply(errors.userBanned(banStatus.bannedUntil));
      return false;
    }
  }

  // Check required fields first (these are mandatory for matching to work)
  const missingRequiredFields: string[] = [];
  if (!profile.username) missingRequiredFields.push(fields.username);
  if (!profile.display_name) missingRequiredFields.push(fields.displayName);
  if (!profile.gender) missingRequiredFields.push(fields.gender);
  if (!profile.looking_for_gender)
    missingRequiredFields.push(fields.lookingForGender);
  if (!profile.age) missingRequiredFields.push(fields.age);

  // Check interests separately to show specific count
  if (!profile.interests || profile.interests.length < MIN_INTERESTS) {
    await ctx.reply(errors.minInterestsNotMet(profile.interests?.length || 0));
    return false;
  }

  if (missingRequiredFields.length > 0) {
    await ctx.reply(errors.missingRequiredFields(missingRequiredFields));
    return false;
  }

  // Check minimum completion for other optional fields
  if (profile.completion_score < MIN_COMPLETION_THRESHOLD) {
    await ctx.reply(errors.incompleteProfile(profile.completion_score));
    return false;
  }

  return true;
}

// Handle find functionality (shared between /find command and find:start callback)
export async function handleFind(
  ctx: Context,
  userId: number,
  checkRateLimit: boolean = true,
  notifyAdmin?: (message: string) => Promise<void>
): Promise<void> {
  const profile = await getUserProfile(userId);
  if (!(await validateProfileForFind(profile, ctx, userId))) {
    return;
  }

  await executeFindAndDisplay(ctx, userId, profile!, checkRateLimit, notifyAdmin);
}

// Execute find matches and display first result (shared logic)
export async function executeFindAndDisplay(
  ctx: Context,
  userId: number,
  profile: UserProfile,
  checkRateLimit: boolean = true,
  notifyAdmin?: (message: string) => Promise<void>
): Promise<void> {
  // Rate limiting (once per hour) - only for /find command, not button clicks
  // Skip rate limiting for admin users
  if (checkRateLimit && !isAdminUser(userId)) {
    const rateLimitKey = `ratelimit:find:${userId}`;
    const lastFindTimestamp = await getWithPrefix(BOT_PREFIX, rateLimitKey);

    if (lastFindTimestamp) {
      const lastFind = parseInt(lastFindTimestamp, 10);
      const now = Date.now();
      if (now - lastFind < FIND_RATE_LIMIT_MS) {
        const remainingMinutes = Math.ceil(
          (FIND_RATE_LIMIT_MS - (now - lastFind)) / 60000
        );
        await ctx.reply(errors.rateLimit(remainingMinutes));
        return;
      }
    }

    // Set rate limit with TTL (expires after FIND_RATE_LIMIT_SECONDS)
    await setWithPrefix(
      BOT_PREFIX,
      rateLimitKey,
      Date.now().toString(),
      FIND_RATE_LIMIT_SECONDS
    );
  }

  const matches = await findMatches(userId);
  if (matches.length === 0) {
    await ctx.reply(errors.noMatches);
    return;
  }

  // Store matches in optimized format (IDs + metadata only)
  const session = await getSession(userId);
  storeMatchesInSession(matches, session);
  session.currentMatchIndex = 0;

  // Show match count
  await ctx.reply(success.matchesFound(matches.length));

  // Notify admin about /find command (privacy-respecting: only user ID and match count)
  if (notifyAdmin) {
    notifyAdmin(
      `🔍 <b>User Searched for Matches</b>\nUser ID: <code>${userId}</code>\nMatches Found: ${matches.length}`
    );
  }

  // Show first match (with username if admin)
  const firstMatch = matches[0];
  await displayUser(ctx, firstMatch, "match", session, profile);
}

// Helper to show next user after action (like/dislike/next/delete)
export async function showNextUser(
  ctx: Context,
  userId: number,
  type: DisplayMode
): Promise<void> {
  const session = await getSession(userId);
  const profile = await getUserProfile(userId);

  if (
    type === "match" &&
    session.matchIds &&
    session.currentMatchIndex !== undefined
  ) {
    session.currentMatchIndex++;
    if (session.currentMatchIndex < session.matchIds.length) {
      const match = await getCurrentMatch(session);
      if (match) {
        await displayUser(ctx, match, "match", session, profile || undefined);
      } else {
        await ctx.reply(errors.noMatches);
      }
    } else {
      await ctx.reply(errors.noMatches);
    }
  } else if (
    type === "liked" &&
    session.likedUserIds &&
    session.currentLikedIndex !== undefined
  ) {
    session.currentLikedIndex++;
    if (session.currentLikedIndex < session.likedUserIds.length) {
      const telegramId = session.likedUserIds[session.currentLikedIndex];
      const likedUser = await getMatchUserById(telegramId);
      if (likedUser) {
        await displayUser(
          ctx,
          likedUser,
          "liked",
          undefined,
          profile || undefined
        );
      } else {
        await ctx.reply(display.allLikedSeen);
      }
    } else {
      await ctx.reply(display.allLikedSeen);
    }
  }
}

// Handle liked users functionality (shared between /liked command)
export async function handleLiked(ctx: Context, userId: number): Promise<void> {
  // Get user id from telegram_id
  const userIdBigInt = await getUserIdFromTelegramId(userId);
  if (!userIdBigInt) {
    await ctx.reply(errors.userNotFound);
    return;
  }

  // Get users who liked this user (and not ignored)
  const likes = await prisma.like.findMany({
    where: {
      liked_user_id: userIdBigInt,
      user: {
        ignoredReceived: {
          none: {
            user_id: userIdBigInt,
          },
        },
      },
    },
    include: {
      user: true,
    },
    orderBy: {
      created_at: "desc",
    },
  });

  // Filter out users that this user has ignored
  const ignoredByUser = await prisma.ignored.findMany({
    where: { user_id: userIdBigInt },
    select: { ignored_user_id: true },
  });
  const ignoredIds = new Set(
    ignoredByUser.map((i: { ignored_user_id: bigint }) => i.ignored_user_id)
  );
  const filteredLikes = likes.filter(
    (like: (typeof likes)[0]) => !ignoredIds.has(like.user_id)
  );

  if (filteredLikes.length === 0) {
    await ctx.reply(errors.noLikes);
    return;
  }

  // Store in optimized format (IDs only)
  const session = await getSession(userId);
  session.likedUserIds = filteredLikes.map((like: (typeof filteredLikes)[0]) =>
    Number(like.user.telegram_id)
  );
  session.currentLikedIndex = 0;

  // Show first person
  const firstTelegramId = session.likedUserIds[0];
  const firstUser = await getMatchUserById(firstTelegramId);
  if (!firstUser) {
    await ctx.reply(errors.noLikes);
    return;
  }
  const profile = await getUserProfile(userId);
  await displayUser(ctx, firstUser, "liked", undefined, profile || undefined);
}

// Profile completion helpers
interface RequiredField {
  key: keyof UserProfile;
  name: string;
  type: "text" | "select" | "date" | "interests" | "username";
}

// Field type constants
const FIELD_TYPE = {
  USERNAME: "username",
  TEXT: "text",
  SELECT: "select",
  DATE: "date",
  INTERESTS: "interests",
} as const;

const REQUIRED_FIELDS: RequiredField[] = [
  { key: FIELD_KEY.USERNAME, name: fields.username, type: FIELD_TYPE.USERNAME },
  {
    key: FIELD_KEY.DISPLAY_NAME,
    name: fields.displayName,
    type: FIELD_TYPE.TEXT,
  },
  { key: FIELD_KEY.GENDER, name: fields.gender, type: FIELD_TYPE.SELECT },
  {
    key: FIELD_KEY.LOOKING_FOR_GENDER,
    name: fields.lookingForGender,
    type: FIELD_TYPE.SELECT,
  },
  { key: FIELD_KEY.AGE, name: fields.age, type: FIELD_TYPE.TEXT },
  {
    key: FIELD_KEY.INTERESTS,
    name: fields.interests,
    type: FIELD_TYPE.INTERESTS,
  },
];

// Reusable keyboard for main actions (inline)
export function createMainActionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(buttons.completionStatus, callbackQueries.profile)
    .row()
    .text(buttons.findPeople, callbackQueries.findStart)
    .row()
    .url(
      buttons.takeQuizzes,
      `https://t.me/${INMANKIST_BOT_USERNAME}?start=archetype`
    );
}

// Persistent reply keyboard menu with main commands
export function createMainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text(mainMenuButtons.find)
    .text(mainMenuButtons.liked)
    .row()
    .text(mainMenuButtons.profile)
    .resized()
    .persistent();
}

export function getMissingRequiredFields(
  profile: UserProfile | null
): RequiredField[] {
  if (!profile) return REQUIRED_FIELDS;

  const missing: RequiredField[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (field.key === FIELD_KEY.INTERESTS) {
      if (!profile.interests || profile.interests.length < MIN_INTERESTS) {
        missing.push(field);
      }
    } else if (!profile[field.key]) {
      missing.push(field);
    }
  }

  return missing;
}

// Helper function to prompt for next required field
export async function promptNextRequiredField(
  ctx: Context,
  bot: Bot,
  userId: number,
  missingFields: RequiredField[],
  fieldIndex: number
): Promise<void> {
  if (fieldIndex >= missingFields.length) {
    // All required fields completed
    const session = await getSession(userId);
    session.completingProfile = false;
    session.profileCompletionFieldIndex = undefined;

    await ctx.reply(profileCompletion.allRequiredComplete, {
      reply_markup: createMainActionsKeyboard(),
    });
    // Show persistent keyboard menu
    await ctx.reply(general.useButtonsBelow, {
      reply_markup: createMainMenuKeyboard(),
    });
    return;
  }

  const field = missingFields[fieldIndex];
  const session = await getSession(userId);
  session.completingProfile = true;
  session.profileCompletionFieldIndex = fieldIndex;
  // Use field key directly as editingField
  session.editingField = field.key as ProfileFieldKey;

  const remaining = missingFields.length - fieldIndex - 1;

  switch (field.type) {
    case FIELD_TYPE.USERNAME: {
      const currentUsername = ctx.from?.username;
      if (currentUsername) {
        // Auto-update username and continue
        await updateUserField(userId, FIELD_KEY.USERNAME, currentUsername);
        await ctx.reply(success.usernameUpdated(currentUsername));
        if (remaining > 0 && fieldIndex + 1 < missingFields.length) {
          await ctx.reply(
            profileCompletion.nextField(
              missingFields[fieldIndex + 1].name,
              remaining
            )
          );
        }
        await promptNextRequiredField(
          ctx,
          bot,
          userId,
          missingFields,
          fieldIndex + 1
        );
      } else {
        const keyboard = new InlineKeyboard().text(
          profileCompletion.usernameSetButton,
          callbackQueries.profileEditUsername
        );
        await ctx.reply(profileCompletion.fieldPrompt.username, {
          reply_markup: keyboard,
        });
      }
      break;
    }
    case FIELD_TYPE.TEXT: {
      if (fieldIndex > 0) {
        await ctx.reply(profileCompletion.nextField(field.name, remaining));
      }
      // Handle age field
      if (field.key === FIELD_KEY.AGE) {
        // Check if user already has age (e.g., from Google OAuth)
        const profile = await getUserProfile(userId);
        if (profile?.age) {
          // Age already exists, skip this field
          await ctx.reply(success.ageUpdated(profile.age));
          if (remaining > 0 && fieldIndex + 1 < missingFields.length) {
            await ctx.reply(
              profileCompletion.nextField(
                missingFields[fieldIndex + 1].name,
                remaining
              )
            );
          }
          await promptNextRequiredField(
            ctx,
            bot,
            userId,
            missingFields,
            fieldIndex + 1
          );
        } else {
          // Telegram doesn't provide age in user profile, so we need manual input
          // Note: If user linked Google account, age would have been imported via OAuth
          await ctx.reply(profileCompletion.fieldPrompt.age);
        }
      } else if (field.key === FIELD_KEY.DISPLAY_NAME) {
        await ctx.reply(profileCompletion.fieldPrompt.displayName);
      }
      break;
    }
    case FIELD_TYPE.SELECT: {
      if (fieldIndex > 0) {
        await ctx.reply(profileCompletion.nextField(field.name, remaining));
      }
      if (field.key === FIELD_KEY.GENDER) {
        const genderKeyboard = new InlineKeyboard()
          .text(profileValues.male, callbackQueries.profileSetGender("male"))
          .text(
            profileValues.female,
            callbackQueries.profileSetGender("female")
          );
        await ctx.reply(profileCompletion.fieldPrompt.gender, {
          reply_markup: genderKeyboard,
        });
      } else if (field.key === FIELD_KEY.LOOKING_FOR_GENDER) {
        const lookingForKeyboard = new InlineKeyboard()
          .text(
            profileValues.male,
            callbackQueries.profileSetLookingFor("male")
          )
          .text(
            profileValues.female,
            callbackQueries.profileSetLookingFor("female")
          )
          .row()
          .text(
            profileValues.both,
            callbackQueries.profileSetLookingFor("both")
          );
        await ctx.reply(profileCompletion.fieldPrompt.lookingFor, {
          reply_markup: lookingForKeyboard,
        });
      }
      break;
    }
    case FIELD_TYPE.INTERESTS: {
      if (fieldIndex > 0) {
        await ctx.reply(profileCompletion.nextField(field.name, remaining));
      }
      const profile = await getUserProfile(userId);
      const currentInterests = new Set(profile?.interests || []);
      session.interestsPage = 0;

      // Build interests keyboard inline
      const interestsKeyboard = new InlineKeyboard();
      const itemsPerPage = ITEMS_PER_PAGE;
      const totalPages = Math.ceil(INTERESTS.length / itemsPerPage);
      const startIndex = 0;
      const endIndex = Math.min(itemsPerPage, INTERESTS.length);
      const pageItems = INTERESTS.slice(startIndex, endIndex);

      const interestNamesMap = await getInterestNames(userId, BOT_NAME);
      let rowCount = 0;
      for (const interest of pageItems) {
        const isSelected = currentInterests.has(interest);
        const displayName = interestNamesMap[interest];
        const prefix = isSelected ? "✅ " : "";
        interestsKeyboard.text(
          `${prefix}${displayName}`,
          `profile:toggle:interest:${interest}`
        );
        rowCount++;
        if (rowCount % 2 === 0) {
          interestsKeyboard.row();
        }
      }

      if (totalPages > 1) {
        interestsKeyboard.row();
        interestsKeyboard.text(" ", callbackQueries.profileInterestsNoop);
        interestsKeyboard.text(
          `صفحه 1/${totalPages}`,
          callbackQueries.profileInterestsNoop
        );
        interestsKeyboard.text(
          buttons.next,
          callbackQueries.profileInterestsPage(1)
        );
      }

      const selectedCount = currentInterests.size;
      await ctx.reply(editPrompts.interests(selectedCount, 1, totalPages), {
        reply_markup: interestsKeyboard,
      });
      break;
    }
  }
}

// Helper function to continue profile completion flow
export async function continueProfileCompletion(
  ctx: Context,
  bot: Bot,
  userId: number
): Promise<void> {
  const session = await getSession(userId);
  if (!session.completingProfile) return;

  const profile = await getUserProfile(userId);
  if (!profile) return;

  const missingFields = getMissingRequiredFields(profile);

  if (missingFields.length === 0) {
    // All required fields completed
    session.completingProfile = false;
    session.profileCompletionFieldIndex = undefined;

    await ctx.reply(profileCompletion.allRequiredComplete, {
      reply_markup: createMainActionsKeyboard(),
    });
    // Show persistent keyboard menu
    await ctx.reply(general.useButtonsBelow, {
      reply_markup: createMainMenuKeyboard(),
    });
    return;
  }

  // Find the next missing field by checking REQUIRED_FIELDS in order
  // Start from the current position (or 0) and find the first missing field
  const currentFieldIndex = session.profileCompletionFieldIndex ?? -1;

  // Find the first missing field in REQUIRED_FIELDS order, starting after the current field
  for (let i = currentFieldIndex + 1; i < REQUIRED_FIELDS.length; i++) {
    const field = REQUIRED_FIELDS[i];
    const isMissing =
      field.key === FIELD_KEY.INTERESTS
        ? !profile.interests || profile.interests.length < MIN_INTERESTS
        : !profile[field.key];

    if (isMissing) {
      // Find this field in the missingFields array
      const missingIndex = missingFields.findIndex((f) => f.key === field.key);
      if (missingIndex >= 0) {
        session.profileCompletionFieldIndex = i;
        await promptNextRequiredField(
          ctx,
          bot,
          userId,
          missingFields,
          missingIndex
        );
        return;
      }
    }
  }

  // If we get here, all fields after current are complete, but there are still missing fields
  // This shouldn't happen, but if it does, just prompt for the first missing field
  if (missingFields.length > 0) {
    session.profileCompletionFieldIndex = REQUIRED_FIELDS.findIndex(
      (f) => f.key === missingFields[0].key
    );
    await promptNextRequiredField(ctx, bot, userId, missingFields, 0);
  }
}

// Export helper functions used by commands.ts
