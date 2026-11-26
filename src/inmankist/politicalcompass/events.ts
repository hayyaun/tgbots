import { Bot, Context, InlineKeyboard, InputFile } from "grammy";
import { getQuestionByQuestionIndex } from ".";
import { getStrings } from "../i18n";
import { getUserLanguage } from "../../shared/i18n";
import { Language } from "../../shared/types";
import { QuizType } from "../../shared/types";
import { IUserData } from "../types";
import { generateCompassChart } from "./canvas";
import { getQuadrant, labels } from "./localization";
import { PoliticalAxis, Quadrant, PoliticalCompassResult } from "./types";

export function setCustomCommands(bot: Bot) {
  // No custom commands needed for political compass
  return bot;
}

export async function replyAbout(ctx: Context) {
  const language = await getUserLanguage(ctx.from?.id);
  const keyboard = new InlineKeyboard();

  Object.values(Quadrant).forEach((quad) => {
    keyboard.text(
      getQuadrant(quad, language).emoji + " " + getQuadrant(quad, language).name,
      `detail:${QuizType.PoliticalCompass}:${quad}`
    );
    keyboard.row();
  });

  await ctx.reply(labels[language].about, { reply_markup: keyboard });
}

function determineQuadrant(
  economicScore: number,
  socialScore: number
): Quadrant {
  // Economic: negative = left, positive = right
  // Social: negative = authoritarian, positive = libertarian

  // Center threshold (within 20% of center)
  if (Math.abs(economicScore) < 20 && Math.abs(socialScore) < 20) {
    return Quadrant.Center;
  }

  if (economicScore < 0) {
    // Left
    if (socialScore < 0) {
      return Quadrant.AuthLeft; // Authoritarian Left
    } else {
      return Quadrant.LibLeft; // Libertarian Left
    }
  } else {
    // Right
    if (socialScore < 0) {
      return Quadrant.AuthRight; // Authoritarian Right
    } else {
      return Quadrant.LibRight; // Libertarian Right
    }
  }
}

export function calculateResult(user: IUserData): PoliticalCompassResult {
  // Calculate scores for each axis
  let economicLeftScore = 0;
  let economicRightScore = 0;
  let authoritarianScore = 0;
  let libertarianScore = 0;

  Object.entries(user.answers).forEach((answer) => {
    const questionIndex = parseInt(answer[0]);
    const question = getQuestionByQuestionIndex(user, questionIndex);
    if (!question) throw "Something went wrong!";
    const value = answer[1]; // 0-3 scale

    switch (question.belong) {
      case PoliticalAxis.EconomicLeft:
        economicLeftScore += value;
        break;
      case PoliticalAxis.EconomicRight:
        economicRightScore += value;
        break;
      case PoliticalAxis.Authoritarian:
        authoritarianScore += value;
        break;
      case PoliticalAxis.Libertarian:
        libertarianScore += value;
        break;
    }
  });

  // Calculate net scores (-100 to +100 scale)
  const economicTotal = economicLeftScore + economicRightScore || 1;
  const socialTotal = authoritarianScore + libertarianScore || 1;

  // Economic: negative = left, positive = right
  const economicScore =
    ((economicRightScore - economicLeftScore) / economicTotal) * 100;

  // Social: negative = authoritarian, positive = libertarian
  const socialScore =
    ((libertarianScore - authoritarianScore) / socialTotal) * 100;

  // Determine quadrant
  const quadrant = determineQuadrant(economicScore, socialScore);
  return { quadrant, economicScore, socialScore };
}

export async function replyResult(ctx: Context, language: Language, result: PoliticalCompassResult) {
  const { quadrant, economicScore, socialScore } = result;
  const quadrantInfo = getQuadrant(quadrant, language);
  const text = labels[language];

  // Create descriptive position
  const economicPosition =
    Math.abs(economicScore) < 10
      ? text.center
      : economicScore < -30
        ? text.strongLeft
        : economicScore < 0
          ? text.left
          : economicScore > 30
            ? text.strongRight
            : text.right;

  const socialPosition =
    Math.abs(socialScore) < 10
      ? text.center
      : socialScore < -30
        ? text.strongAuth
        : socialScore < 0
          ? text.auth
          : socialScore > 30
            ? text.strongLib
            : text.lib;

  // Create message
  const resultText = [
    `${quadrantInfo.emoji} *${quadrantInfo.name}*`,
    "",
    quadrantInfo.description,
    "",
    `🎯 *${text.traits}:*`,
    ...quadrantInfo.traits.map((trait) => `  ${trait}`),
    "",
    `💡 ${quadrantInfo.examples}`,
    "",
    `📊 *${text.position}:*`,
    `  📈 ${text.economic}: ${economicPosition} (${economicScore > 0 ? "+" : ""}${Math.round(economicScore)})`,
    `  🏛️ ${text.social}: ${socialPosition} (${socialScore > 0 ? "+" : ""}${Math.round(socialScore)})`,
  ].join("\n");

  // Generate chart
  const chartBuffer = generateCompassChart(economicScore, socialScore, language);

  // Add button for detailed view
  const strings = getStrings(language);
  const keyboard = new InlineKeyboard().text(
    `${strings.about} ${quadrantInfo.name}`,
    `detail:${QuizType.PoliticalCompass}:${quadrant}`
  );

  // Send chart with caption
  await ctx.replyWithPhoto(new InputFile(chartBuffer, "compass.png"), {
    caption: resultText,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

export async function replyDetail(ctx: Context, key: Quadrant) {
  const language = await getUserLanguage(ctx.from?.id);
  const text = labels[language];
  const quadrantInfo = getQuadrant(key, language);
  if (!quadrantInfo) throw "Quadrant not found!";

  const message = [
    `${quadrantInfo.emoji} *${quadrantInfo.name}*`,
    "",
    quadrantInfo.description,
    "",
    `*${text.traits}:*`,
    ...quadrantInfo.traits.map((trait) => `  ${trait}`),
    "",
    `💡 ${quadrantInfo.examples}`,
  ].join("\n");

  await ctx.reply(message, { parse_mode: "Markdown" });
}

