import { Context, InlineKeyboard } from "grammy";
import { Language, QuizType } from "../shared/types";
import { getQuizTypeName, getQuizModeName, quizModes, quizTypes } from "./config";
import { getStrings } from "./i18n";
import { QuizMode } from "./types";

// Create language selection keyboard
export function createLanguageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🇮🇷 فارسی", `lang:${Language.Persian}`)
    .text("🇬🇧 English", `lang:${Language.English}`)
    .row()
    .text("🇷🇺 Русский", `lang:${Language.Russian}`)
    .text("🇸🇦 العربية", `lang:${Language.Arabic}`);
}

// Create quiz types selection keyboard
export function createQuizTypesKeyboard(language: Language): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  Object.keys(quizTypes).forEach((k) =>
    keyboard.text(getQuizTypeName(k as QuizType, language), `quiz:${k}`).row()
  );
  return keyboard;
}

// Show language selection message with keyboard
export async function showLanguageSelection(ctx: Context): Promise<void> {
  await ctx.reply(
    "🌐 Please select your language / Пожалуйста, выберите язык / لطفا زبان خود را انتخاب کنید / الرجاء اختيار لغتك:",
    { reply_markup: createLanguageKeyboard() }
  );
}

// Show quiz type selection message with keyboard
export async function showQuizTypeSelection(ctx: Context, language: Language): Promise<void> {
  const strings = getStrings(language);
  await ctx.reply(strings.welcome, {
    reply_markup: createQuizTypesKeyboard(language),
  });
}

// Show quiz mode selection message with keyboard
export async function showQuizModeSelection(ctx: Context, language: Language) {
  const strings = getStrings(language);
  const keyboard = new InlineKeyboard();
  Object.keys(quizModes).forEach((k) =>
    keyboard.text(
      getQuizModeName(parseInt(k) as QuizMode, language),
      `mode:${k}`
    )
  );
  return ctx.reply(strings.mode, { reply_markup: keyboard });
}

