import { BOT_NAME as MATCHFOUND_BOT_NAME } from "../../matchfound/constants";
import { getWithPrefix, setWithPrefix } from "../../redis";
import { prisma } from "../../db";
import { Language } from "../types";

// Default language
export const DEFAULT_LANGUAGE = Language.Persian;

// Shared Redis prefix for user language (shared across all bots)
const SHARED_PREFIX = "shared";
const USER_LANG_TTL = 14 * 24 * 60 * 60; // 2 weeks in seconds

/**
 * Get user language (shared across all bots)
 * Checks Redis first, falls back to database if Redis is unavailable
 */
export async function getUserLanguage(userId?: number): Promise<Language> {
  if (!userId) return DEFAULT_LANGUAGE;
  
  // Try Redis first
  try {
    const lang = await getWithPrefix(SHARED_PREFIX, `user:${userId}:lang`);
    if (lang && Object.values(Language).includes(lang as Language)) {
      return lang as Language;
    }
  } catch {
    // Redis unavailable, fall back to database
  }
  
  // Fallback to database if Redis not available or no value found
  try {
    const user = await prisma.user.findUnique({
      where: { telegram_id: BigInt(userId) },
      select: { language: true },
    });
    if (user?.language && Object.values(Language).includes(user.language as Language)) {
      return user.language as Language;
    }
  } catch {
    // Database error, return default
  }
  
  return DEFAULT_LANGUAGE;
}

/**
 * Set user language (shared across all bots)
 * Saves to Redis and database (database save is fire-and-forget)
 */
export async function setUserLanguage(userId: number, language: Language): Promise<void> {
  if (!Object.values(Language).includes(language)) return;
  // Save to Redis (await for immediate availability)
  try {
    await setWithPrefix(SHARED_PREFIX, `user:${userId}:lang`, language, USER_LANG_TTL);
  } catch {
    // Redis unavailable, continue to save in database
  }
  
  // Save to database (fire-and-forget, don't await)
  prisma.user
    .updateMany({
      where: { telegram_id: BigInt(userId) },
      data: { language },
    })
    .catch(() => {
      // Silently fail - don't block if database update fails
    });
}

/**
 * Check if user has set a language (vs using default)
 */
export async function hasUserLanguage(userId: number): Promise<boolean> {
  // Try Redis first
  try {
    const lang = await getWithPrefix(SHARED_PREFIX, `user:${userId}:lang`);
    if (lang && Object.values(Language).includes(lang as Language)) return true;
  } catch {
    // Redis unavailable, fall back to database
  }
  
  // Fallback to database
  try {
    const user = await prisma.user.findUnique({
      where: { telegram_id: BigInt(userId) },
      select: { language: true },
    });
    return !!user?.language && Object.values(Language).includes(user.language as Language);
  } catch {
    return false;
  }
}

/**
 * Refresh language TTL (call when user interacts with bot)
 */
export async function refreshUserLanguageTTL(userId: number): Promise<void> {
  const lang = await getUserLanguage(userId);
  if (await hasUserLanguage(userId)) {
    try {
      await setWithPrefix(SHARED_PREFIX, `user:${userId}:lang`, lang, USER_LANG_TTL);
    } catch {
      // Redis unavailable, continue silently
    }
  }
}

/**
 * Get language for a user based on bot name
 * - MatchFound: Always returns Persian
 * - Inmankist: Gets language from shared user language
 */
export async function getLanguageForUser(userId: number | undefined, botName: string): Promise<Language> {
  // MatchFound is Persian only
  if (botName === MATCHFOUND_BOT_NAME) {
    return Language.Persian;
  }

  // For Inmankist and other bots, get language from shared user language
  return await getUserLanguage(userId);
}
