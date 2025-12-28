import { Bot, Context, InlineKeyboard, InputFile } from "grammy";
import _ from "lodash";
import { getQuestionByQuestionIndex } from ".";
import { toPercentage } from "../../utils/string";
import { getStringsForUser } from "../i18n";
import { getUserLanguage } from "../../shared/i18n";
import { Language } from "../../shared/types";
import { QuizType } from "../../shared/types";
import { IUserData } from "../types";
import { addTextBoxToImage } from "./canvas";
import deities from "./deities";
import { Deity } from "./types";

export function setCustomCommands(bot: Bot) {
  // TODO anything
  return bot;
}

export async function replyAbout(ctx: Context) {
  const userId = ctx.from?.id;
  const language = await getUserLanguage(userId);
  const keyboard = new InlineKeyboard();
  Object.keys(deities).forEach((k, i) => {
    keyboard.text(
      deities[k].name[language],
      `detail:${QuizType.Archetype}:${k}`
    );
    if (i % 2) keyboard.row();
  });

  const aboutText = {
    [Language.Persian]:
      "آزمون کهن الگوها به شما نشان می دهد که به کدام یک از خدایان باستانی یونانی شباهت دارید.",
    [Language.English]:
      "The Archetype test shows you which of the ancient Greek deities you resemble.",
    [Language.Russian]:
      "Тест архетипов показывает, какому из древнегреческих божеств вы похожи.",
    [Language.Arabic]:
      "اختبار الأنماط الأصلية يوضح لك أي من الآلهة اليونانية القديمة تشبه.",
  };

  await ctx.reply(aboutText[language], { reply_markup: keyboard });
}

export function calculateResult(user: IUserData): Array<[Deity, number]> {
  const result = new Map<Deity, number>();
  Object.entries(user.answers).forEach((answer) => {
    const questionIndex = parseInt(answer[0]);
    const question = getQuestionByQuestionIndex(user, questionIndex);
    if (!question) throw "Something went wrong!"; // TODO error
    const value = answer[1];
    const previous = result.get(question.belong);
    result.set(question.belong, (previous ?? 0) + value);
  });
  const sortedResults = _.reverse(_.sortBy([...result], ([, value]) => value));
  return sortedResults;
}

export async function replyResult(ctx: Context, language: Language, sortedResults: Array<[Deity, number]>) {

  // Calculate total of all scores for weighted percentage
  const totalScores = sortedResults.reduce((sum, [, value]) => sum + value, 0);

  // process image
  const textRight = sortedResults
    .slice(0, 3)
    .map(([deity], i) => `${i + 1}. ${deities[deity].name[language]} \n`);
  const textLeft = sortedResults
    .slice(0, 3)
    .map(
      ([, value]) => `${toPercentage(value, totalScores)}% \n`
    );

  const mainDeity = sortedResults[0][0];
  const src = await addTextBoxToImage(
    deities[mainDeity].image as Buffer<ArrayBuffer>,
    textRight,
    textLeft
  );

  // add buttons
  const userId = ctx.from?.id;
  const strings = await getStringsForUser(userId);
  const keyboard = new InlineKeyboard();
  sortedResults.slice(0, 3).forEach((r) => {
    const text = `${strings.about} کهن الگو ${deities[r[0]].name[language]}`;
    const to = `detail:${QuizType.Archetype}:${r[0]}`;
    keyboard.text(text, to).row();
  });
  await ctx.replyWithPhoto(new InputFile(src, mainDeity + ".jpg"), {
    reply_markup: keyboard,
  });

  return sortedResults;
}

export async function replyDetail(ctx: Context, key: Deity) {
  const deity = deities[key];
  if (!deity) throw "Deity not found!";
  const message = `[\\.\\.\\.](${toIV(key)})`;
  ctx.reply(message, { parse_mode: "MarkdownV2" });
}

export function toIV(name: string) {
  const url = `https://khodshenas.me/archetypes/${name}`;
  const rhash = "52244b3ef86276";
  const ivLink = `https://t.me/iv?url=${encodeURIComponent(url)}&rhash=${rhash}`;
  return ivLink;
}
