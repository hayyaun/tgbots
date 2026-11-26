import {
  DEFAULT_LANGUAGE,
  getUserLanguage,
} from "../shared/i18n";
import { Language } from "../shared/types";

// Answer values (language-independent emojis)
export const ANSWER_VALUES = ["👎👎", "👎", "👍", "👍👍"] as const;

// Translation strings
export interface IStrings {
  sessionExpired: string;
  retry: string;
  welcome: string;
  mode: string;
  gender: string;
  start_btn: string;
  help_btn: string;
  language_btn: string;
  help: string;
  male: string;
  female: string;
  about: string;
  language: string;
  select_language: string;
  matchfound_message: string;
  matchfound_button: string;
  compass_left: string;
  compass_right: string;
  compass_authoritarian: string;
  compass_libertarian: string;
  compass_libLeft: string;
  compass_libRight: string;
  compass_authLeft: string;
  compass_authRight: string;
}

const translations: { [key in Language]: IStrings } = {
  [Language.Persian]: {
    sessionExpired: "جلسه شما منقضی شده یا مربوط به نسخه قبلی است. لطفا با /start یک آزمون جدید شروع کنید.",
    retry: "انجام این مرحله ناموفق بود. دوباره همان دکمه را بزنید. اگر ادامه پیدا نکرد با /start شروع کنید.",
    welcome: [
      "👋 به ربات تلگرام «این من کیست؟» خوش آمدید! 🎭",
      "",
      "🔮 آماده‌اید که رازهای شخصیت خود را کشف کنید؟",
      "👇 برای شروع یکی از گزینه‌های زیر را انتخاب کنید!",
    ].join("\n"),
    mode: "نحوه پرسش سوالات چگونه باشد؟ \n👇",
    gender: "لطفا جنسیت خود را مشخص کنید \n👇",
    start_btn: "🚀 شروع آزمون",
    help_btn: "❓ راهنما",
    language_btn: "🌐 زبان",
    help: ["📌 لطفا برای شروع روی دکمه «شروع آزمون» بزنید!"].join("\n"),
    male: "مرد",
    female: "زن",
    about: "درباره",
    language: "زبان",
    select_language: "لطفا زبان خود را انتخاب کنید:",
    matchfound_message: "🎯 آیا مایلید با افرادی هم تایپ خودتون آشنا بشید؟",
    matchfound_button: "✅ بله",
    compass_left: "چپ",
    compass_right: "راست",
    compass_authoritarian: "اقتدارگرا",
    compass_libertarian: "آزادی‌خواه",
    compass_libLeft: "چپ آزادی‌خواه",
    compass_libRight: "راست آزادی‌خواه",
    compass_authLeft: "چپ اقتدارگرا",
    compass_authRight: "راست اقتدارگرا",
  },
  [Language.English]: {
    sessionExpired: "Your quiz session has expired or belongs to an older version. Use /start to begin a new quiz.",
    retry: "This step could not be completed. Tap the same button to retry. If it still fails, use /start.",
    welcome: [
      "👋 Welcome to the «Who Am I?» Telegram bot! 🎭",
      "",
      "🔮 Ready to discover the secrets of your personality?",
      "👇 Choose one of the options below to get started!",
    ].join("\n"),
    mode: "How should questions be asked? \n👇",
    gender: "Please specify your gender \n👇",
    start_btn: "🚀 Start Quiz",
    help_btn: "❓ Help",
    language_btn: "🌐 Language",
    help: ["📌 Please click the «Start Quiz» button to begin!"].join("\n"),
    male: "Male",
    female: "Female",
    about: "About",
    language: "Language",
    select_language: "Please select your language:",
    matchfound_message: "🎯 Would you like to meet people of your type?",
    matchfound_button: "✅ Yes",
    compass_left: "Left",
    compass_right: "Right",
    compass_authoritarian: "Authoritarian",
    compass_libertarian: "Libertarian",
    compass_libLeft: "Lib Left",
    compass_libRight: "Lib Right",
    compass_authLeft: "Auth Left",
    compass_authRight: "Auth Right",
  },
  [Language.Russian]: {
    sessionExpired: "Сессия теста истекла или относится к старой версии. Начните новый тест с помощью /start.",
    retry: "Не удалось завершить этот шаг. Нажмите ту же кнопку для повтора. Если ошибка повторяется, используйте /start.",
    welcome: [
      "👋 Добро пожаловать в телеграм-бота «Кто я?»! 🎭",
      "",
      "🔮 Готовы раскрыть секреты своей личности?",
      "👇 Выберите один из вариантов ниже, чтобы начать!",
    ].join("\n"),
    mode: "Как должны задаваться вопросы? \n👇",
    gender: "Пожалуйста, укажите ваш пол \n👇",
    start_btn: "🚀 Начать тест",
    help_btn: "❓ Помощь",
    language_btn: "🌐 Язык",
    help: ["📌 Пожалуйста, нажмите кнопку «Начать тест», чтобы начать!"].join(
      "\n"
    ),
    male: "Мужской",
    female: "Женский",
    about: "О",
    language: "Язык",
    select_language: "Пожалуйста, выберите ваш язык:",
    matchfound_message: "🎯 Хотите ли вы познакомиться с людьми вашего типа?",
    matchfound_button: "✅ Да",
    compass_left: "Левые",
    compass_right: "Правые",
    compass_authoritarian: "Авторитарный",
    compass_libertarian: "Либертарианский",
    compass_libLeft: "Либ. Левые",
    compass_libRight: "Либ. Правые",
    compass_authLeft: "Авт. Левые",
    compass_authRight: "Авт. Правые",
  },
  [Language.Arabic]: {
    sessionExpired: "انتهت جلسة الاختبار أو تنتمي إلى إصدار قديم. استخدم /start لبدء اختبار جديد.",
    retry: "تعذر إكمال هذه الخطوة. اضغط الزر نفسه للمحاولة مجددا. إذا استمرت المشكلة، استخدم /start.",
    welcome: [
      "👋 مرحبا بك في بوت تلغرام «من أنا؟»! 🎭",
      "",
      "🔮 هل أنت مستعد لاكتشاف أسرار شخصيتك؟",
      "👇 اختر أحد الخيارات أدناه للبدء!",
    ].join("\n"),
    mode: "كيف يجب طرح الأسئلة؟ \n👇",
    gender: "الرجاء تحديد جنسك \n👇",
    start_btn: "🚀 ابدأ الاختبار",
    help_btn: "❓ مساعدة",
    language_btn: "🌐 اللغة",
    help: ["📌 الرجاء الضغط على زر «ابدأ الاختبار» للبدء!"].join("\n"),
    male: "ذكر",
    female: "أنثى",
    about: "حول",
    language: "اللغة",
    select_language: "الرجاء اختيار لغتك:",
    matchfound_message: "🎯 هل تريد التعرف على أشخاص من نوعك؟",
    matchfound_button: "✅ نعم",
    compass_left: "يسار",
    compass_right: "يمين",
    compass_authoritarian: "استبدادي",
    compass_libertarian: "ليبرتاري",
    compass_libLeft: "يسار ليبرتاري",
    compass_libRight: "يمين ليبرتاري",
    compass_authLeft: "يسار استبدادي",
    compass_authRight: "يمين استبدادي",
  },
};

// Get strings for a language
export function getStrings(language: Language = DEFAULT_LANGUAGE): IStrings {
  return translations[language] || translations[DEFAULT_LANGUAGE];
}

// Get strings for a user
export async function getStringsForUser(userId?: number): Promise<IStrings> {
  const lang = await getUserLanguage(userId);
  return getStrings(lang);
}
