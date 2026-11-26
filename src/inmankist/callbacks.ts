import { Bot, Context, InlineKeyboard } from "grammy";
import { prisma } from "../db";
import log from "../log";
import { DEFAULT_LANGUAGE, getUserLanguage, hasUserLanguage, setUserLanguage } from "../shared/i18n";
import { setupProfileCallbacks } from "../shared/profileCallbacks";
import { Language, QuizType } from "../shared/types";
import { getDisplayNameFromUser } from "../utils/string";
import { getQuizModeName, getQuizTypeName, MATCHFOUND_BOT_USERNAME, quizNeedsGender } from "./config";
import { ANSWER_VALUES, getStrings, getStringsForUser } from "./i18n";
import { displaySavedResult, replyDetial, replyResult, selectOrder, selectQuizQuestion } from "./reducer";
import { showLanguageSelection, showQuizModeSelection, showQuizTypeSelection } from "./selectionHelpers";
import { getSession } from "./session";
import { Gender } from "../shared/types";
import { IUserData, QuizMode, Value } from "./types";
import { deleteUserData, getUserData, setUserData, updateUserData } from "./userData";

const BOT_NAME = "Inmankist";

// Helper function to handle expired/missing user data
async function handleExpiredSession(ctx: Context): Promise<void> {
  const strings = await getStringsForUser(ctx.from?.id);
  await ctx.reply(strings.sessionExpired).catch(() => {});
}

// Extract and process quiz result based on type
type QuizResultValue = string | null;

function extractQuizResult(quizType: QuizType, result: unknown): QuizResultValue {
  switch (quizType) {
    case QuizType.Archetype:
      if (Array.isArray(result) && result.length > 0) {
        // result is array of [Deity, number] tuples, get primary archetype
        return result[0][0] as string;
      }
      return null;

    case QuizType.MBTI:
      if (typeof result === "object" && result !== null && "type" in result) {
        // result is object with type and distribution - store just type
        return (result as { type: string }).type.toUpperCase();
      }
      // Fallback for old format (string)
      if (typeof result === "string") {
        return result.toUpperCase();
      }
      return null;

    case QuizType.LeftRight:
      if (typeof result === "object" && result !== null && "resultType" in result) {
        // result is object with resultType, leftPercentage, rightPercentage - store just resultType
        return (result as { resultType: string }).resultType;
      }
      return null;

    case QuizType.PoliticalCompass:
      if (typeof result === "object" && result !== null && "quadrant" in result) {
        // result is object with quadrant, economicScore, socialScore - store just quadrant
        return (result as { quadrant: string }).quadrant;
      }
      return null;

    case QuizType.Enneagram:
      if (Array.isArray(result) && result.length > 0) {
        // result is array of [EnneagramType, number] tuples, get primary type
        return result[0][0] as string;
      }
      return null;

    case QuizType.BigFive:
      if (typeof result === "object" && result !== null) {
        // result is object with traits and aspects - store as JSON string
        return JSON.stringify(result);
      }
      return null;

    case QuizType.MentalAge:
      if (typeof result === "object" && result !== null && "age" in result) {
        // result is object with age number - store as string
        return String((result as { age: number }).age);
      }
      return null;

    default:
      return null;
  }
}

// Map quiz types to database field names
const QUIZ_FIELD_MAP: Record<QuizType, string> = {
  [QuizType.Archetype]: "archetype_result",
  [QuizType.MBTI]: "mbti_result",
  [QuizType.LeftRight]: "leftright_result",
  [QuizType.PoliticalCompass]: "politicalcompass_result",
  [QuizType.Enneagram]: "enneagram_result",
  [QuizType.BigFive]: "bigfive_result",
  [QuizType.MentalAge]: "mentalage_result",
} as const;

// Save quiz result to PostgreSQL
async function saveQuizResultToDB(
  userId: number,
  quizType: QuizType,
  result: unknown,
  from?: { first_name?: string; last_name?: string; username?: string },
): Promise<void> {
  try {
    const resultValue = extractQuizResult(quizType, result);
    if (resultValue === null) {
      log.warn(BOT_NAME + " > Invalid quiz result format", {
        userId,
        quizType,
        result,
      });
      return;
    }

    const displayName = getDisplayNameFromUser(from);
    const username = from?.username || null;

    // Get existing user to check what fields already exist
    const existing = await prisma.user.findUnique({
      where: { telegram_id: BigInt(userId) },
      select: { display_name: true, username: true },
    });

    // Only update display_name if user doesn't already have one (don't overwrite manual changes)
    const shouldSetDisplayName = !existing || !existing.display_name;
    const finalDisplayName = shouldSetDisplayName ? displayName : undefined;

    // Update username if provided and different (similar to matchfound bot behavior)
    const shouldUpdateUsername = username && existing?.username !== username;

    const fieldName = QUIZ_FIELD_MAP[quizType];
    if (!fieldName) {
      log.error(BOT_NAME + " > Unknown quiz type", { userId, quizType });
      return;
    }

    // Build update data object
    const updateData: Record<string, unknown> = {
      [fieldName]: resultValue,
    };

    if (finalDisplayName != null) {
      updateData.display_name = finalDisplayName;
    }

    if (shouldUpdateUsername) {
      updateData.username = username;
    }

    await prisma.user.upsert({
      where: { telegram_id: BigInt(userId) },
      create: {
        telegram_id: BigInt(userId),
        display_name: displayName,
        username: username,
        [fieldName]: resultValue,
      },
      update: updateData,
    });

    log.info(BOT_NAME + " > Saved quiz result", {
      userId,
      quizType,
      result: resultValue,
      usernameUpdated: shouldUpdateUsername,
    });
  } catch (err) {
    log.error(BOT_NAME + " > Failed to save quiz result to PostgreSQL", err);
    // Don't fail the quiz completion if DB save fails
  }
}

function getLanguageName(language: Language): string {
  const names: { [key in Language]: string } = {
    [Language.Persian]: "فارسی",
    [Language.English]: "English",
    [Language.Russian]: "Русский",
    [Language.Arabic]: "العربية",
  };
  return names[language];
}

async function updateWelcomeMessage(
  ctx: Context,
  welcomeId: number,
  quiz: QuizType,
  language: Language,
  mode?: QuizMode,
  gender?: Gender,
): Promise<void> {
  const strings = getStrings(language);
  const parts: string[] = [getQuizTypeName(quiz, language)];

  if (mode !== undefined) {
    parts.push(getQuizModeName(mode, language));
  }

  if (gender !== undefined) {
    parts.push(gender === Gender.male ? strings.male : strings.female);
  }

  await ctx.api
    .editMessageText(ctx.chat!.id!, welcomeId, `${strings.welcome} \n\n✅  ${parts.join(" - ")}`, {
      reply_markup: undefined,
    })
    .catch(() => {});
}

async function setUser(ctx: Context, type: QuizType, notifyAdmin: (message: string) => Promise<void>) {
  const userId = ctx.from?.id;
  if (!userId) throw new Error("UserId Invalid!");
  const language = await getUserLanguage(userId);
  log.info(BOT_NAME + " > Begin", { type, user: ctx.from, language });

  // Notify admin about quiz start
  notifyAdmin(`🎯 <b>Quiz Started</b>\nUser ID: <code>${userId}</code>\nType: ${type}\nLanguage: ${language}`).catch(
    () => {},
  );

  await setUserData(userId, {
    welcomeId: ctx.callbackQuery?.message?.message_id,
    chatId: ctx.chat?.id,
    stage: "mode",
    questionMessageIds: {},
    date: Date.now(),
    answers: {},
    // zero values - defaults
    quiz: type,
    mode: QuizMode.MD,
    order: [],
    language,
  });
}

// Find the next unanswered question position in order array
function findNextUnansweredQuestionPosition(user: IUserData): number | null {
  // Check if all questions are answered
  const allAnswered = user.order.every((questionIndex) => typeof user.answers[questionIndex] === "number");

  if (allAnswered) return null; // All questions answered

  // Find first unanswered question (return position in order array, not question index)
  for (let position = 0; position < user.order.length; position++) {
    const questionIndex = user.order[position];
    if (typeof user.answers[questionIndex] !== "number") {
      return position; // Return position in order array, not question index
    }
  }

  return null;
}

// Quiz
async function sendQuestionOrResult(ctx: Context, user: IUserData, notifyAdmin?: (message: string) => Promise<void>) {
  const userId = ctx.from?.id;
  if (!userId) throw new Error("UserId Invalid!");
  if (!user || !user.order.length) {
    // User data expired or not found - show helpful message
    await handleExpiredSession(ctx);
    return;
  }

  // Find next unanswered question (returns position in order array)
  const nextPosition = findNextUnansweredQuestionPosition(user);

  if (nextPosition === null) {
    if (!user.completion) {
      const result = await replyResult(ctx, user);
      user = await updateUserData(userId, { completion: { result } }, user);
      log.info(BOT_NAME + " > Complete", { userId, type: user.quiz, result });
    }
    const completion = user.completion!;
    if (!completion.profileSaved) {
      await saveQuizResultToDB(userId, user.quiz, completion.result, ctx.from);
      completion.profileSaved = true;
      await setUserData(userId, user);
      if (notifyAdmin) {
        void notifyAdmin(`Quiz Completed; user ${userId}; type ${user.quiz}`).catch(() => {});
      }
    }
    if (!completion.followupDelivered) {
      const strings = getStrings(user.language || DEFAULT_LANGUAGE);
      await ctx.reply(strings.matchfound_message, {
        reply_markup: new InlineKeyboard().url(
          strings.matchfound_button,
          `https://t.me/${MATCHFOUND_BOT_USERNAME}?start=quiz_complete`,
        ),
      });
      completion.followupDelivered = true;
      await setUserData(userId, user);
    }
    await deleteUserData(userId);
    return true;
  }

  // nextPosition is the position in order array (0-indexed)
  const positionInOrder = nextPosition + 1; // 1-indexed for display
  const questionIndex = user.order[nextPosition]; // Actual question index from order array

  const keyboard = new InlineKeyboard();
  // Pre-select current answer if exists (for revisions)
  const currentAnswer = user.answers[questionIndex];
  ANSWER_VALUES.forEach((v, i: Value) =>
    keyboard.text(typeof currentAnswer === "number" && i === currentAnswer ? "✅" : v, `answer:${questionIndex}-${i}`),
  );

  const question = selectQuizQuestion(user, questionIndex);
  if (!question) throw new Error("Cannot find next question");
  const message = `${positionInOrder}/${user.order.length} \n\n${question.text}`;
  const sent = await ctx.reply(message, { reply_markup: keyboard });
  await updateUserData(
    userId,
    {
      questionMessageIds: { ...user.questionMessageIds, [questionIndex]: sent.message_id },
    },
    user,
  );
  return false;
}

// Each user's callback mutations run in arrival order. Acknowledge before waiting
// so a slow chart or Telegram request does not leave subsequent taps spinning.
export function setupCallbacks(bot: Bot, notifyAdmin: (message: string) => Promise<void>) {
  const updates = new Map<number, Promise<void>>();
  const completedMessages = new Map<string, number>();
  const messageKey = (ctx: Context) => `${ctx.from?.id}:${ctx.chat?.id}:${ctx.callbackQuery?.message?.message_id}`;

  bot.use(async (ctx, next) => {
    const data = ctx.callbackQuery?.data;
    const userId = ctx.from?.id;
    if (!userId || !data || !/^(lang|quiz|mode|gender|answer):/.test(data)) {
      return next();
    }
    void ctx.answerCallbackQuery().catch(() => {});
    const previous = updates.get(userId);
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    updates.set(userId, current);
    await previous;
    try {
      await next();
    } finally {
      release();
      if (updates.get(userId) === current) updates.delete(userId);
    }
  });

  const reportError = async (ctx: Context, action: string, error: unknown) => {
    log.error(BOT_NAME + " > " + action, { userId: ctx.from?.id, error });
    void notifyAdmin(`Error in ${action}; user ${ctx.from?.id}: ${error}`).catch(() => {});
    const strings = await getStringsForUser(ctx.from?.id);
    await ctx.reply(strings.retry).catch(() => {});
  };

  bot.callbackQuery(/^lang:(.+)$/, async (ctx) => {
    const language = ctx.match[1] as Language;
    if (!Object.values(Language).includes(language)) return;
    try {
      await setUserLanguage(ctx.from.id, language);
      const strings = getStrings(language);
      await ctx
        .editMessageText(`✅ ${strings.language}: ${getLanguageName(language)}\n\n${strings.welcome}`, {
          reply_markup: undefined,
        })
        .catch(() => {});
      await showQuizTypeSelection(ctx, language);
    } catch (error) {
      await reportError(ctx, "Language", error);
    }
  });

  bot.callbackQuery(/^quiz:(.+)$/, async (ctx) => {
    const type = ctx.match[1] as QuizType;
    if (!Object.values(QuizType).includes(type)) return;
    try {
      const userId = ctx.from.id;
      if (!(await hasUserLanguage(userId))) {
        await showLanguageSelection(ctx);
        return;
      }
      const language = await getUserLanguage(userId);
      const welcomeId = ctx.callbackQuery.message?.message_id;
      if (welcomeId) await updateWelcomeMessage(ctx, welcomeId, type, language);
      await displaySavedResult(ctx, userId, type, language);
      await setUser(ctx, type, notifyAdmin);
      const prompt = await showQuizModeSelection(ctx, language);
      await updateUserData(userId, { selectionMessageId: prompt.message_id });
    } catch (error) {
      await reportError(ctx, "Quiz Type", error);
    }
  });

  const matchesSelection = (ctx: Context, user: IUserData) =>
    user.chatId === ctx.chat?.id && user.selectionMessageId === ctx.callbackQuery?.message?.message_id;

  bot.callbackQuery(/^mode:([0-2])$/, async (ctx) => {
    try {
      const userId = ctx.from.id;
      const user = await getUserData(userId);
      if (!user) return handleExpiredSession(ctx);
      if (!user.stage || !user.selectionMessageId) return handleExpiredSession(ctx);
      if (!matchesSelection(ctx, user)) return;
      // A failed first question can be retried from the same selection prompt.
      const retrying =
        user.stage === "questions" &&
        !Object.keys(user.questionMessageIds || {}).length &&
        !Object.keys(user.answers).length;
      if (user.stage !== "mode" && !retrying) return;
      const mode = Number(ctx.match[1]) as QuizMode;
      if (retrying && mode !== user.mode) return;
      const language = user.language || DEFAULT_LANGUAGE;
      const updatedUser = await updateUserData(
        userId,
        {
          mode,
          answers: {},
          questionMessageIds: {},
          completion: undefined,
        },
        user,
      );
      await updateWelcomeMessage(ctx, user.welcomeId!, user.quiz, language, mode);
      if (quizNeedsGender(user.quiz)) {
        const dbUser = await prisma.user
          .findUnique({
            where: { telegram_id: BigInt(userId) },
            select: { gender: true },
          })
          .catch((error: unknown) => {
            log.error("Failed to load quiz gender", { userId, error });
            return null;
          });
        const gender = dbUser?.gender as Gender | undefined;
        if (gender && Object.values(Gender).includes(gender)) {
          updatedUser.gender = gender;
          updatedUser.order = selectOrder(updatedUser);
          updatedUser.stage = "questions";
          await setUserData(userId, updatedUser);
          await updateWelcomeMessage(ctx, user.welcomeId!, user.quiz, language, mode, gender);
          await sendQuestionOrResult(ctx, updatedUser, notifyAdmin);
        } else {
          const strings = getStrings(language);
          const prompt = await ctx.reply(strings.gender, {
            reply_markup: new InlineKeyboard()
              .text(strings.male, `gender:${Gender.male}`)
              .text(strings.female, `gender:${Gender.female}`),
          });
          await updateUserData(
            userId,
            {
              stage: "gender",
              selectionMessageId: prompt.message_id,
            },
            updatedUser,
          );
        }
      } else {
        updatedUser.order = selectOrder(updatedUser);
        updatedUser.stage = "questions";
        await setUserData(userId, updatedUser);
        await sendQuestionOrResult(ctx, updatedUser, notifyAdmin);
      }
    } catch (error) {
      await reportError(ctx, "Quiz Mode", error);
    }
  });

  bot.callbackQuery(/^gender:(male|female)$/, async (ctx) => {
    try {
      const userId = ctx.from.id;
      const user = await getUserData(userId);
      if (!user) return handleExpiredSession(ctx);
      if (!user.stage || !user.selectionMessageId) return handleExpiredSession(ctx);
      const retrying =
        user.stage === "questions" &&
        !Object.keys(user.questionMessageIds || {}).length &&
        !Object.keys(user.answers).length;
      if (!matchesSelection(ctx, user) || !quizNeedsGender(user.quiz) || (user.stage !== "gender" && !retrying)) return;
      const gender = ctx.match[1] as Gender;
      if (retrying && gender !== user.gender) return;
      const language = user.language || DEFAULT_LANGUAGE;
      user.gender = gender;
      user.order = selectOrder(user);
      const updatedUser = await updateUserData(
        userId,
        {
          gender,
          order: user.order,
          stage: "questions",
          answers: {},
          questionMessageIds: {},
          completion: undefined,
        },
        user,
      );
      await updateWelcomeMessage(ctx, user.welcomeId!, user.quiz, language, user.mode, gender);
      // Profile persistence is best effort, as it is for completed results.
      await prisma.user
        .upsert({
          where: { telegram_id: BigInt(userId) },
          create: { telegram_id: BigInt(userId), gender },
          update: { gender },
        })
        .catch((error: unknown) => log.error("Failed to save quiz gender", { userId, error }));
      await sendQuestionOrResult(ctx, updatedUser, notifyAdmin);
    } catch (error) {
      await reportError(ctx, "Gender", error);
    }
  });

  bot.callbackQuery(/^answer:(\d+)-(\d+)$/, async (ctx) => {
    try {
      const userId = ctx.from.id;
      const key = messageKey(ctx);
      const completedAt = completedMessages.get(key);
      if (completedAt !== undefined && Date.now() - completedAt < 30 * 60 * 1000) return;
      let user = await getUserData(userId);
      if (!user) return handleExpiredSession(ctx);
      if (!user.stage || !user.questionMessageIds) return handleExpiredSession(ctx);
      const questionIndex = Number(ctx.match[1]);
      const selectedAnswer = Number(ctx.match[2]);
      if (
        user.stage !== "questions" ||
        !user.order.length ||
        !Number.isSafeInteger(questionIndex) ||
        !Number.isInteger(selectedAnswer) ||
        selectedAnswer < 0 ||
        selectedAnswer >= ANSWER_VALUES.length ||
        !user.order.includes(questionIndex) ||
        user.chatId !== ctx.chat?.id ||
        user.questionMessageIds[questionIndex] !== ctx.callbackQuery.message?.message_id
      )
        return;

      // Once published, keep the result immutable while follow-up/cleanup retries.
      if (!user.completion) {
        user = await updateUserData(
          userId,
          {
            answers: { ...user.answers, [questionIndex]: selectedAnswer },
          },
          user,
        );
        const keyboard = new InlineKeyboard();
        ANSWER_VALUES.forEach((value, index) =>
          keyboard.text(index === selectedAnswer ? "✅" : value, `answer:${questionIndex}-${index}`),
        );
        await ctx.editMessageReplyMarkup({ reply_markup: keyboard }).catch(() => {});
      }
      const next = findNextUnansweredQuestionPosition(user);
      // Revisions never duplicate an already displayed next question; failed sends
      // and incomplete completion steps remain retryable using the same button.
      if (next === null || !user.questionMessageIds?.[user.order[next]]) {
        if (await sendQuestionOrResult(ctx, user, notifyAdmin)) {
          const now = Date.now();
          for (const [message, timestamp] of completedMessages) {
            if (now - timestamp >= 30 * 60 * 1000) completedMessages.delete(message);
          }
          if (completedMessages.size >= 10000) {
            completedMessages.delete(completedMessages.keys().next().value!);
          }
          completedMessages.set(key, now);
        }
      }
    } catch (error) {
      await reportError(ctx, "Answer", error);
    }
  });

  bot.callbackQuery(/^detail:(.+):(.+)$/, async (ctx) => {
    void ctx.answerCallbackQuery().catch(() => {});
    try {
      const type = ctx.match[1] as QuizType;
      if (!Object.values(QuizType).includes(type)) return;
      await replyDetial(ctx, type, ctx.match[2]);
    } catch (error) {
      await reportError(ctx, "Detail", error);
    }
  });

  setupProfileCallbacks(bot, { botName: BOT_NAME, getSession, notifyAdmin });
}
